from __future__ import annotations

import argparse
import atexit
import json
import os
import shutil
from pathlib import Path

import torch
from ultralytics import YOLO


TRAINING_PROFILES = {
    # Accuracy-oriented profile for the RTX 4060 Laptop GPU. The augmentation values
    # follow the released YOLO26s recipe closely while retaining the higher input
    # resolution that helps EcoChef's small refrigerator objects.
    "accurate-s": {
        "model": "yolo26s.pt",
        "epochs": 120,
        "batch_size": 4,
        "imgsz": 768,
        "patience": 20,
        "workers": 4,
        "optimizer": "MuSGD",
        "warmup_epochs": 1.0,
        "close_mosaic": 10,
        "mosaic": 1.0,
        "mixup": 0.05,
        "scale": 0.9,
        "translate": 0.275,
        "degrees": 0.0,
        "shear": 0.0,
        "fliplr": 0.3,
        "hsv_h": 0.013,
        "hsv_s": 0.35,
        "hsv_v": 0.20,
    },
    # Throughput-oriented profile. Batch 16 should fit this small model on 8 GB;
    # Ultralytics can automatically retry with a smaller batch on a first-epoch OOM.
    "fast-n": {
        "model": "weights/yolo26n.pt",
        "epochs": 100,
        "batch_size": 16,
        "imgsz": 640,
        "patience": 15,
        "workers": 4,
        "optimizer": "MuSGD",
        "warmup_epochs": 1.0,
        "close_mosaic": 10,
        "mosaic": 0.91,
        "mixup": 0.012,
        "scale": 0.56,
        "translate": 0.07,
        "degrees": 1.1,
        "shear": 1.5,
        "fliplr": 0.61,
        "hsv_h": 0.014,
        "hsv_s": 0.65,
        "hsv_v": 0.57,
    },
}


def resolved_training_config(args: argparse.Namespace) -> dict:
    config = dict(TRAINING_PROFILES[args.profile])
    for key in config:
        value = getattr(args, key, None)
        if value is not None:
            config[key] = value
    return config


def dataset_identity(data_yaml: Path) -> dict:
    identity_path = data_yaml.parent / "dataset_fingerprint.json"
    if not identity_path.exists():
        raise RuntimeError(
            f"Dataset identity is missing: {identity_path}. Run prepare-datasets.cmd and validation first."
        )
    identity = json.loads(identity_path.read_text(encoding="utf-8"))
    if not identity.get("fingerprint") or not identity.get("classes"):
        raise RuntimeError(f"Dataset identity is incomplete: {identity_path}")
    return identity


