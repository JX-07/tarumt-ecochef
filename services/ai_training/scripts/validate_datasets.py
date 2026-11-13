from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from pathlib import Path

import pandas as pd


EXPECTED_FRESHNESS = {"unripe", "fresh", "overripe", "rotten"}
EXPECTED_ENOSE_LABELS = {"excellent", "good", "acceptable", "spoiled"}
SAFE_EVALUATION_METHODS = {
    "native_yolo",
    "native_polygon",
    "native_voc",
    "reviewed_box",
}


def detection_names(yaml_text: str) -> list[str]:
    names: dict[int, str] = {}
    in_names = False
    for line in yaml_text.splitlines():
        if line.strip() == "names:":
            in_names = True
            continue
        if in_names:
            match = __import__("re").match(r"\s+(\d+):\s*(.+?)\s*$", line)
            if not match:
                break
            names[int(match.group(1))] = match.group(2)
    if not names or sorted(names) != list(range(len(names))):
        raise RuntimeError("Detection dataset.yaml names must be contiguous from class 0.")
    ordered = [names[index] for index in range(len(names))]
    if len(set(ordered)) != len(ordered):
        raise RuntimeError("Detection dataset.yaml contains duplicate class names.")
    return ordered


def validate_detection(root: Path) -> dict:
    yaml_text = (root / "dataset.yaml").read_text(encoding="utf-8")
    nc_line = next(line for line in yaml_text.splitlines() if line.startswith("nc:"))
    class_count = int(nc_line.split(":", 1)[1].strip())
    names = detection_names(yaml_text)
    if len(names) != class_count:
        raise RuntimeError(
            f"Detection nc={class_count} but dataset.yaml contains {len(names)} names."
        )
    expected_classes = set(range(class_count))
    result: dict[str, dict] = {}
    observed_train_classes: set[int] = set()
    for split in ("train", "val", "test"):
        images = {path.stem for path in (root / "images" / split).iterdir() if path.is_file()}
        labels = {path.stem for path in (root / "labels" / split).glob("*.txt")}
        if images != labels:
            raise RuntimeError(
                f"Detection {split} image/label mismatch: {len(images)} images and {len(labels)} labels."
            )
        classes = Counter()
        for label_path in (root / "labels" / split).glob("*.txt"):
            for line in label_path.read_text(encoding="utf-8").splitlines():
                fields = line.split()
                if len(fields) != 5:
                    raise RuntimeError(f"Invalid cleaned YOLO row in {label_path}: {line}")
                class_id = int(fields[0])
                values = [float(value) for value in fields[1:]]
                x, y, width, height = values
                epsilon = 1e-6
                inside = (
                    0 <= x <= 1
                    and 0 <= y <= 1
                    and 0 < width <= 1
                    and 0 < height <= 1
                    and x - width / 2 >= -epsilon
                    and y - height / 2 >= -epsilon
                    and x + width / 2 <= 1 + epsilon
                    and y + height / 2 <= 1 + epsilon
                )
                if class_id not in expected_classes or not inside:
                    raise RuntimeError(f"Invalid cleaned YOLO values in {label_path}: {line}")
                classes[class_id] += 1
        if not classes:
            raise RuntimeError(f"Detection {split} contains no usable bounding boxes.")
        if split == "train":
            observed_train_classes.update(classes)
        result[split] = {
            "images": len(images),
            "boxes_by_class": dict(sorted(classes.items())),
        }
    missing_train = expected_classes - observed_train_classes
    if missing_train:
        raise RuntimeError(
            f"Detection train is missing classes: {[names[index] for index in sorted(missing_train)]}"
        )

    manifest_path = root / "detection_manifest.csv"
    inventory_path = root / "source_inventory.csv"
    fingerprint_path = root / "dataset_fingerprint.json"
    if not manifest_path.exists() or not inventory_path.exists() or not fingerprint_path.exists():
        raise RuntimeError(
            "Expanded detector manifest, source inventory, or fingerprint is missing."
        )
    manifest = pd.read_csv(manifest_path, dtype=str, keep_default_na=False, low_memory=False)
    required = {
        "sample_id",
        "source",
        "group_id",
        "split",
        "annotation_method",
        "image",
        "label",
    }
    if not required.issubset(manifest.columns):
        raise RuntimeError(
            f"Detection manifest is missing columns: {sorted(required - set(manifest.columns))}"
        )
    if manifest["sample_id"].duplicated().any():
        raise RuntimeError("Detection manifest contains duplicate sample IDs.")
    if manifest.groupby("group_id")["split"].nunique().max() != 1:
        raise RuntimeError("Detection capture groups leak across splits.")
    unsafe_eval = manifest[
        manifest["split"].isin(["val", "test"])
        & ~manifest["annotation_method"].isin(SAFE_EVALUATION_METHODS)
    ]
    if not unsafe_eval.empty:
        raise RuntimeError("Validation/test contain unreviewed derived annotations.")
    inventory = pd.read_csv(inventory_path).fillna("")
    pending = inventory[inventory["status"].isin(["", "pending_audit"])]
    if not pending.empty:
        raise RuntimeError(f"Source inventory has unaudited entries: {pending['folder'].tolist()}")
    identity = json.loads(fingerprint_path.read_text(encoding="utf-8"))
    if identity.get("classes") != names or identity.get("samples") != len(manifest):
        raise RuntimeError("Detection fingerprint metadata does not match the generated dataset.")
    result["summary"] = {
        "classes": len(names),
        "samples": len(manifest),
        "sources": manifest["source"].value_counts().to_dict(),
        "annotation_methods": manifest["annotation_method"].value_counts().to_dict(),
        "fingerprint": identity.get("fingerprint"),
    }
    return result


