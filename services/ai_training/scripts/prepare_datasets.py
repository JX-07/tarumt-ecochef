from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import shutil
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
from PIL import Image, UnidentifiedImageError


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}
MQ_COLUMNS = ["MQ2", "MQ3", "MQ4", "MQ5", "MQ6", "MQ7", "MQ8", "MQ9", "MQ135"]
DETECTION_CLASSES = [
    "strawberry_unripe",
    "strawberry_partially_ripe",
    "strawberry_ripe",
    "strawberry_rotten",
    "avocado_unripe",
    "avocado_partially_ripe",
    "avocado_ripe",
    "avocado_rotten",
]
COMPREHENSIVE_LABELS = {
    0: ("strawberry", "unripe"),
    1: ("strawberry", "fresh"),
    2: ("strawberry", "fresh"),
    3: ("strawberry", "rotten"),
    4: ("avocado", "unripe"),
    5: ("avocado", "fresh"),
    6: ("avocado", "fresh"),
    7: ("avocado", "rotten"),
}
STRAWBERRY_LABELS = {
    0: (2, "strawberry", "fresh"),
    1: (1, "strawberry", "fresh"),
    2: (0, "strawberry", "unripe"),
}
FOLDER_LABELS = {
    "freshapples": ("apple", "fresh"),
    "freshbanana": ("banana", "fresh"),
    "freshoranges": ("orange", "fresh"),
    "rottenapples": ("apple", "rotten"),
    "rottenbanana": ("banana", "rotten"),
    "rottenoranges": ("orange", "rotten"),
    "unripe apple": ("apple", "unripe"),
    "unripe banana": ("banana", "unripe"),
    "unripe orange": ("orange", "unripe"),
}


def stable_split(group_id: str) -> str:
    value = int(hashlib.sha256(group_id.encode("utf-8")).hexdigest()[:8], 16) % 100
    return "train" if value < 80 else "val" if value < 90 else "test"


def balanced_group_splits(groups: Iterable[str]) -> dict[str, str]:
    ordered = sorted(
        set(groups), key=lambda value: hashlib.sha256(value.encode("utf-8")).hexdigest()
    )
    if len(ordered) < 3:
        return {group: "train" for group in ordered}
    validation_count = max(1, round(len(ordered) * 0.1))
    test_count = max(1, round(len(ordered) * 0.1))
    train_count = len(ordered) - validation_count - test_count
    return {
        group: "train"
        if index < train_count
        else "val"
        if index < train_count + validation_count
        else "test"
        for index, group in enumerate(ordered)
    }


def stratified_detection_splits(samples: list[dict]) -> dict[str, str]:
    group_classes: dict[str, Counter] = defaultdict(Counter)
    for sample in samples:
        group_classes[sample["group"]].update(sample["classes"])
    groups_by_dominant_class: dict[int, list[str]] = defaultdict(list)
    for group, classes in group_classes.items():
        dominant = classes.most_common(1)[0][0]
        groups_by_dominant_class[dominant].append(group)
    result: dict[str, str] = {}
    for groups in groups_by_dominant_class.values():
        result.update(balanced_group_splits(groups))
    return result


def clean_group_stem(name: str) -> str:
    stem = Path(name).stem.lower()
    stem = re.sub(r"\.rf\.[0-9a-f]+$", "", stem)
    stem = re.sub(r"^(rotated_by_\d+_|vertical_flip_|horizontal_flip_)", "", stem)
    stem = re.sub(
        r"_(brightness_contrast|horizontal_flip|vertical_flip|rgb_shift|rotate|gamma)_iter\d+$",
        "",
        stem,
    )
    return re.sub(r"[^a-z0-9]+", "_", stem).strip("_")


def image_info(path: Path) -> tuple[int, int, str]:
    with Image.open(path) as image:
        image.load()
        width, height = image.size
        thumbnail = image.convert("L").resize((16, 16))
        visual_hash = hashlib.sha256(thumbnail.tobytes()).hexdigest()[:20]
    if width < 32 or height < 32:
        raise ValueError("image is smaller than 32x32")
    return width, height, visual_hash