def checkpoint_names(path: Path) -> list[str] | None:
    try:
        checkpoint = torch.load(path, map_location="cpu", weights_only=False)
        model = checkpoint.get("ema") or checkpoint.get("model")
        names = getattr(model, "names", None)
        if isinstance(names, dict):
            return [str(names[index]) for index in sorted(names)]
        if isinstance(names, (list, tuple)):
            return [str(name) for name in names]
    except (OSError, RuntimeError, ValueError, TypeError, AttributeError):
        return None
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Train EcoChef's ingredient object detector.")
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--profile", choices=sorted(TRAINING_PROFILES), default="accurate-s")
    parser.add_argument("--model")
    parser.add_argument("--epochs", type=int)
    parser.add_argument("--batch-size", type=int)
    parser.add_argument("--imgsz", type=int)
    parser.add_argument(
        "--patience",
        type=int,
        help="Stop after this many epochs without validation fitness improvement.",
    )
    parser.add_argument("--workers", type=int)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    config = resolved_training_config(args)
    identity = dataset_identity(args.data)
    args.run_dir.mkdir(parents=True, exist_ok=True)
    pid_file = args.run_dir / "training.pid"
    pid_file.write_text(str(os.getpid()), encoding="utf-8")
    atexit.register(lambda: pid_file.unlink(missing_ok=True))
    stop_file = args.run_dir / "STOP"
    last_checkpoint = args.run_dir / "train" / "weights" / "last.pt"
    resume_checkpoint = args.run_dir / "resume.pt"

    def is_resumable(path: Path) -> bool:
        if not path.exists():
            return False
        try:
            checkpoint = torch.load(path, map_location="cpu", weights_only=False)
            return int(checkpoint.get("epoch", -1)) >= 0 and checkpoint.get("optimizer") is not None
        except (OSError, RuntimeError, ValueError, TypeError):
            return False

    resumable = resume_checkpoint if is_resumable(resume_checkpoint) else last_checkpoint
    do_resume = args.resume and is_resumable(resumable)
    if do_resume:
        saved_identity_path = args.run_dir / "dataset_fingerprint.json"
        if not saved_identity_path.exists():
            raise RuntimeError(
                "Refusing to resume because this run has no saved dataset fingerprint. "
                "Start a new run directory for the rebuilt dataset."
            )
        saved_identity = json.loads(saved_identity_path.read_text(encoding="utf-8"))
        if saved_identity.get("fingerprint") != identity["fingerprint"]:
            raise RuntimeError(
                "Refusing to resume: the prepared dataset changed. Start a new run so optimizer "
                "history and validation metrics are not mixed across datasets."
            )
        names = checkpoint_names(resumable)
        if names is not None and names != identity["classes"]:
            raise RuntimeError(
                "Refusing to resume: checkpoint class names/order do not match the prepared dataset."
            )
        model = YOLO(str(resumable))
        print(f"Resuming complete training state from {resumable}.", flush=True)
    elif args.resume and last_checkpoint.exists():
        # Older EcoChef safe stops were finalized by Ultralytics and lost optimizer/epoch
        # state. Preserve the learned weights and start a fresh schedule from them.
        model = YOLO(str(last_checkpoint))
        print(
            "The previous checkpoint contains trained weights but no resumable optimizer state; "
            "warm-starting a new schedule from those weights.",
            flush=True,
        )
    else:
        existing_results = args.run_dir / "train" / "results.csv"
        if existing_results.exists():
            raise RuntimeError(
                f"A detector run already exists at {args.run_dir}. Use resume or choose a new run directory."
            )
        model = YOLO(config["model"])
        (args.run_dir / "dataset_fingerprint.json").write_text(
            json.dumps(identity, indent=2), encoding="utf-8"
        )
        (args.run_dir / "training_profile.json").write_text(
            json.dumps({"profile": args.profile, **config}, indent=2), encoding="utf-8"
        )
        print(
            f"Dataset fingerprint {identity['fingerprint'][:12]}: "
            f"{identity['samples']:,} images, {identity['boxes']:,} boxes, "
            f"{len(identity['classes'])} classes.",
            flush=True,
        )

    def safe_stop(trainer) -> None:
        if stop_file.exists():
            print(
                "Safe stop requested; finishing the current epoch and saving a checkpoint.",
                flush=True,
            )
            trainer.stop = True

    def report_epoch(trainer) -> None:
        # Ultralytics calls on_fit_epoch_end once more for final best-model validation
        # with an incremented display epoch. Do not present that as epoch 81/80.
        if trainer.epoch >= trainer.epochs:
            return
        metrics = getattr(trainer, "metrics", {}) or {}
        summary = " ".join(
            f"{str(key).replace('metrics/', '')}={float(value):.4f}"
            for key, value in metrics.items()
            if isinstance(value, (int, float))
        )
        print(
            f"epoch={trainer.epoch + 1}/{trainer.epochs} completed {summary}".strip(),
            flush=True,
        )

    def preserve_resume_checkpoint(trainer) -> None:
        # Ultralytics strips optimizer state during final evaluation. Preserve the just-saved
        # full checkpoint before that finalization happens when EcoChef requested a safe stop.
        if stop_file.exists() and Path(trainer.last).exists():
            shutil.copy2(trainer.last, resume_checkpoint)
            print(f"Resumable checkpoint saved to {resume_checkpoint}.", flush=True)

    def configure_early_stopping(trainer) -> None:
        # A resumed Ultralytics checkpoint restores its previous stopper object, including
        # the old patience value. Reapply EcoChef's configured value after state loading.
        trainer.stopper.patience = config["patience"]
        print(
            f"Profile {args.profile}: {config['model']}, {config['imgsz']}px, "
            f"batch {config['batch_size']}, {config['workers']} workers, "
            f"optimizer {config['optimizer']}.\n"
            f"Early stopping enabled: stop after {config['patience']} consecutive epochs "
            "without validation fitness improvement; best.pt will be retained.",
            flush=True,
        )

    model.add_callback("on_train_start", configure_early_stopping)
    model.add_callback("on_train_epoch_end", safe_stop)
    model.add_callback("on_model_save", preserve_resume_checkpoint)
    model.add_callback("on_fit_epoch_end", report_epoch)
    model.train(
        data=str(args.data),
        epochs=config["epochs"],
        imgsz=config["imgsz"],
        batch=config["batch_size"],
        device=0 if __import__("torch").cuda.is_available() else "cpu",
        project=str(args.run_dir),
        name="train",
        exist_ok=True,
        resume=do_resume,
        workers=config["workers"],
        optimizer=config["optimizer"],
        warmup_epochs=config["warmup_epochs"],
        close_mosaic=config["close_mosaic"],
        mosaic=config["mosaic"],
        mixup=config["mixup"],
        scale=config["scale"],
        translate=config["translate"],
        degrees=config["degrees"],
        shear=config["shear"],
        fliplr=config["fliplr"],
        hsv_h=config["hsv_h"],
        hsv_s=config["hsv_s"],
        hsv_v=config["hsv_v"],
        amp=True,
        seed=42,
        patience=config["patience"],
        verbose=False,
    )
    if not stop_file.exists():
        resume_checkpoint.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
