from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

import numpy as np
import pandas as pd


SENSORS = {
    "MQ3": "mq3",
    "MQ5": "mq5",
    "MQ9": "mq9",
    "MQ135": "mq135",
    "MQ137": "mq137",
    "Temperature(°C)": "temperature",
    "Humidity(%)": "humidity",
}
PHYSICAL_BOUNDS = {
    "MQ3": (0.0, 1023.0),
    "MQ5": (0.0, 1023.0),
    "MQ9": (0.0, 1023.0),
    "MQ135": (0.0, 1023.0),
    "MQ137": (0.0, 1023.0),
    "Temperature(°C)": (-10.0, 50.0),
    "Humidity(%)": (0.0, 100.0),
}
STATISTICS = ("mean", "std", "min", "max", "slope", "delta")


def fillet_id(path: Path) -> str:
    match = re.search(r"(F\d+F\d+)$", path.stem, flags=re.IGNORECASE)
    if not match:
        raise ValueError(f"Cannot extract fillet ID from {path.name}")
    return match.group(1).upper()


def split_for(group: str) -> str:
    bucket = int(hashlib.sha256(group.encode("utf-8")).hexdigest()[:8], 16) % 10
    return "test" if bucket == 0 else "val" if bucket == 1 else "train"


def signal_features(values: np.ndarray) -> dict[str, float]:
    x = np.arange(len(values), dtype=float)
    slope = float(np.polyfit(x, values, 1)[0]) if len(values) > 1 else 0.0
    return {
        "mean": float(np.mean(values)),
        "std": float(np.std(values)),
        "min": float(np.min(values)),
        "max": float(np.max(values)),
        "slope": slope,
        "delta": float(values[-1] - values[0]),
    }


def clean_signal(series: pd.Series) -> tuple[np.ndarray, int, int]:
    """Coerce, bound-check and conservatively replace isolated spikes."""
    values = pd.to_numeric(series, errors="coerce").astype(float)
    low, high = PHYSICAL_BOUNDS[str(series.name)]
    invalid = int((values.isna() | ~values.between(low, high)).sum())
    values = values.where(values.between(low, high))
    values = values.interpolate(limit_direction="both")
    if values.isna().any():
        raise ValueError(f"cannot repair invalid values in {series.name}")

    median = values.rolling(window=7, center=True, min_periods=3).median()
    deviation = (values - median).abs()
    mad = deviation.rolling(window=7, center=True, min_periods=3).median()
    name = str(series.name)
    floor = 15.0 if name.startswith("MQ") else 5.0 if name == "Humidity(%)" else 2.0
    threshold = np.maximum(8.0 * 1.4826 * mad.to_numpy(), floor)
    previous = values.shift(1)
    following = values.shift(-1)
    neighbours_agree = (previous - following).abs().to_numpy() <= floor
    # Only repair an isolated impulse; sustained steps and real response trends survive.
    spike_mask = (deviation.to_numpy() > threshold) & neighbours_agree
    corrected = int(spike_mask.sum())
    values.iloc[np.flatnonzero(spike_mask)] = median.iloc[np.flatnonzero(spike_mask)]
    return values.to_numpy(dtype=float), invalid, corrected