def zip_image_info(zipped: zipfile.ZipFile, member: str) -> tuple[int, int, str]:
    with zipped.open(member) as handle, Image.open(handle) as image:
        image.load()
        width, height = image.size
        thumbnail = image.convert("L").resize((16, 16))
        visual_hash = hashlib.sha256(thumbnail.tobytes()).hexdigest()[:20]
    if width < 32 or height < 32:
        raise ValueError("image is smaller than 32x32")
    return width, height, visual_hash


def valid_yolo_lines(
    label_path: Path, class_map: dict[int, int] | None = None
) -> tuple[list[str], list[tuple[int, float, float, float, float]], list[str]]:
    cleaned: list[str] = []
    boxes: list[tuple[int, float, float, float, float]] = []
    problems: list[str] = []
    seen_boxes: set[tuple[int, float, float, float, float]] = set()
    for line_number, raw in enumerate(
        label_path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1
    ):
        if not raw.strip():
            continue
        fields = raw.split()
        try:
            if len(fields) < 5:
                raise ValueError("expected a YOLO box or segmentation polygon")
            source_class = int(fields[0])
            values = [float(value) for value in fields[1:]]
            if class_map is not None and source_class not in class_map:
                raise ValueError(f"unknown class {source_class}")
            output_class = class_map[source_class] if class_map is not None else source_class
            if len(values) == 4:
                x_center, y_center, width, height = values
            elif len(values) >= 6 and len(values) % 2 == 0:
                x_values, y_values = values[0::2], values[1::2]
                left, right, top, bottom = (
                    min(x_values),
                    max(x_values),
                    min(y_values),
                    max(y_values),
                )
                x_center, y_center = (left + right) / 2, (top + bottom) / 2
                width, height = right - left, bottom - top
            else:
                raise ValueError("segmentation polygon must contain x/y coordinate pairs")
            if not all(np.isfinite(values)) or not (
                0 <= x_center <= 1 and 0 <= y_center <= 1 and 0 < width <= 1 and 0 < height <= 1
            ):
                raise ValueError("box is outside normalized YOLO bounds")
            box_key = (
                output_class,
                round(x_center, 7),
                round(y_center, 7),
                round(width, 7),
                round(height, 7),
            )
            if box_key in seen_boxes:
                problems.append(f"line {line_number}: duplicate bounding box removed")
                continue
            seen_boxes.add(box_key)
            cleaned.append(f"{output_class} {x_center:.7f} {y_center:.7f} {width:.7f} {height:.7f}")
            boxes.append((source_class, x_center, y_center, width, height))
        except ValueError as error:
            problems.append(f"line {line_number}: {error}")
    return cleaned, boxes, problems


def link_or_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        return
    try:
        os.link(source, destination)
    except OSError:
        shutil.copy2(source, destination)


def find_nested_root(parent: Path, required: Iterable[str]) -> Path:
    required_set = set(required)
    candidates = [parent, *[path for path in parent.rglob("*") if path.is_dir()]]
    for candidate in candidates:
        if required_set.issubset({child.name for child in candidate.iterdir()}):
            return candidate
    raise FileNotFoundError(f"Could not find {sorted(required_set)} below {parent}")