def validate_vision(path: Path) -> dict:
    frame = pd.read_csv(path)
    required = {"sample_id", "path", "archive_member", "freshness", "group_id", "split"}
    if not required.issubset(frame.columns):
        raise RuntimeError(
            f"Vision manifest is missing columns: {sorted(required - set(frame.columns))}"
        )
    if frame["sample_id"].duplicated().any():
        raise RuntimeError("Vision manifest contains duplicate sample IDs.")
    if frame.groupby("group_id")["split"].nunique().max() != 1:
        raise RuntimeError("Vision capture groups leak across splits.")
    for split in ("train", "val", "test"):
        labels = set(frame.loc[frame["split"] == split, "freshness"])
        if labels != EXPECTED_FRESHNESS:
            raise RuntimeError(
                f"Vision {split} is missing freshness labels: {sorted(EXPECTED_FRESHNESS - labels)}"
            )
    return {
        "samples": len(frame),
        "by_split": frame["split"].value_counts().to_dict(),
        "by_label": frame["freshness"].value_counts().to_dict(),
    }


def validate_enose(path: Path) -> dict:
    frame = pd.read_csv(path)
    if frame.isna().any().any():
        raise RuntimeError("Cleaned e-nose windows contain missing values.")
    if frame.groupby("recording")["split"].nunique().max() != 1:
        raise RuntimeError("E-nose recordings leak across splits.")
    for split in ("train", "val", "test"):
        labels = set(frame.loc[frame["split"] == split, "freshness_label"])
        if labels != EXPECTED_ENOSE_LABELS:
            raise RuntimeError(
                f"E-nose {split} is missing labels: {sorted(EXPECTED_ENOSE_LABELS - labels)}"
            )
    return {
        "rows": len(frame),
        "by_split": frame["split"].value_counts().to_dict(),
        "by_label": frame["freshness_label"].value_counts().to_dict(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate cleaned EcoChef AI datasets.")
    parser.add_argument("--data", type=Path, required=True)
    args = parser.parse_args()
    result = {
        "detection": validate_detection(args.data / "ingredient_detection"),
        "vision": validate_vision(args.data / "vision_freshness_manifest.csv"),
        "enose": validate_enose(args.data / "enose_spoilage.csv"),
    }
    (args.data / "validation_report.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