def prepare(root: Path, output: Path) -> dict:
    dataset_root = root / "dataset" if (root / "dataset").is_dir() else root
    rows: list[dict[str, object]] = []
    rejected: list[dict[str, str]] = []
    cleaning_audit: list[dict[str, object]] = []
    seen_recordings: dict[str, str] = {}
    for path in sorted(dataset_root.glob("day*/sensors/*.csv")):
        try:
            frame = pd.read_csv(path)
            missing = [column for column in (*SENSORS, "Label") if column not in frame.columns]
            if missing:
                raise ValueError(f"missing columns: {', '.join(missing)}")
            identity = fillet_id(path)
            labels = frame["Label"].astype(str).str.strip().str.lower().unique()
            if len(labels) != 1 or labels[0] not in {"fresh", "spoiled"}:
                raise ValueError("recording must have exactly one Fresh/Spoiled label")
            if len(frame) != 120:
                raise ValueError(f"expected 120 time points, found {len(frame)}")
            tvc = pd.to_numeric(frame["TVC( log CFU/g)"], errors="coerce")
            if tvc.isna().any() or tvc.nunique() != 1:
                raise ValueError("recording must have one valid TVC value")
            expected_label = "spoiled" if float(tvc.iloc[0]) >= 7.0 else "fresh"
            if labels[0] != expected_label:
                raise ValueError(f"label {labels[0]} conflicts with TVC threshold: {tvc.iloc[0]}")

            numeric_signature = (
                frame[list(SENSORS)].apply(pd.to_numeric, errors="coerce").to_csv(index=False)
            )
            signature = hashlib.sha256(numeric_signature.encode("utf-8")).hexdigest()
            if signature in seen_recordings:
                raise ValueError(f"duplicate recording content of {seen_recordings[signature]}")
            seen_recordings[signature] = path.name
            row: dict[str, object] = {
                "sample_id": hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()[:20],
                "recording": path.name,
                "fillet_id": identity,
                "storage_day": int(path.parent.parent.name.removeprefix("day")),
                "freshness_label": labels[0],
                "split": split_for(identity),
            }
            invalid_values = 0
            corrected_spikes = 0
            repeated_rows = int(frame[list(SENSORS)].duplicated().sum())
            for source, name in SENSORS.items():
                values, invalid, corrected = clean_signal(frame[source])
                invalid_values += invalid
                corrected_spikes += corrected
                if len(values) < 2:
                    raise ValueError(f"not enough valid values in {source}")
                if source.startswith("MQ") and np.ptp(values) == 0:
                    raise ValueError(f"flat gas-sensor signal in {source}")
                for statistic, value in signal_features(values).items():
                    row[f"{name}_{statistic}"] = value
            rows.append(row)
            cleaning_audit.append(
                {
                    "recording": path.name,
                    "rows": len(frame),
                    "repeated_adc_rows_preserved": repeated_rows,
                    "invalid_values_repaired": invalid_values,
                    "isolated_spikes_corrected": corrected_spikes,
                    "status": "accepted",
                }
            )
        except (OSError, ValueError, pd.errors.ParserError) as error:
            rejected.append({"recording": str(path), "reason": str(error)})
            cleaning_audit.append(
                {"recording": path.name, "status": "rejected", "reason": str(error)}
            )

    result = pd.DataFrame(rows)
    if result.empty:
        raise RuntimeError("No compatible rainbow-trout sensor recordings were found")
    for split in ("train", "val", "test"):
        if split not in set(result["split"]):
            raise RuntimeError(f"Deterministic fillet split produced no {split} recordings")
    output.parent.mkdir(parents=True, exist_ok=True)
    result.sort_values(["split", "fillet_id", "storage_day"]).to_csv(output, index=False)
    audit_path = output.with_suffix(".cleaning.csv")
    pd.DataFrame(cleaning_audit).to_csv(audit_path, index=False)
    report = {
        "rows": len(result),
        "fillets": int(result["fillet_id"].nunique()),
        "by_split": dict(Counter(result["split"])),
        "fillets_by_split": result.groupby("split")["fillet_id"].nunique().to_dict(),
        "by_label": dict(Counter(result["freshness_label"])),
        "features": [f"{name}_{stat}" for name in SENSORS.values() for stat in STATISTICS],
        "rejected": rejected,
        "cleaning": {
            "source_recordings": len(cleaning_audit),
            "accepted_recordings": len(result),
            "rejected_recordings": len(rejected),
            "invalid_values_repaired": int(
                sum(int(row.get("invalid_values_repaired", 0)) for row in cleaning_audit)
            ),
            "isolated_spikes_corrected": int(
                sum(int(row.get("isolated_spikes_corrected", 0)) for row in cleaning_audit)
            ),
            "repeated_adc_rows_preserved": int(
                sum(int(row.get("repeated_adc_rows_preserved", 0)) for row in cleaning_audit)
            ),
            "audit_file": str(audit_path),
        },
        "label_scope": "Storage-day microbiological status; not individual-fillet ground truth.",
    }
    output.with_suffix(".report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare the rainbow-trout e-nose recordings without fillet leakage."
    )
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.root, args.output)


if __name__ == "__main__":
    main()
