from __future__ import annotations

import argparse
import atexit
import csv
import io
import json
import os
import zipfile
from collections import Counter
from functools import lru_cache
from pathlib import Path

import torch
from PIL import Image
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision import models, transforms


LABELS = ["unripe", "fresh", "overripe", "rotten"]


@lru_cache(maxsize=16)
def open_archive(path: str) -> zipfile.ZipFile:
    # Training uses one data-loader process, so cached read-only archive handles are safe and
    # avoid loading multi-gigabyte archives into memory.
    return zipfile.ZipFile(path)


class FreshnessDataset(Dataset):
    def __init__(self, rows: list[dict[str, str]], training: bool):
        self.rows = rows
        self.transform = transforms.Compose(
            [
                transforms.RandomResizedCrop(224, scale=(0.75, 1.0))
                if training
                else transforms.Resize((224, 224)),
                transforms.RandomHorizontalFlip()
                if training
                else transforms.Lambda(lambda image: image),
                transforms.ColorJitter(brightness=0.12, contrast=0.12, saturation=0.08)
                if training
                else transforms.Lambda(lambda image: image),
                transforms.ToTensor(),
                transforms.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
            ]
        )

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, index: int):
        row = self.rows[index]
        if row["archive_member"]:
            data = open_archive(row["path"]).read(row["archive_member"])
            image = Image.open(io.BytesIO(data)).convert("RGB")
        else:
            image = Image.open(row["path"]).convert("RGB")
        if row.get("bbox_x_center"):
            x, y, width, height = [
                float(row[key])
                for key in (
                    "bbox_x_center",
                    "bbox_y_center",
                    "bbox_width",
                    "bbox_height",
                )
            ]
            left = max(0, int((x - width / 2) * image.width))
            top = max(0, int((y - height / 2) * image.height))
            right = min(image.width, int((x + width / 2) * image.width))
            bottom = min(image.height, int((y + height / 2) * image.height))
            if right > left and bottom > top:
                image = image.crop((left, top, right, bottom))
        return self.transform(image), LABELS.index(row["freshness"])


def evaluate(model: nn.Module, loader: DataLoader, device: torch.device) -> dict[str, float]:
    model.eval()
    correct = total = 0
    class_correct = [0] * len(LABELS)
    class_total = [0] * len(LABELS)
    with torch.no_grad():
        for images, labels in loader:
            images, labels = images.to(device), labels.to(device)
            predictions = model(images).argmax(dim=1)
            correct += int((predictions == labels).sum())
            total += len(labels)
            for truth, prediction in zip(labels.tolist(), predictions.tolist()):
                class_total[truth] += 1
                class_correct[truth] += int(truth == prediction)
    result = {"accuracy": correct / total if total else 0.0}
    result.update(
        {
            f"accuracy_{label}": class_correct[index] / class_total[index]
            if class_total[index]
            else 0.0
            for index, label in enumerate(LABELS)
        }
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Train EcoChef's visual freshness classifier.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    args.run_dir.mkdir(parents=True, exist_ok=True)
    pid_file = args.run_dir / "training.pid"
    pid_file.write_text(str(os.getpid()), encoding="utf-8")
    atexit.register(lambda: pid_file.unlink(missing_ok=True))
    stop_file = args.run_dir / "STOP"
    with args.manifest.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    split_rows = {
        split: [row for row in rows if row["split"] == split] for split in ("train", "val", "test")
    }
    if any(not split_rows[split] for split in split_rows):
        raise RuntimeError("Manifest must contain non-empty train, val and test splits.")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"device={device}", flush=True)
    model = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
    model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, len(LABELS))
    model.to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=2e-4, weight_decay=1e-4)
    train_counts = Counter(row["freshness"] for row in split_rows["train"])
    class_weights = torch.tensor(
        [len(split_rows["train"]) / (len(LABELS) * train_counts[label]) for label in LABELS],
        dtype=torch.float32,
        device=device,
    )
    criterion = nn.CrossEntropyLoss(weight=class_weights)
    checkpoint_path = args.run_dir / "checkpoint.pt"
    start_epoch = 1
    history: list[dict] = []
    if args.resume and checkpoint_path.exists():
        checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=False)
        model.load_state_dict(checkpoint["model"])
        optimizer.load_state_dict(checkpoint["optimizer"])
        start_epoch = int(checkpoint["epoch"]) + 1
        history = checkpoint.get("history", [])

    train_loader = DataLoader(
        FreshnessDataset(split_rows["train"], True),
        batch_size=args.batch_size,
        shuffle=True,
        num_workers=0,
        pin_memory=device.type == "cuda",
    )
    val_loader = DataLoader(
        FreshnessDataset(split_rows["val"], False),
        batch_size=args.batch_size,
        num_workers=0,
        pin_memory=device.type == "cuda",
    )
    test_loader = DataLoader(
        FreshnessDataset(split_rows["test"], False),
        batch_size=args.batch_size,
        num_workers=0,
        pin_memory=device.type == "cuda",
    )

    for epoch in range(start_epoch, args.epochs + 1):
        if stop_file.exists():
            print(f"Safe stop requested before epoch {epoch}.", flush=True)
            break
        model.train()
        running_loss = 0.0
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(model(images), labels)
            loss.backward()
            optimizer.step()
            running_loss += float(loss) * len(labels)
        validation = evaluate(model, val_loader, device)
        entry = {
            "epoch": epoch,
            "train_loss": running_loss / len(train_loader.dataset),
            **{f"val_{key}": value for key, value in validation.items()},
        }
        history.append(entry)
        torch.save(
            {
                "epoch": epoch,
                "model": model.state_dict(),
                "optimizer": optimizer.state_dict(),
                "history": history,
                "labels": LABELS,
            },
            checkpoint_path,
        )
        (args.run_dir / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
        print(json.dumps(entry), flush=True)

    final = {
        "validation": evaluate(model, val_loader, device),
        "test": evaluate(model, test_loader, device),
        "labels": LABELS,
    }
    (args.run_dir / "metrics.json").write_text(json.dumps(final, indent=2), encoding="utf-8")
    model.eval().cpu()
    scripted = torch.jit.script(model)
    scripted.save(str(args.run_dir / "vision_freshness_model.pt"))
    print(json.dumps(final, indent=2), flush=True)


if __name__ == "__main__":
    main()
