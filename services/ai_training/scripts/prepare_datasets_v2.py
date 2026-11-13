from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

from prepare_detection_all import prepare_detector as prepare_detector_all
from prepare_datasets import (
    IMAGE_SUFFIXES,
    append_file_sample,
    clean_group_stem,
    find_nested_root,
    stable_split,
    valid_yolo_lines,
)


FRESHNESS_MAP = {
    "fresh": "fresh",
    "highlyfresh": "fresh",
    "good": "fresh",
    "ripe": "fresh",
    "mild": "overripe",
    "semifresh": "overripe",
    "semi-fresh": "overripe",
    "notfresh": "overripe",
    "overripe": "overripe",
    "overipe": "overripe",
    "unripe": "unripe",
    "rotten": "rotten",
    "spoiled": "rotten",
}


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def parse_condition(value: str) -> str | None:
    return FRESHNESS_MAP.get(slug(value).replace("_", ""))


def split_for(group: str) -> str:
    return stable_split(group)


def infer_ingredient(path: Path, freshness_root: Path) -> str:
    relative = path.relative_to(freshness_root)
    parts = list(relative.parts)
    for index, part in enumerate(parts[:-1]):
        if parse_condition(part) and index > 0:
            candidate = parts[index - 1]
            break
    else:
        candidate = (
            path.parent.parent.name if parse_condition(path.parent.name) else path.parent.name
        )
    candidate = re.sub(r"^(fresh|rotten|unripe)", "", candidate, flags=re.I)
    candidate = re.sub(r"(db|q)$", "", candidate, flags=re.I)
    return slug(candidate) or "unknown"


def add_folder_dataset(
    rows: list[dict],
    rejected: list[dict],
    root: Path,
    freshness_root: Path,
    source: str,
    max_per_class: int = 600,
) -> None:
    candidates: dict[tuple[str, str], list[Path]] = defaultdict(list)
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        freshness = parse_condition(path.parent.name)
        if freshness is None:
            match = re.match(r"^(fresh|rotten|unripe)", path.parent.name, flags=re.I)
            freshness = parse_condition(match.group(1)) if match else None
        if freshness is None:
            continue
        ingredient = (
            "unknown_fruit" if source == "asad_ripeness" else infer_ingredient(path, freshness_root)
        )
        candidates[(ingredient, freshness)].append(path)
    selected: list[tuple[str, str, Path]] = []
    for (ingredient, freshness), paths in candidates.items():
        # Public collections often contain tens of thousands of augmented derivatives.
        # Deterministic capping retains broad class coverage without allowing one source
        # to dominate training or making every clean run needlessly expensive.
        ordered = sorted(paths, key=lambda path: hashlib.sha256(str(path).encode()).hexdigest())
        selected.extend((ingredient, freshness, path) for path in ordered[:max_per_class])
    print(
        f"Cleaning freshness source {source}: {len(selected):,} selected images",
        flush=True,
    )
    for ingredient, freshness, path in selected:
        append_file_sample(
            rows,
            rejected,
            source=source,
            path=path,
            ingredient=ingredient,
            freshness=freshness,
            group=f"{ingredient}:{clean_group_stem(path.name)}",
        )


def add_box_freshness(
    rows: list[dict],
    rejected: list[dict],
    source: str,
    image_dir: Path,
    label_dir: Path,
    mapping: dict[int, tuple[str, str]],
) -> None:
    for label in sorted(label_dir.glob("*.txt")):
        image = next(
            (
                image_dir / f"{label.stem}{suffix}"
                for suffix in IMAGE_SUFFIXES
                if (image_dir / f"{label.stem}{suffix}").exists()
            ),
            None,
        )
        if image is None:
            continue
        _, boxes, _ = valid_yolo_lines(label)
        for old_class, x, y, w, h in boxes:
            if old_class not in mapping:
                continue
            ingredient, freshness = mapping[old_class]
            append_file_sample(
                rows,
                rejected,
                source=source,
                path=image,
                ingredient=ingredient,
                freshness=freshness,
                group=clean_group_stem(label.name),
                bbox=(x, y, w, h),
            )