def prepare_detection(vision_root: Path, output: Path, rejected: list[dict]) -> dict:
    detection_root = output / "vision_detection"
    if detection_root.exists():
        shutil.rmtree(detection_root)
    for split in ("train", "val", "test"):
        (detection_root / "images" / split).mkdir(parents=True, exist_ok=True)
        (detection_root / "labels" / split).mkdir(parents=True, exist_ok=True)

    sources: list[tuple[str, Path, dict[int, int] | None]] = []
    comprehensive_parent = (
        vision_root
        / "Comprehensive Dataset on Ripening Stages of Strawberries and Avocados From Unripe to Rotten"
    )
    comprehensive = find_nested_root(comprehensive_parent, ("images", "labels"))
    sources.append(("comprehensive", comprehensive, None))
    strawberry = find_nested_root(vision_root / "Strawberry Riupeness", ("images", "labels"))
    sources.append(
        (
            "strawberry",
            strawberry,
            {key: value[0] for key, value in STRAWBERRY_LABELS.items()},
        )
    )

    counts = Counter()
    for source_name, source_root, class_map in sources:
        image_by_stem = {
            path.stem: path
            for path in (source_root / "images").iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
        }
        label_by_stem = {path.stem: path for path in (source_root / "labels").glob("*.txt")}
        for orphan in sorted(set(label_by_stem) - set(image_by_stem)):
            rejected.append(
                {
                    "dataset": "vision_detection",
                    "source": source_name,
                    "item": orphan,
                    "reason": "label_without_image",
                }
            )
        for orphan in sorted(set(image_by_stem) - set(label_by_stem)):
            rejected.append(
                {
                    "dataset": "vision_detection",
                    "source": source_name,
                    "item": orphan,
                    "reason": "image_without_label",
                }
            )
        source_samples: list[dict] = []
        for stem in sorted(set(image_by_stem) & set(label_by_stem)):
            image_path, label_path = image_by_stem[stem], label_by_stem[stem]
            try:
                image_info(image_path)
                cleaned, boxes, problems = valid_yolo_lines(label_path, class_map)
                if problems:
                    for problem in problems:
                        rejected.append(
                            {
                                "dataset": "vision_detection",
                                "source": source_name,
                                "item": label_path.name,
                                "reason": problem,
                            }
                        )
                if not cleaned:
                    raise ValueError("no valid bounding boxes")
                if source_name == "comprehensive":
                    match = re.search(r"(\d+)$", stem)
                    # Adjacent capture pairs stay together while the small rotten subsets still
                    # retain enough independent groups for meaningful validation and test slices.
                    group = f"comprehensive_sequence_{int(match.group(1)) // 2 if match else clean_group_stem(stem)}"
                else:
                    group = f"strawberry_{clean_group_stem(stem)[:15]}"
                source_samples.append(
                    {
                        "stem": stem,
                        "image_path": image_path,
                        "cleaned": cleaned,
                        "boxes": boxes,
                        "classes": [int(line.split()[0]) for line in cleaned],
                        "group": group,
                    }
                )
            except (OSError, ValueError, UnidentifiedImageError) as error:
                rejected.append(
                    {
                        "dataset": "vision_detection",
                        "source": source_name,
                        "item": image_path.name,
                        "reason": str(error),
                    }
                )
        split_by_group = stratified_detection_splits(source_samples)
        for sample in source_samples:
            split = split_by_group[sample["group"]]
            destination_stem = f"{source_name}_{sample['stem']}"
            image_path = sample["image_path"]
            link_or_copy(
                image_path,
                detection_root
                / "images"
                / split
                / f"{destination_stem}{image_path.suffix.lower()}",
            )
            (detection_root / "labels" / split / f"{destination_stem}.txt").write_text(
                "\n".join(sample["cleaned"]) + "\n", encoding="utf-8"
            )
            counts[f"images_{split}"] += 1
            counts["boxes"] += len(sample["boxes"])

    yaml_lines = [
        f"path: {detection_root.as_posix()}",
        "train: images/train",
        "val: images/val",
        "test: images/test",
        f"nc: {len(DETECTION_CLASSES)}",
        "names:",
        *[f"  {index}: {name}" for index, name in enumerate(DETECTION_CLASSES)],
    ]
    (detection_root / "dataset.yaml").write_text("\n".join(yaml_lines) + "\n", encoding="utf-8")
    return dict(counts)


def append_file_sample(
    rows: list[dict],
    rejected: list[dict],
    *,
    source: str,
    path: Path,
    ingredient: str,
    freshness: str,
    group: str,
    bbox: tuple[float, float, float, float] | None = None,
) -> None:
    try:
        width, height, visual_hash = image_info(path)
        x_center, y_center, box_width, box_height = bbox or (None, None, None, None)
        rows.append(
            {
                "sample_id": hashlib.sha256(f"{source}|{path}|{bbox}".encode()).hexdigest()[:20],
                "source": source,
                "path": str(path),
                "archive_member": "",
                "ingredient": ingredient,
                "freshness": freshness,
                "group_id": f"{source}:{group}",
                "split": stable_split(f"{source}:{group}"),
                "width": width,
                "height": height,
                "visual_hash": visual_hash,
                "bbox_x_center": x_center,
                "bbox_y_center": y_center,
                "bbox_width": box_width,
                "bbox_height": box_height,
            }
        )
    except (OSError, ValueError, UnidentifiedImageError) as error:
        rejected.append(
            {
                "dataset": "vision_freshness",
                "source": source,
                "item": str(path),
                "reason": str(error),
            }
        )


