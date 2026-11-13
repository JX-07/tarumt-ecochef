from __future__ import annotations

import argparse
import io
import json
import re
import zipfile
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesClassifier, ExtraTreesRegressor
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

from prepare_enose_fish import prepare as prepare_trout


SEED = 42


def numeric_frame(frame: pd.DataFrame, excluded: set[str] | None = None) -> pd.DataFrame:
    excluded = excluded or set()
    result = pd.DataFrame(
        {
            str(column).strip(): pd.to_numeric(frame[column], errors="coerce")
            for column in frame.columns
            if str(column).strip() not in excluded
        }
    ).replace([np.inf, -np.inf], np.nan)
    result = result.loc[:, result.notna().any()]
    return result.fillna(result.median(numeric_only=True))


def split_indices(
    y: pd.Series, regression: bool = False
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    indices = np.arange(len(y))
    stratify = None if regression or y.value_counts().min() < 3 else y
    train, remainder = train_test_split(
        indices, test_size=0.3, random_state=SEED, stratify=stratify
    )
    remainder_y = y.iloc[remainder]
    stratify_remainder = None if regression or remainder_y.value_counts().min() < 2 else remainder_y
    validation, test = train_test_split(
        remainder, test_size=0.5, random_state=SEED, stratify=stratify_remainder
    )
    return train, validation, test


def train_task(
    name: str,
    x: pd.DataFrame,
    y: pd.Series,
    output: Path,
    task: str = "classification",
    note: str = "",
    evaluation_scope: str = "random cleaned-row holdout",
) -> dict:
    usable = pd.concat([x, y.rename("target")], axis=1).dropna().drop_duplicates()
    x = usable.drop(columns="target")
    y = usable["target"]
    if len(x) < 20 or x.shape[1] == 0:
        raise ValueError(
            f"insufficient clean samples/features ({len(x)} rows, {x.shape[1]} features)"
        )
    regression = task == "regression"
    train, validation, test = split_indices(y, regression)
    if regression:
        model = ExtraTreesRegressor(
            n_estimators=400, min_samples_leaf=2, random_state=SEED, n_jobs=-1
        )
    else:
        model = ExtraTreesClassifier(
            n_estimators=400,
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=SEED,
            n_jobs=-1,
        )
    model.fit(x.iloc[train], y.iloc[train])

    def score(indices: np.ndarray) -> dict:
        prediction = model.predict(x.iloc[indices])
        truth = y.iloc[indices]
        if regression:
            return {
                "mae": float(mean_absolute_error(truth, prediction)),
                "r2": float(r2_score(truth, prediction)),
            }
        return {
            "accuracy": float(accuracy_score(truth, prediction)),
            "macro_f1": float(f1_score(truth, prediction, average="macro", zero_division=0)),
        }

    run = output / name
    run.mkdir(parents=True, exist_ok=True)
    artifact = {
        "model": model,
        "features": x.columns.tolist(),
        "task": task,
        "classes": getattr(model, "classes_", None),
    }
    joblib.dump(artifact, run / "model.joblib")
    report = {
        "status": "trained",
        "task": task,
        "rows": len(x),
        "features": x.shape[1],
        "train_rows": len(train),
        "validation_rows": len(validation),
        "test_rows": len(test),
        "validation": score(validation),
        "test": score(test),
        "note": note,
        "evaluation_scope": evaluation_scope,
    }
    (run / "metrics.json").write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    return report


def aggregate_recording(frame: pd.DataFrame, columns: list[str]) -> dict[str, float]:
    result: dict[str, float] = {}
    for column in columns:
        values = pd.to_numeric(frame[column], errors="coerce").dropna().to_numpy(float)
        if not len(values):
            continue
        result.update(
            {
                f"{column}_mean": float(np.mean(values)),
                f"{column}_std": float(np.std(values)),
                f"{column}_min": float(np.min(values)),
                f"{column}_max": float(np.max(values)),
                f"{column}_delta": float(values[-1] - values[0]),
            }
        )
    return result


def load_fish_sessions(root: Path) -> pd.DataFrame:
    rows = []
    base = root / "Dataset for Fish’s Freshness Problems"
    for path in base.rglob("*.xlsx"):
        frame = pd.read_excel(path)
        day_match = re.search(r"Day (\d+)", str(path))
        if not day_match or not {"MQ1", "TGS1"}.issubset(frame.columns):
            continue
        species = path.parent.name.lower()
        row = aggregate_recording(frame, ["MQ1", "TGS1"])
        row.update({"species": species, "storage_day": int(day_match.group(1))})
        rows.append(row)
    return pd.DataFrame(rows)


def load_food_progression(root: Path) -> pd.DataFrame:
    rows = []
    base = root / "Food-Freshness-E-Nose-Dataset"
    for path in base.rglob("*.csv"):
        match = re.search(r" D([1-5])$", path.stem, flags=re.I)
        if not match:
            continue
        frame = pd.read_csv(path)
        sensors = [column for column in frame.columns if str(column).upper().startswith("MQ")]
        row = aggregate_recording(frame, sensors)
        row.update(
            {
                "ingredient": re.sub(r" D[1-5]$", "", path.stem, flags=re.I).lower(),
                "storage_day": int(match.group(1)),
            }
        )
        rows.append(row)
    return pd.DataFrame(rows)


def load_beef_cuts(root: Path) -> pd.DataFrame:
    workbook = root / "e-nose_dataset_12_beef_cuts.xlsx"
    rows = []
    for sheet, frame in pd.read_excel(workbook, sheet_name=None).items():
        frame.columns = [str(column).strip() for column in frame.columns]
        frame["beef_cut"] = re.sub(r"^\d+\.", "", sheet).lower()
        rows.append(frame)
    return pd.concat(rows, ignore_index=True)


def load_gas_features(root: Path) -> pd.DataFrame:
    return pd.read_csv(root / "Dataset (1)" / "extracted_features.csv", sep=r"\s+", quotechar='"')


def load_vpc_recordings(root: Path) -> pd.DataFrame:
    rows = []
    with zipfile.ZipFile(root / "vpc887d53s-3" / "Dataset.zip") as archive:
        for name in archive.namelist():
            if not name.lower().endswith(".txt"):
                continue
            frame = pd.read_csv(io.BytesIO(archive.read(name)), sep=r"\s+", header=None)
            if frame.shape[1] < 3:
                continue
            row = aggregate_recording(frame, list(frame.columns))
            row["substance"] = name.split("/")[0].lower()
            rows.append(row)
    return pd.DataFrame(rows)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Clean and train the EcoChef e-nose specialist model suite."
    )
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    reports: dict[str, dict] = {}

    def attempt(name: str, loader) -> None:
        try:
            reports[name] = loader()
            print(f"{name}: trained", flush=True)
        except Exception as error:
            reports[name] = {"status": "skipped", "reason": str(error)}
            print(f"{name}: skipped: {error}", flush=True)

    trout_csv = args.output / "_prepared" / "trout_freshness.csv"
    trout_csv.parent.mkdir(parents=True, exist_ok=True)
    prepare_trout(args.root / "dataset", trout_csv)
    trout = pd.read_csv(trout_csv)
    trout_meta = {
        "sample_id",
        "recording",
        "fillet_id",
        "storage_day",
        "freshness_label",
        "split",
    }
    attempt(
        "trout_freshness",
        lambda: train_task(
            "trout_freshness",
            trout.drop(columns=list(trout_meta)),
            trout.freshness_label,
            args.output,
            note="TVC-linked storage-day label; use runs/enose_fish_cleaned for the fillet-disjoint benchmark.",
            evaluation_scope="random recording holdout; canonical benchmark is fillet-disjoint",
        ),
    )

    beef = pd.read_csv(args.root / "Beef quality 4 classes.csv")
    beef.columns = [str(column).strip() for column in beef.columns]
    beef_labels = (
        beef.pop("class")
        .astype(str)
        .map({"1": "excellent", "2": "good", "3": "acceptable", "4": "spoiled"})
    )
    attempt(
        "beef_quality",
        lambda: train_task(
            "beef_quality",
            numeric_frame(beef, {"sl no", "minutes", "tvc"}),
            beef_labels,
            args.output,
            evaluation_scope="row holdout from a continuous public recording; not independent-batch validation",
        ),
    )

    pork_path = next(
        (args.root / "pork adulteration in e nose dataset(7 levels of ad").rglob("*.csv")
    )
    pork = pd.read_csv(pork_path)
    pork.columns = [str(column).strip() for column in pork.columns]
    pork_labels = pork.pop("class").astype(str)
    attempt(
        "pork_adulteration",
        lambda: train_task(
            "pork_adulteration",
            numeric_frame(pork, {"Si No", "minute"}),
            pork_labels,
            args.output,
            evaluation_scope="row holdout; independent-batch IDs unavailable",
        ),
    )

    for filename, name in (
        ("Aroma-7.csv", "aroma_identity"),
        ("CoffeePow-4.csv", "coffee_powder_identity"),
    ):
        frame = pd.read_csv(args.root / filename)
        attempt(
            name,
            lambda frame=frame, name=name: train_task(
                name,
                numeric_frame(frame, {"label"}),
                frame.label.astype(str),
                args.output,
                note="Row-level public labels; independent-recording IDs were unavailable.",
            ),
        )

    seafood = []
    for path in (args.root / "archive").glob("*.csv"):
        frame = pd.read_csv(path)
        frame["species"] = path.stem.removeprefix("data")
        seafood.append(frame)
    seafood = pd.concat(seafood, ignore_index=True)
    seafood_labels = seafood.pop("label").astype(str)
    seafood = pd.get_dummies(
        seafood.drop(columns=["TVC"], errors="ignore"), columns=["species"], dtype=float
    )
    attempt(
        "seafood_freshness",
        lambda: train_task(
            "seafood_freshness",
            numeric_frame(seafood),
            seafood_labels,
            args.output,
            note="TVC excluded to prevent target leakage.",
            evaluation_scope="row holdout from five species recordings; external-session validation required",
        ),
    )

    cuts = load_beef_cuts(args.root)
    cut_labels = cuts.pop("beef_cut")
    attempt(
        "beef_cut_identity",
        lambda: train_task(
            "beef_cut_identity",
            numeric_frame(cuts, {"Minute", "TVC", "Label"}),
            cut_labels,
            args.output,
            evaluation_scope="row holdout; each cut is a single continuous source series",
        ),
    )

    fish = load_fish_sessions(args.root)
    fish_x = numeric_frame(fish, {"species", "storage_day"})
    attempt(
        "fish_species_identity",
        lambda: train_task("fish_species_identity", fish_x, fish.species, args.output),
    )
    attempt(
        "fish_storage_day",
        lambda: train_task(
            "fish_storage_day",
            fish_x,
            fish.storage_day,
            args.output,
            task="regression",
            note="Storage-day progression, not a safety label.",
        ),
    )

    food = load_food_progression(args.root)
    food_x = numeric_frame(food, {"ingredient", "storage_day"})
    attempt(
        "food_storage_day",
        lambda: train_task(
            "food_storage_day",
            food_x,
            food.storage_day,
            args.output,
            task="regression",
            note="D1-D5 progression only; not verified spoilage.",
        ),
    )

    gas = load_gas_features(args.root)
    gas_y = gas.pop("Class").astype(str)
    gas = gas.drop(columns=["Date[yyyy-mm-dd]"], errors="ignore")
    attempt(
        "gas_concentration_identity",
        lambda: train_task("gas_concentration_identity", numeric_frame(gas), gas_y, args.output),
    )

    vpc = load_vpc_recordings(args.root)
    vpc_y = vpc.pop("substance")
    attempt(
        "wine_ethanol_substance",
        lambda: train_task("wine_ethanol_substance", numeric_frame(vpc), vpc_y, args.output),
    )

    reports["partition_benchmarks"] = {
        "status": "excluded",
        "reason": "Derived train/validation/test transformations of the 12-cut beef workbook; excluded to avoid duplicate evidence.",
    }
    reports["unlabelled_files"] = {
        "status": "excluded",
        "reason": "Files without a defensible target remain available for calibration or unsupervised pretraining.",
    }
    summary = {
        "trained": sum(r.get("status") == "trained" for r in reports.values()),
        "reports": reports,
    }
    (args.output / "suite_report.json").write_text(
        json.dumps(summary, indent=2, default=str), encoding="utf-8"
    )
    print(json.dumps(summary, indent=2, default=str), flush=True)


if __name__ == "__main__":
    main()