def prepare_freshness(freshness_root: Path, output: Path, rejected: list[dict]) -> dict:
    rows: list[dict] = []
    selected_folders = {
        "foodclass2": freshness_root / "FoodClass2",
        "fruq_multi": freshness_root / "FruQ-multi",
        "fruit_quality_original": freshness_root / "Original Image",
        "asad_ripeness": freshness_root / "Fruit Ripeness Dataset Asad Ullah",
    }
    for source, root in selected_folders.items():
        if root.exists():
            add_folder_dataset(rows, rejected, root, freshness_root, source)

    comprehensive = find_nested_root(
        freshness_root
        / "Comprehensive Dataset on Ripening Stages of Strawberries and Avocados From Unripe to Rotten",
        ("images", "labels"),
    )
    add_box_freshness(
        rows,
        rejected,
        "freshness_boxes",
        comprehensive / "images",
        comprehensive / "labels",
        {
            0: ("strawberry", "unripe"),
            1: ("strawberry", "fresh"),
            2: ("strawberry", "fresh"),
            3: ("strawberry", "rotten"),
            4: ("avocado", "unripe"),
            5: ("avocado", "fresh"),
            6: ("avocado", "fresh"),
            7: ("avocado", "rotten"),
        },
    )
    strawberry = find_nested_root(freshness_root / "Strawberry Riupeness", ("images", "labels"))
    add_box_freshness(
        rows,
        rejected,
        "strawberry_boxes",
        strawberry / "images",
        strawberry / "labels",
        {
            0: ("strawberry", "fresh"),
            1: ("strawberry", "fresh"),
            2: ("strawberry", "unripe"),
        },
    )
    tomato = freshness_root / "Tomato_Dataset.v5" / "Tomato_Dataset.v5"
    for source_split in ("train", "valid", "test"):
        add_box_freshness(
            rows,
            rejected,
            f"tomato_{source_split}",
            tomato / source_split / "images",
            tomato / source_split / "labels",
            {
                0: ("tomato", "fresh"),
                1: ("tomato", "rotten"),
            },
        )

    # Global perceptual fingerprints keep exact/near duplicate content in one split even
    # when the same public images occur in two differently named source datasets.
    seen: set[tuple[str, str, str, str]] = set()
    cleaned: list[dict] = []
    for row in rows:
        key = (
            row["ingredient"],
            row["freshness"],
            row["visual_hash"],
            str(row.get("bbox_x_center", "")),
        )
        if key in seen:
            rejected.append(
                {
                    "dataset": "freshness",
                    "source": row["source"],
                    "item": row["path"],
                    "reason": "duplicate_visual_sample",
                }
            )
            continue
        seen.add(key)
        row["group_id"] = f"visual:{row['ingredient']}:{row['visual_hash']}"
        row["split"] = split_for(row["group_id"])
        cleaned.append(row)

    manifest = output / "vision_freshness_manifest.csv"
    fields = list(cleaned[0]) if cleaned else []
    with manifest.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(
            sorted(
                cleaned,
                key=lambda row: (row["split"], row["freshness"], row["sample_id"]),
            )
        )
    return {
        "samples": len(cleaned),
        "by_split": dict(Counter(r["split"] for r in cleaned)),
        "by_freshness": dict(Counter(r["freshness"] for r in cleaned)),
        "by_ingredient": dict(Counter(r["ingredient"] for r in cleaned)),
        "by_source": dict(Counter(r["source"] for r in cleaned)),
    }


def normalized_columns(frame: pd.DataFrame) -> dict[str, str]:
    result = {}
    for column in frame.columns:
        key = slug(str(column)).replace("_", "")
        result[key] = column
    return result