def prepare_vision_classification(
    vision_root: Path, output: Path, rejected: list[dict], max_variants: int
) -> dict:
    rows: list[dict] = []

    canonical = (
        vision_root
        / "Fruit Ripeness, Unripe, Ripe, Rotten"
        / "fruit_ripeness_dataset"
        / "archive (1)"
        / "dataset"
        / "dataset"
    )
    for source_split in ("train", "test"):
        for class_dir in sorted((canonical / source_split).iterdir()):
            if not class_dir.is_dir() or class_dir.name.lower() not in FOLDER_LABELS:
                continue
            ingredient, freshness = FOLDER_LABELS[class_dir.name.lower()]
            for path in sorted(class_dir.iterdir()):
                if path.suffix.lower() in IMAGE_SUFFIXES:
                    append_file_sample(
                        rows,
                        rejected,
                        source="fruit_ripeness",
                        path=path,
                        ingredient=ingredient,
                        freshness=freshness,
                        group=clean_group_stem(path.name),
                    )

    asad = vision_root / "Fruit Ripeness Dataset Asad Ullah"
    asad_labels = {
        "unripe": "unripe",
        "ripe": "fresh",
        "overripe": "overripe",
        "overipe": "overripe",
    }
    for path in sorted(asad.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        freshness = asad_labels.get(path.parent.name.lower())
        if freshness:
            append_file_sample(
                rows,
                rejected,
                source="asad_ripeness",
                path=path,
                ingredient="unknown_fruit",
                freshness=freshness,
                group=clean_group_stem(path.name),
            )

    comprehensive = find_nested_root(
        vision_root
        / "Comprehensive Dataset on Ripening Stages of Strawberries and Avocados From Unripe to Rotten",
        ("images", "labels"),
    )
    for label_path in sorted((comprehensive / "labels").glob("*.txt")):
        image_path = next(
            (
                comprehensive / "images" / f"{label_path.stem}{suffix}"
                for suffix in IMAGE_SUFFIXES
                if (comprehensive / "images" / f"{label_path.stem}{suffix}").exists()
            ),
            None,
        )
        if image_path is None:
            continue
        _, boxes, _ = valid_yolo_lines(label_path)
        for source_class, x_center, y_center, width, height in boxes:
            if source_class not in COMPREHENSIVE_LABELS:
                continue
            ingredient, freshness = COMPREHENSIVE_LABELS[source_class]
            match = re.search(r"(\d+)$", label_path.stem)
            group = f"sequence_{int(match.group(1)) // 25 if match else clean_group_stem(label_path.name)}"
            append_file_sample(
                rows,
                rejected,
                source="comprehensive",
                path=image_path,
                ingredient=ingredient,
                freshness=freshness,
                group=group,
                bbox=(x_center, y_center, width, height),
            )

    strawberry = find_nested_root(vision_root / "Strawberry Riupeness", ("images", "labels"))
    for label_path in sorted((strawberry / "labels").glob("*.txt")):
        image_path = strawberry / "images" / f"{label_path.stem}.jpg"
        if not image_path.exists():
            continue
        _, boxes, _ = valid_yolo_lines(label_path)
        for source_class, x_center, y_center, width, height in boxes:
            if source_class not in STRAWBERRY_LABELS:
                continue
            _, ingredient, freshness = STRAWBERRY_LABELS[source_class]
            append_file_sample(
                rows,
                rejected,
                source="strawberry_ripeness",
                path=image_path,
                ingredient=ingredient,
                freshness=freshness,
                group=clean_group_stem(label_path.name),
                bbox=(x_center, y_center, width, height),
            )

    grape_root = vision_root / "GrapeNet An Image Dataset for Grape Variety and Qu"
    for archive in sorted(grape_root.rglob("*.zip")):
        freshness = "rotten" if "rotten" in archive.stem.lower() else "fresh"
        source = "grapenet"
        try:
            with zipfile.ZipFile(archive) as zipped:
                members = sorted(
                    member
                    for member in zipped.namelist()
                    if Path(member).suffix.lower() in IMAGE_SUFFIXES
                )
                grouped: dict[str, list[str]] = defaultdict(list)
                for member in members:
                    grouped[clean_group_stem(Path(member).name)].append(member)
                selected = [
                    member
                    for group_members in grouped.values()
                    for member in group_members[:max_variants]
                ]
                for member in selected:
                    group = clean_group_stem(Path(member).name)
                    try:
                        width, height, visual_hash = zip_image_info(zipped, member)
                        rows.append(
                            {
                                "sample_id": hashlib.sha256(
                                    f"{archive}|{member}".encode()
                                ).hexdigest()[:20],
                                "source": source,
                                "path": str(archive),
                                "archive_member": member,
                                "ingredient": "grape",
                                "freshness": freshness,
                                "group_id": f"{source}:{group}",
                                "split": stable_split(f"{source}:{group}"),
                                "width": width,
                                "height": height,
                                "visual_hash": visual_hash,
                                "bbox_x_center": "",
                                "bbox_y_center": "",
                                "bbox_width": "",
                                "bbox_height": "",
                            }
                        )
                    except (
                        OSError,
                        ValueError,
                        UnidentifiedImageError,
                        zipfile.BadZipFile,
                    ) as error:
                        rejected.append(
                            {
                                "dataset": "vision_freshness",
                                "source": source,
                                "item": f"{archive}!{member}",
                                "reason": str(error),
                            }
                        )
        except zipfile.BadZipFile as error:
            rejected.append(
                {
                    "dataset": "vision_freshness",
                    "source": source,
                    "item": str(archive),
                    "reason": str(error),
                }
            )

    # Keep only a few deterministic augmented variants of the same original capture.
    capped: list[dict] = []
    grouped_rows: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for row in rows:
        grouped_rows[(row["source"], row["group_id"], row["freshness"])].append(row)
    for group_rows in grouped_rows.values():
        limit = (
            max_variants
            if group_rows[0]["source"] in {"fruit_ripeness", "grapenet"}
            else len(group_rows)
        )
        capped.extend(sorted(group_rows, key=lambda row: row["sample_id"])[:limit])

    manifest = output / "vision_freshness_manifest.csv"
    fields = (
        list(capped[0])
        if capped
        else [
            "sample_id",
            "source",
            "path",
            "archive_member",
            "ingredient",
            "freshness",
            "group_id",
            "split",
        ]
    )
    with manifest.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(
            sorted(
                capped,
                key=lambda row: (row["split"], row["freshness"], row["sample_id"]),
            )
        )
    return {
        "samples": len(capped),
        "by_split": dict(Counter(row["split"] for row in capped)),
        "by_freshness": dict(Counter(row["freshness"] for row in capped)),
        "by_ingredient": dict(Counter(row["ingredient"] for row in capped)),
        "by_source": dict(Counter(row["source"] for row in capped)),
    }


def sensor_label(path: Path) -> tuple[str, int | None]:
    stem = re.sub(r"\s+", " ", path.stem.strip())
    match = re.fullmatch(r"(.+?)\s+[dD](\d+)", stem)
    if match:
        return match.group(1).strip().lower(), int(match.group(2))
    words = re.sub(r"(?<!^)([A-Z])", r" \1", stem).lower()
    return re.sub(r"\s+", " ", words).strip(), None


def sensor_window_features(
    frame: pd.DataFrame, start_tick: float, end_tick: float
) -> dict[str, float]:
    window = frame[(frame["Ticks"] >= start_tick) & (frame["Ticks"] < end_tick)]
    features: dict[str, float] = {"window_rows": float(len(window))}
    relative_seconds = (window["Ticks"].to_numpy(dtype=float) - window["Ticks"].iloc[0]) / 1000.0
    for column in MQ_COLUMNS:
        values = window[column].to_numpy(dtype=float)
        features[f"{column.lower()}_mean"] = float(np.mean(values))
        features[f"{column.lower()}_std"] = float(np.std(values))
        features[f"{column.lower()}_min"] = float(np.min(values))
        features[f"{column.lower()}_max"] = float(np.max(values))
        features[f"{column.lower()}_median"] = float(np.median(values))
        features[f"{column.lower()}_delta"] = float(values[-1] - values[0])
        features[f"{column.lower()}_slope"] = (
            float(np.polyfit(relative_seconds, values, 1)[0])
            if len(values) >= 2 and relative_seconds[-1] > 0
            else 0.0
        )
    return features


def prepare_enose(
    enose_root: Path,
    output: Path,
    rejected: list[dict],
    window_seconds: int,
    step_seconds: int,
    warmup_seconds: int,
) -> dict:
    csv_files = sorted(enose_root.rglob("*.csv"))
    labeled_ingredients = sorted(
        {sensor_label(path)[0] for path in csv_files if sensor_label(path)[1] is not None}
    )
    rng = np.random.default_rng(42)
    shuffled = list(labeled_ingredients)
    rng.shuffle(shuffled)
    train_count = max(1, int(len(shuffled) * 0.7))
    val_count = max(1, int(len(shuffled) * 0.15))
    split_by_ingredient = {ingredient: "train" for ingredient in shuffled[:train_count]}
    split_by_ingredient.update(
        {ingredient: "val" for ingredient in shuffled[train_count : train_count + val_count]}
    )
    split_by_ingredient.update(
        {ingredient: "test" for ingredient in shuffled[train_count + val_count :]}
    )

    windows: list[dict] = []
    reports: list[dict] = []
    for path in csv_files:
        ingredient, freshness_day = sensor_label(path)
        try:
            frame = pd.read_csv(path)
            original_rows = len(frame)
            if list(frame.columns) != ["Ticks", *MQ_COLUMNS]:
                raise ValueError(f"unexpected columns: {list(frame.columns)}")
            for column in frame.columns:
                frame[column] = pd.to_numeric(frame[column], errors="coerce")
            invalid_rows = int(
                frame.isna().any(axis=1).sum()
                + np.isinf(frame.to_numpy(dtype=float)).any(axis=1).sum()
            )
            frame = frame.replace([np.inf, -np.inf], np.nan).dropna()
            duplicate_rows = int(frame.duplicated().sum())
            frame = frame.drop_duplicates().sort_values("Ticks")
            duplicate_ticks = int(frame.duplicated(subset=["Ticks"]).sum())
            frame = frame.drop_duplicates(subset=["Ticks"], keep="first")
            if len(frame) < 2:
                raise ValueError("fewer than two valid rows")
            tick_delta = frame["Ticks"].diff().dropna()
            duration_seconds = float((frame["Ticks"].iloc[-1] - frame["Ticks"].iloc[0]) / 1000.0)
            report = {
                "recording": path.name,
                "ingredient": ingredient,
                "freshness_day": freshness_day if freshness_day is not None else "",
                "labeled": freshness_day is not None,
                "original_rows": original_rows,
                "clean_rows": len(frame),
                "invalid_rows": invalid_rows,
                "duplicate_rows": duplicate_rows,
                "duplicate_ticks": duplicate_ticks,
                "duration_seconds": round(duration_seconds, 3),
                "median_sample_interval_ms": round(float(tick_delta.median()), 3),
                "temperature_available": False,
                "humidity_available": False,
            }
            reports.append(report)
            start = float(frame["Ticks"].iloc[0] + warmup_seconds * 1000)
            final_tick = float(frame["Ticks"].iloc[-1])
            window_index = 0
            while start + window_seconds * 1000 <= final_tick:
                end = start + window_seconds * 1000
                selected = frame[(frame["Ticks"] >= start) & (frame["Ticks"] < end)]
                if len(selected) >= 20:
                    features = sensor_window_features(frame, start, end)
                    features.update(
                        {
                            "sample_id": hashlib.sha256(f"{path}|{start}".encode()).hexdigest()[
                                :20
                            ],
                            "recording": path.name,
                            "ingredient": ingredient,
                            "freshness_day": freshness_day if freshness_day is not None else "",
                            "split": split_by_ingredient.get(ingredient, "unlabeled"),
                            "window_index": window_index,
                            "window_start_seconds": round(
                                (start - float(frame["Ticks"].iloc[0])) / 1000.0, 3
                            ),
                        }
                    )
                    windows.append(features)
                start += step_seconds * 1000
                window_index += 1
        except (OSError, ValueError, pd.errors.ParserError) as error:
            rejected.append(
                {
                    "dataset": "enose",
                    "source": "csv",
                    "item": str(path),
                    "reason": str(error),
                }
            )

    report_frame = pd.DataFrame(reports)
    window_frame = pd.DataFrame(windows)
    report_frame.to_csv(output / "enose_recording_report.csv", index=False)
    labeled = window_frame[window_frame["freshness_day"] != ""].copy()
    unlabeled = window_frame[window_frame["freshness_day"] == ""].copy()
    if not labeled.empty:
        labeled["freshness_day"] = labeled["freshness_day"].astype(int)
    labeled.to_csv(output / "enose_windows.csv", index=False)
    unlabeled.to_csv(output / "enose_unlabeled_windows.csv", index=False)
    return {
        "recordings": len(reports),
        "labeled_recordings": int(report_frame["labeled"].sum()) if not report_frame.empty else 0,
        "labeled_windows": len(labeled),
        "unlabeled_windows": len(unlabeled),
        "split_ingredients": {
            split: sorted([key for key, value in split_by_ingredient.items() if value == split])
            for split in ("train", "val", "test")
        },
        "by_day": {
            str(key): int(value)
            for key, value in labeled["freshness_day"].value_counts().sort_index().items()
        }
        if not labeled.empty
        else {},
        "dht_columns_present": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Clean and split EcoChef vision and electronic-nose datasets."
    )
    parser.add_argument("--vision-root", type=Path, required=True)
    parser.add_argument("--enose-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-variants-per-group", type=int, default=3)
    parser.add_argument("--window-seconds", type=int, default=10)
    parser.add_argument("--step-seconds", type=int, default=5)
    parser.add_argument("--warmup-seconds", type=int, default=30)
    args = parser.parse_args()
    if not args.vision_root.is_dir() or not args.enose_root.is_dir():
        parser.error("Both dataset roots must exist and be directories.")
    args.output.mkdir(parents=True, exist_ok=True)
    rejected: list[dict] = []
    report = {
        "vision_source": str(args.vision_root.resolve()),
        "enose_source": str(args.enose_root.resolve()),
        "vision_detection": prepare_detection(args.vision_root, args.output, rejected),
        "vision_freshness": prepare_vision_classification(
            args.vision_root, args.output, rejected, args.max_variants_per_group
        ),
        "enose": prepare_enose(
            args.enose_root,
            args.output,
            rejected,
            args.window_seconds,
            args.step_seconds,
            args.warmup_seconds,
        ),
        "excluded_sources": {
            "Food-Freshness-E-Nose-Dataset": "exact duplicate of the separately supplied electronic-nose folder",
            "Fruit Fresh and rotten Classification": "duplicated subset of Fruit Ripeness, Unripe, Ripe, Rotten",
        },
        "notes": [
            "Visual splits are assigned by original capture group, not by augmented image.",
            "Electronic-nose splits hold out whole ingredient types to reduce recording leakage.",
            "D1-D5 are retained as collection-day labels; they are not renamed to safe/spoiled.",
            "No DHT temperature or humidity columns were present in the supplied sensor CSV files.",
            "The supplied bounding-box data covers strawberry and avocado only; classification folders cannot support all-ingredient localization without new box annotations.",
        ],
    }
    rejected_path = args.output / "rejected_samples.csv"
    with rejected_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["dataset", "source", "item", "reason"])
        writer.writeheader()
        writer.writerows(rejected)
    report["rejected_samples"] = len(rejected)
    (args.output / "dataset_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
