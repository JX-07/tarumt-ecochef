"""Compare existing e-nose data using only channels on the current ESP32.

These are source-dataset holdouts, not validation on the EcoChef sensor itself.
Beef and trout have different labels and sampling protocols, so they are tested
separately.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier
from sklearn.metrics import accuracy_score, balanced_accuracy_score, confusion_matrix, f1_score


LABEL = "freshness_label"
SPLITS = ("train", "val", "test")
BEEF_CHANNELS = ("mq3", "mq135", "mq136", "temperature", "humidity")
FISH_CHANNELS = ("mq3", "mq135", "mq137", "temperature", "humidity")
SHARED_CHANNELS = ("mq3", "mq135", "temperature", "humidity")


def score(frame: pd.DataFrame, features: list[str]) -> dict:
    partitions = {name: frame.loc[frame["split"] == name] for name in SPLITS}
    if any(part.empty for part in partitions.values()):
        raise ValueError("Expected nonempty train, validation and test partitions.")
    if set(partitions["train"]["recording"]) & set(partitions["test"]["recording"]):
        raise ValueError("A recording appears in both training and test.")
    if "fillet_id" in frame and (
        set(partitions["train"]["fillet_id"]) & set(partitions["test"]["fillet_id"])
    ):
        raise ValueError("A fish fillet appears in both training and test.")

    model = ExtraTreesClassifier(
        n_estimators=200,
        min_samples_leaf=2,
        max_features="sqrt",
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    train = partitions["train"]
    model.fit(train[features], train[LABEL])
    labels = sorted(frame[LABEL].unique().tolist())
    result = {"features": features, "train_rows": len(train), "labels": labels}
    for split in ("val", "test"):
        held_out = partitions[split]
        actual = held_out[LABEL]
        predicted = model.predict(held_out[features])
        result[split] = {
            "rows": len(held_out),
            "accuracy": round(float(accuracy_score(actual, predicted)), 4),
            "balanced_accuracy": round(
                float(balanced_accuracy_score(actual, predicted)), 4
            ),
            "macro_f1": round(float(f1_score(actual, predicted, average="macro")), 4),
            "confusion_matrix": confusion_matrix(
                actual, predicted, labels=labels
            ).tolist(),
        }
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--beef", type=Path, required=True)
    parser.add_argument("--fish", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    beef = pd.read_csv(args.beef)
    fish = pd.read_csv(args.fish)
    if not set(BEEF_CHANNELS).issubset(beef.columns):
        raise ValueError("Beef data is missing an ESP32-compatible channel.")
    fish_channels = [
        column
        for column in fish.columns
        if column.split("_")[0] in FISH_CHANNELS
    ]
    shared_fish = [
        column
        for column in fish.columns
        if column.split("_")[0] in SHARED_CHANNELS
    ]
    result = {
        "warning": "Source-dataset testing only. Not validated on the current ESP32 or mixed foods.",
        "beef": {
            "full": score(
                beef,
                ["mq2", "mq3", "mq4", "mq5", "mq135", "mq136", "temperature", "humidity"],
            ),
            "esp32_subset": score(beef, list(BEEF_CHANNELS)),
            "shared_four": score(beef, list(SHARED_CHANNELS)),
        },
        "trout": {
            "full": score(
                fish,
                [
                    column for column in fish.columns
                    if column not in {
                        "sample_id", "recording", "fillet_id", "storage_day",
                        LABEL, "split",
                    }
                ],
            ),
            "esp32_subset": score(fish, fish_channels),
            "shared_four": score(fish, shared_fish),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    for food, experiments in result.items():
        if food == "warning":
            continue
        for name, metrics in experiments.items():
            print(
                f"{food}/{name}: test n={metrics['test']['rows']} "
                f"accuracy={metrics['test']['accuracy']} "
                f"balanced={metrics['test']['balanced_accuracy']} "
                f"macro_f1={metrics['test']['macro_f1']}",
                flush=True,
            )


if __name__ == "__main__":
    main()