def prepare_enose(root: Path, output: Path, rejected: list[dict]) -> dict:
    common = ["mq2", "mq3", "mq4", "mq5", "mq135", "mq136", "temperature", "humidity"]
    frames: list[pd.DataFrame] = []
    report: list[dict] = []
    candidates = [
        root / "Beef quality 4 classes.csv",
        *(root / "e-nose dataset in uncontrolled ambient conditions").glob("TS*.csv"),
    ]
    for index, path in enumerate(candidates):
        try:
            frame = pd.read_csv(path)
            columns = normalized_columns(frame)
            class_column = columns.get("class")
            if class_column is None or any(name not in columns for name in common):
                raise ValueError("missing freshness class or common MQ/DHT columns")
            clean = pd.DataFrame(
                {name: pd.to_numeric(frame[columns[name]], errors="coerce") for name in common}
            )
            raw_labels = frame[class_column].astype(str).str.strip().str.lower()
            numeric_map = {
                "1": "excellent",
                "2": "good",
                "3": "acceptable",
                "4": "spoiled",
                "1.0": "excellent",
                "2.0": "good",
                "3.0": "acceptable",
                "4.0": "spoiled",
            }
            clean["freshness_label"] = raw_labels.map(lambda value: numeric_map.get(value, value))
            clean["recording"] = path.name
            clean["split"] = (
                "test"
                if index == len(candidates) - 1
                else "val"
                if index == len(candidates) - 2
                else "train"
            )
            before = len(clean)
            clean = clean.dropna(subset=common)
            clean = clean[
                clean["freshness_label"].isin({"excellent", "good", "acceptable", "spoiled"})
            ]
            frames.append(clean)
            report.append(
                {
                    "recording": path.name,
                    "rows": len(clean),
                    "rejected_rows": before - len(clean),
                    "split": clean["split"].iloc[0] if len(clean) else "",
                }
            )
        except (OSError, ValueError, pd.errors.ParserError) as error:
            rejected.append(
                {
                    "dataset": "enose",
                    "source": "beef",
                    "item": str(path),
                    "reason": str(error),
                }
            )

    if not frames:
        raise RuntimeError(
            "No compatible labelled MQ + temperature/humidity e-nose files were found"
        )
    combined = pd.concat(frames, ignore_index=True)
    combined.insert(
        0,
        "sample_id",
        [
            hashlib.sha256(f"{row.recording}:{i}".encode()).hexdigest()[:20]
            for i, row in combined.iterrows()
        ],
    )
    combined.to_csv(output / "enose_spoilage.csv", index=False)
    pd.DataFrame(report).to_csv(output / "enose_recording_report.csv", index=False)

    # Retain D1-D5 recordings separately. These are progression data, not safety labels.
    day_files = list((root / "Food-Freshness-E-Nose-Dataset").rglob("* D[1-5].csv"))
    pd.DataFrame(
        {
            "path": [str(path) for path in day_files],
            "label_status": "collection_day_only",
        }
    ).to_csv(output / "enose_day_recordings.csv", index=False)
    return {
        "rows": len(combined),
        "recordings": len(report),
        "by_split": dict(Counter(combined["split"])),
        "by_label": dict(Counter(combined["freshness_label"])),
        "features": common,
        "day_recordings_excluded_from_safety_model": len(day_files),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--detection-root", type=Path, required=True)
    parser.add_argument("--freshness-root", type=Path, required=True)
    parser.add_argument("--enose-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--max-derived-per-class",
        type=int,
        default=600,
        help="Maximum foreground-derived detector images per source/class; 0 keeps all.",
    )
    parser.add_argument(
        "--max-grapenet-variants",
        type=int,
        default=3,
        help="Maximum augmented GrapeNet variants retained per original capture; 0 keeps all.",
    )
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    rejected: list[dict] = []
    report = {
        "architecture": {
            "ingredient_detector": "ingredient identity and bounding boxes",
            "visual_freshness": "freshness classification on detector crops",
            "enose_spoilage": "independent MQ + temperature/humidity spoilage model",
        },
        "ingredient_detection": prepare_detector_all(
            args.detection_root,
            args.freshness_root,
            args.output,
            rejected,
            max_derived_per_class=args.max_derived_per_class,
            max_grapenet_variants=args.max_grapenet_variants,
        ),
        "visual_freshness": prepare_freshness(args.freshness_root, args.output, rejected),
        "enose_spoilage": prepare_enose(args.enose_root, args.output, rejected),
        "detector_source_accounting": "See ingredient_detection/source_inventory.csv and annotation_queue.csv.",
        "excluded": {
            "unsafe detector images": "kept in annotation_queue.csv until reviewed instance boxes exist",
            "duplicate image trees": "recorded in source_inventory.csv and not counted twice",
            "non-visual files": "recorded in source_inventory.csv; they cannot train YOLO26",
            "D1-D5 sensor labels": "elapsed collection days are not verified safe/spoiled labels",
        },
    }
    fields = ["dataset", "source", "item", "reason"]
    with (args.output / "rejected_samples.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rejected)
    report["rejected_samples"] = len(rejected)
    (args.output / "dataset_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
