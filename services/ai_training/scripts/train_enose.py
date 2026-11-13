from __future__ import annotations

import argparse
import atexit
import json
import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.linear_model import SGDClassifier
from sklearn.metrics import accuracy_score, classification_report, f1_score
from sklearn.preprocessing import StandardScaler


META_COLUMNS = {
    "sample_id",
    "recording",
    "fillet_id",
    "storage_day",
    "freshness_label",
    "split",
}


LABELS = ["excellent", "good", "acceptable", "spoiled"]


def metrics(model, scaler: StandardScaler | None, frame: pd.DataFrame, features: list[str]) -> dict:
    if frame.empty:
        return {"accuracy": None, "macro_f1": None, "classification_report": {}}
    truth = frame["freshness_label"].to_numpy(dtype=str)
    values = frame[features].to_numpy(dtype=float)
    predictions = model.predict(scaler.transform(values) if scaler is not None else values)
    return {
        "accuracy": float(accuracy_score(truth, predictions)),
        "macro_f1": float(f1_score(truth, predictions, average="macro", zero_division=0)),
        "classification_report": classification_report(
            truth, predictions, output_dict=True, zero_division=0
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Train EcoChef's electronic-nose freshness-day model."
    )
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--estimator", choices=("extra-trees", "sgd"), default="extra-trees")
    args = parser.parse_args()
    args.run_dir.mkdir(parents=True, exist_ok=True)
    pid_file = args.run_dir / "training.pid"
    pid_file.write_text(str(os.getpid()), encoding="utf-8")
    atexit.register(lambda: pid_file.unlink(missing_ok=True))
    stop_file = args.run_dir / "STOP"
    checkpoint_path = args.run_dir / "checkpoint.joblib"
    frame = pd.read_csv(args.data)
    features = [column for column in frame.columns if column not in META_COLUMNS]
    if not features:
        raise RuntimeError("No sensor features were found in the cleaned data.")
    train = frame[frame["split"] == "train"].copy()
    validation = frame[frame["split"] == "val"].copy()
    test = frame[frame["split"] == "test"].copy()
    if train.empty or validation.empty or test.empty:
        raise RuntimeError("Cleaned e-nose data must contain non-empty train, val and test splits.")
    x_train = train[features].to_numpy(dtype=float)
    y_train = train["freshness_label"].to_numpy(dtype=str)
    present_labels = set(frame["freshness_label"].astype(str))
    classes = np.array(
        [label for label in LABELS if label in present_labels]
        + sorted(present_labels - set(LABELS))
    )

    if args.estimator == "extra-trees":
        if args.resume:
            print(
                "Extra Trees is a one-pass estimator; rebuilding the deterministic model.",
                flush=True,
            )
        scaler = None
        model = ExtraTreesClassifier(
            n_estimators=600,
            min_samples_leaf=2,
            max_features="sqrt",
            class_weight="balanced",
            random_state=42,
            n_jobs=-1,
        )
        model.fit(x_train, y_train)
        validation_metrics = metrics(model, scaler, validation, features)
        history = [
            {
                "epoch": 1,
                "validation_accuracy": validation_metrics["accuracy"],
                "validation_macro_f1": validation_metrics["macro_f1"],
            }
        ]
        (args.run_dir / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
        joblib.dump(
            {
                "model": model,
                "scaler": scaler,
                "epoch": 1,
                "features": features,
                "classes": classes.tolist(),
                "history": history,
            },
            checkpoint_path,
        )
        print(
            f"fit=extra-trees val_accuracy={validation_metrics['accuracy']:.4f} val_macro_f1={validation_metrics['macro_f1']:.4f}",
            flush=True,
        )
    else:
        train_sgd(
            args,
            checkpoint_path,
            stop_file,
            x_train,
            y_train,
            classes,
            validation,
            features,
        )
        state = joblib.load(checkpoint_path)
        model, scaler, history = state["model"], state["scaler"], state["history"]

    final_metrics = {
        "validation": metrics(model, scaler, validation, features),
        "test": metrics(model, scaler, test, features),
        "labels": classes.tolist(),
        "estimator": args.estimator,
        "split_unit": "fillet_id" if "fillet_id" in frame.columns else "recording",
        "warning": "Predictions are screening estimates and are not a substitute for food-safety testing.",
    }
    joblib.dump(
        {
            "model": model,
            "scaler": scaler,
            "features": features,
            "classes": classes.tolist(),
            "estimator": args.estimator,
        },
        args.run_dir / "enose_model.joblib",
    )
    (args.run_dir / "metrics.json").write_text(
        json.dumps(final_metrics, indent=2), encoding="utf-8"
    )
    print(json.dumps(final_metrics, indent=2), flush=True)


def train_sgd(
    args,
    checkpoint_path: Path,
    stop_file: Path,
    x_train: np.ndarray,
    y_train: np.ndarray,
    classes: np.ndarray,
    validation: pd.DataFrame,
    features: list[str],
) -> None:

    if args.resume and checkpoint_path.exists():
        state = joblib.load(checkpoint_path)
        model, scaler, start_epoch = (
            state["model"],
            state["scaler"],
            int(state["epoch"]) + 1,
        )
        history = state.get("history", [])
        if state["features"] != features:
            raise RuntimeError(
                "Feature columns changed since the checkpoint was created. Start a new run."
            )
    else:
        scaler = StandardScaler().fit(x_train)
        model = SGDClassifier(
            loss="log_loss",
            penalty="elasticnet",
            alpha=0.0001,
            random_state=42,
            average=True,
        )
        start_epoch = 1
        history = []

    rng = np.random.default_rng(42)
    for epoch in range(start_epoch, args.epochs + 1):
        if stop_file.exists():
            print(f"Safe stop requested before epoch {epoch}.", flush=True)
            break
        order = rng.permutation(len(x_train))
        x_epoch = scaler.transform(x_train[order])
        y_epoch = y_train[order]
        if epoch == 1 and not (args.resume and checkpoint_path.exists()):
            model.partial_fit(x_epoch, y_epoch, classes=classes)
        else:
            model.partial_fit(x_epoch, y_epoch)
        validation_metrics = metrics(model, scaler, validation, features)
        history.append(
            {
                "epoch": epoch,
                "validation_accuracy": validation_metrics["accuracy"],
                "validation_macro_f1": validation_metrics["macro_f1"],
            }
        )
        joblib.dump(
            {
                "model": model,
                "scaler": scaler,
                "epoch": epoch,
                "features": features,
                "classes": classes.tolist(),
                "history": history,
            },
            checkpoint_path,
        )
        (args.run_dir / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")
        print(
            f"epoch={epoch} val_accuracy={validation_metrics['accuracy']:.4f} val_macro_f1={validation_metrics['macro_f1']:.4f}",
            flush=True,
        )


if __name__ == "__main__":
    main()
