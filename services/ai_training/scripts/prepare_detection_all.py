from __future__ import annotations

import csv
import ast
import hashlib
import json
import os
import re
import shutil
import zipfile
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

from prepare_datasets import (
    IMAGE_SUFFIXES,
    clean_group_stem,
    link_or_copy,
    valid_yolo_lines,
)


# Keep the original Objects365 order stable so existing application labels do not move.
# Newly discovered ingredient classes are appended alphabetically.
BASE_CLASS_ALIASES = {
    "other_fish": "other_fish",
    "orange_tangerine": "orange_tangerine",
    "green_vegetables": "green_vegetables",
    "green_beans": "green_beans",
    "green_onion": "green_onion",
    "kiwi_fruit": "kiwi_fruit",
    "meat_ball": "meat_ball",
    "red_cabbage": "red_cabbage",
}

# Ordered longest/specific-first. These collapse varieties and spelling variants to
# ingredient identities suitable for the EcoChef inventory rather than cultivar IDs.
INGREDIENT_PATTERNS: list[tuple[tuple[str, ...], str]] = [
    (("red cabbage",), "red_cabbage"),
    (("green onion", "spring onion", "scallion"), "green_onion"),
    (("green bean", "bean"), "green_beans"),
    (("silver barb", "mackerel", "tilapia", "tuna", "fish eye", "fish"), "other_fish"),
    (("bell pepper", "bellpepper", "capsicum", "peper", "pepper"), "pepper"),
    (("sweet potato",), "potato"),
    (
        (
            "orange tangerine",
            "mandarine",
            "mandarin",
            "clementine",
            "satsuma",
            "tangelo",
            "tangerine",
            "orange",
        ),
        "orange_tangerine",
    ),
    (("kiwi fruit", "kiwi"), "kiwi_fruit"),
    (
        ("hamimelon", "hami melon", "honeydew", "galia melon", "cantaloupe", "melon"),
        "hamimelon",
    ),
    (("pineapple", "ananas"), "pineapple"),
    (("coconut", "cocos"), "coconut"),
    (("eggplant", "aubergine", "brinjal"), "eggplant"),
    (("passion fruit", "maracuja"), "passion_fruit"),
    (("dragon fruit", "pitahaya"), "dragon_fruit"),
    (("persimmon", "kaki", "kachi"), "persimmon"),
    (("red beet", "beetroot", "beet"), "beetroot"),
    (("bitter gourd", "bittergourd"), "bittergourd"),
    (("zucchini", "courgette"), "zucchini"),
    (("mushroom", "champignon"), "mushroom"),
    (("green chilly", "green chili", "chilli", "chili"), "chili_pepper"),
    (("green leaves", "spinach"), "spinach"),
    (("cauliflower",), "cauliflower"),
    (("pomegranate",), "pomegranate"),
    (("strawberry", "stawberry"), "strawberry"),
    (("blackberry", "blackberrie"), "blackberry"),
    (("blueberry", "blue berry"), "blueberry"),
    (("raspberry",), "raspberry"),
    (("huckleberry",), "huckleberry"),
    (("gooseberry",), "gooseberry"),
    (("redcurrant", "red currant", "currant"), "redcurrant"),
    (("watermelon", "watermelo"), "watermelon"),
    (("grapefruit", "pomelo"), "grapefruit"),
    (("nectarine",), "nectarine"),
    (("pistachio",), "pistachio"),
    (
        (
            "hazelnut",
            "walnut",
            "almonds",
            "almond",
            "chestnut",
            "pecan",
            "caju",
            "peanut",
            "nut",
        ),
        "nuts",
    ),
    (("green vegetable",), "green_vegetables"),
    (("meat ball", "meatball"), "meat_ball"),
    (("grape",), "grape"),
    (("apple",), "apple"),
    (("apricot",), "apricot"),
    (("avocado",), "avocado"),
    (("banana",), "banana"),
    (("broccoli",), "broccoli"),
    (("cabbage",), "cabbage"),
    (("cactus fruit",), "cactus_fruit"),
    (("carambola", "star fruit"), "carambola"),
    (("carrot",), "carrot"),
    (("celery",), "celery"),
    (("cherimoya",), "cherimoya"),
    (("cherry",), "cherry"),
    (("corn",), "corn"),
    (("cucumber",), "cucumber"),
    (("dates", "date"), "dates"),
    (("durian",), "durian"),
    (("fig",), "fig"),
    (("garlic",), "garlic"),
    (("ginger",), "ginger"),
    (("granadilla",), "granadilla"),
    (("grape",), "grape"),
    (("guava",), "guava"),
    (("jujube",), "jujube"),
    (("kohlrabi",), "kohlrabi"),
    (("kumquats", "kumquat", "kumsquat"), "kumquat"),
    (("leek",), "leek"),
    (("lemons", "lemon", "limes", "lime"), "lemon"),
    (("litchi", "lychee"), "lychee"),
    (("lobster",), "lobster"),
    (("mango",), "mango"),
    (("mangostan", "mangosteen"), "mangosteen"),
    (("mulberry",), "mulberry"),
    (("okra",), "okra"),
    (("onion",), "onion"),
    (("papaya",), "papaya"),
    (("peach",), "peach"),
    (("pear",), "pear"),
    (("pepino",), "pepino"),
    (("physalis",), "physalis"),
    (("plum",), "plum"),
    (("potato",), "potato"),
    (("pumpkin",), "pumpkin"),
    (("quince",), "quince"),
    (("radish",), "radish"),
    (("rambutan", "rumbutan"), "rambutan"),
    (("rice",), "rice"),
    (("bread",), "bread"),
    (("butter",), "butter"),
    (("chocolate",), "chocolate"),
    (("flour",), "flour"),
    (("fresh cream", "cream"), "cream"),
    (("yoghurt", "yogurt"), "yogurt"),
    (("milk",), "milk"),
    (("salak",), "salak"),
    (("asparagus",), "asparagus"),
    (("tomato",), "tomato"),
    (("tamarillo", "tamarilo"), "tamarillo"),
    (("lettuce",), "lettuce"),
    (("steak", "beef", "meat"), "steak"),
    (("mutton",), "mutton"),
    (("chicken",), "chicken"),
    (("duck",), "duck"),
    (("sausage",), "sausage"),
    (("shrimp",), "shrimp"),
    (("scallop",), "scallop"),
    (("oyster",), "oyster"),
    (("crab",), "crab"),
    (("cheese",), "cheese"),
    (("egg",), "egg"),
    (("pasta",), "pasta"),
]

SAFE_EVALUATION_METHODS = {"native_yolo", "native_polygon", "native_voc"}


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def canonical_ingredient(value: str) -> str | None:
    normalized = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    normalized = re.sub(r"(db|q)$", "", normalized).strip()
    # Several freshness datasets concatenate the condition and ingredient in one
    # folder name (FreshApple, RottenBanana, NotFreshTomato).
    normalized = re.sub(
        r"^(highlyfresh|notfresh|overripe|unripe|rotten|fresh|ripe|mild|good)",
        "",
        normalized,
    ).strip()
    normalized = re.sub(
        r"\b(fresh|rotten|unripe|ripe|overripe|mild|good|highlyfresh|notfresh)\b",
        " ",
        normalized,
    )
    normalized = re.sub(r"\s+", " ", normalized).strip()
    exact = slug(normalized)
    if exact in BASE_CLASS_ALIASES:
        return BASE_CLASS_ALIASES[exact]
    singular_tokens = []
    for token in normalized.split():
        if token.endswith("ies") and len(token) > 4:
            singular_tokens.append(token[:-3] + "y")
        elif token.endswith("oes") and len(token) > 4:
            singular_tokens.append(token[:-2])
        elif token.endswith("es") and token[:-2] in {"peach", "orange", "date", "lime"}:
            singular_tokens.append(token[:-2])
        elif token.endswith("s") and len(token) > 3 and token not in {"asparagus"}:
            singular_tokens.append(token[:-1])
        else:
            singular_tokens.append(token)
    padded_values = (f" {normalized} ", f" {' '.join(singular_tokens)} ")
    for aliases, result in INGREDIENT_PATTERNS:
        if any(f" {alias} " in padded for alias in aliases for padded in padded_values):
            return result
    return None


@dataclass
class DetectionSample:
    source: str
    ingredient_boxes: list[tuple[str, float, float, float, float]]
    group_id: str
    annotation_method: str
    source_path: Path
    split: str = "train"
    archive_member: str = ""


def stable_split(group_id: str) -> str:
    value = int(hashlib.sha256(group_id.encode("utf-8")).hexdigest()[:8], 16) % 100
    return "train" if value < 80 else "val" if value < 90 else "test"


def _image_paths(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted(
        path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
    )


def _deterministic_cap(paths: Iterable[Path], maximum: int) -> list[Path]:
    ordered = sorted(paths, key=lambda path: hashlib.sha256(str(path).encode("utf-8")).hexdigest())
    return ordered if maximum <= 0 else ordered[:maximum]


def foreground_box(path: Path) -> tuple[float, float, float, float]:
    """Return a tight box for one isolated object on a simple background.

    This deliberately rejects complex/full-frame scenes instead of manufacturing a
    weak full-image annotation. Rejected images are routed to the review queue.
    """
    with Image.open(path) as image:
        image.load()
        rgb = np.asarray(image.convert("RGB"))
    return foreground_box_from_array(rgb)


def foreground_box_from_array(rgb: np.ndarray) -> tuple[float, float, float, float]:
    height, width = rgb.shape[:2]
    if width < 32 or height < 32:
        raise ValueError("image is smaller than 32x32")
    scale = min(1.0, 640.0 / max(width, height))
    small = cv2.resize(
        rgb,
        (max(1, round(width * scale)), max(1, round(height * scale))),
        interpolation=cv2.INTER_AREA,
    )
    sh, sw = small.shape[:2]
    border = np.concatenate((small[0], small[-1], small[:, 0], small[:, -1]), axis=0).astype(
        np.float32
    )
    background = np.median(border, axis=0)
    distance = np.linalg.norm(small.astype(np.float32) - background, axis=2)
    # Use the central border population, not the high tail: isolated objects can touch
    # an edge and would otherwise inflate the background tolerance until they disappear.
    border_distance = np.linalg.norm(border - background, axis=1)
    threshold = max(18.0, float(np.percentile(border_distance, 50)) + 8.0)
    mask = (distance > threshold).astype(np.uint8) * 255
    kernel = np.ones((3, 3), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    min_component = max(16, round(sw * sh * 0.0015))
    components = [
        stats[index] for index in range(1, count) if stats[index, cv2.CC_STAT_AREA] >= min_component
    ]
    if not components:
        raise ValueError("no reliable foreground component")
    left = min(int(item[cv2.CC_STAT_LEFT]) for item in components)
    top = min(int(item[cv2.CC_STAT_TOP]) for item in components)
    right = max(int(item[cv2.CC_STAT_LEFT] + item[cv2.CC_STAT_WIDTH]) for item in components)
    bottom = max(int(item[cv2.CC_STAT_TOP] + item[cv2.CC_STAT_HEIGHT]) for item in components)
    pad_x, pad_y = (
        max(2, round((right - left) * 0.03)),
        max(2, round((bottom - top) * 0.03)),
    )
    left, top = max(0, left - pad_x), max(0, top - pad_y)
    right, bottom = min(sw, right + pad_x), min(sh, bottom + pad_y)
    box_area = (right - left) * (bottom - top) / (sw * sh)
    foreground_fraction = float(np.count_nonzero(mask)) / (sw * sh)
    # A genuinely tight crop can touch every edge while still retaining a clean
    # background (common in Fruits-360). Complex photos instead produce an almost
    # completely foreground mask and are rejected for manual/model-assisted review.
    border_consistency = float(np.mean(border_distance < 18.0))
    if box_area < 0.01 or (
        box_area > 0.92 and (foreground_fraction > 0.90 or border_consistency < 0.35)
    ):
        raise ValueError(f"implausible foreground box area {box_area:.3f}")
    return (
        (left + right) / (2 * sw),
        (top + bottom) / (2 * sh),
        (right - left) / sw,
        (bottom - top) / sh,
    )


def clip_box_to_image(
    x: float, y: float, width: float, height: float
) -> tuple[float, float, float, float]:
    """Clip a normalized box to the image while preserving its in-frame region."""
    left, right = max(0.0, x - width / 2), min(1.0, x + width / 2)
    top, bottom = max(0.0, y - height / 2), min(1.0, y + height / 2)
    if right <= left or bottom <= top:
        raise ValueError("bounding box has no area inside the image")
    return ((left + right) / 2, (top + bottom) / 2, right - left, bottom - top)


def _native_yolo_samples(
    source: str,
    image_dir: Path,
    label_dir: Path,
    mapping: dict[int, str],
    rejected: list[dict],
) -> list[DetectionSample]:
    result: list[DetectionSample] = []
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
            rejected.append(
                {
                    "dataset": "detector",
                    "source": source,
                    "item": label.name,
                    "reason": "label_without_image",
                }
            )
            continue
        _, boxes, problems = valid_yolo_lines(label)
        for problem in problems:
            rejected.append(
                {
                    "dataset": "detector",
                    "source": source,
                    "item": label.name,
                    "reason": problem,
                }
            )
        named = [(mapping[old], x, y, w, h) for old, x, y, w, h in boxes if old in mapping]
        if not named:
            rejected.append(
                {
                    "dataset": "detector",
                    "source": source,
                    "item": label.name,
                    "reason": "no_mapped_boxes",
                }
            )
            continue
        group = f"{source}:{clean_group_stem(label.name)}"
        method = (
            "native_polygon"
            if any(
                len(line.split()) > 5
                for line in label.read_text(encoding="utf-8", errors="replace").splitlines()
            )
            else "native_yolo"
        )
        result.append(DetectionSample(source, named, group, method, image, stable_split(group)))
    return result


def _native_voc_samples(
    source: str,
    image_root: Path,
    annotation_root: Path,
    rejected: list[dict],
) -> list[DetectionSample]:
    result: list[DetectionSample] = []
    images_by_stem = {path.stem: path for path in _image_paths(image_root)}
    for annotation in sorted(annotation_root.rglob("*.xml")):
        image = images_by_stem.get(annotation.stem)
        if image is None:
            rejected.append(
                {
                    "dataset": "detector",
                    "source": source,
                    "item": annotation.name,
                    "reason": "annotation_without_image",
                }
            )
            continue
        try:
            root = ET.parse(annotation).getroot()
            width = float(root.findtext("size/width", "0"))
            height = float(root.findtext("size/height", "0"))
            if width <= 0 or height <= 0:
                raise ValueError("invalid Pascal VOC image dimensions")
            boxes: list[tuple[str, float, float, float, float]] = []
            for item in root.findall("object"):
                ingredient = canonical_ingredient(item.findtext("name", ""))
                box = item.find("bndbox")
                if ingredient is None or box is None:
                    continue
                left = float(box.findtext("xmin", "0")) / width
                top = float(box.findtext("ymin", "0")) / height
                right = float(box.findtext("xmax", "0")) / width
                bottom = float(box.findtext("ymax", "0")) / height
                x, y, box_width, box_height = clip_box_to_image(
                    (left + right) / 2,
                    (top + bottom) / 2,
                    right - left,
                    bottom - top,
                )
                boxes.append((ingredient, x, y, box_width, box_height))
            if not boxes:
                raise ValueError("no mapped Pascal VOC boxes")
            group = f"{source}:{clean_group_stem(annotation.name)}"
            result.append(
                DetectionSample(source, boxes, group, "native_voc", image, stable_split(group))
            )
        except (ET.ParseError, OSError, ValueError) as error:
            rejected.append(
                {
                    "dataset": "detector",
                    "source": source,
                    "item": annotation.name,
                    "reason": str(error),
                }
            )
    return result


def _queue_images(
    queue: list[dict], source: str, root: Path, reason: str, label_from_path=None
) -> int:
    images = _image_paths(root)
    for path in images:
        suggested = label_from_path(path) if label_from_path else ""
        queue.append(
            {
                "source": source,
                "path": str(path),
                "reason": reason,
                "suggested_labels": suggested or "",
            }
        )
    return len(images)


def _folder_ingredient(path: Path, root: Path) -> str | None:
    relative = path.relative_to(root)
    # Prefer the nearest parent that resolves; freshness/status directories do not.
    for part in reversed(relative.parts[:-1]):
        ingredient = canonical_ingredient(part)
        if ingredient:
            return ingredient
    return canonical_ingredient(path.stem)


def _add_foreground_source(
    samples: list[DetectionSample],
    queue: list[dict],
    source: str,
    root: Path,
    maximum_per_class: int,
    stats: dict,
    *,
    label_resolver=None,
    eligible_paths: Iterable[Path] | None = None,
) -> None:
    resolver = label_resolver or (lambda path: _folder_ingredient(path, root))
    paths = list(eligible_paths) if eligible_paths is not None else _image_paths(root)
    stats[source]["images_discovered"] += len(paths)
    by_class: dict[str, list[Path]] = defaultdict(list)
    for path in paths:
        ingredient = resolver(path)
        if ingredient:
            by_class[ingredient].append(path)
        else:
            queue.append(
                {
                    "source": source,
                    "path": str(path),
                    "reason": "ingredient_label_not_resolved",
                    "suggested_labels": "",
                }
            )
            stats[source]["queued"] += 1
    selected_pairs: list[tuple[str, Path]] = []
    for ingredient, candidates in sorted(by_class.items()):
        selected = _deterministic_cap(candidates, maximum_per_class)
        stats[source]["excluded_by_cap"] += len(candidates) - len(selected)
        selected_pairs.extend((ingredient, path) for path in selected)
    print(
        f"Detector source {source}: {len(paths):,} discovered, "
        f"{len(selected_pairs):,} selected for foreground boxes.",
        flush=True,
    )

    def derive(item: tuple[str, Path]):
        ingredient, path = item
        try:
            return ingredient, path, foreground_box(path), None
        except (OSError, ValueError, UnidentifiedImageError) as error:
            return ingredient, path, None, str(error)

    workers = min(8, max(1, os.cpu_count() or 1))
    with ThreadPoolExecutor(max_workers=workers) as executor:
        for ingredient, path, box, error in executor.map(derive, selected_pairs, chunksize=16):
            if box is not None:
                x, y, w, h = box
                group = f"{source}:{ingredient}:{clean_group_stem(path.name)}"
                samples.append(
                    DetectionSample(
                        source,
                        [(ingredient, x, y, w, h)],
                        group,
                        "derived_foreground",
                        path,
                        "train",
                    )
                )
                stats[source]["samples_selected"] += 1
            else:
                queue.append(
                    {
                        "source": source,
                        "path": str(path),
                        "reason": f"foreground_box_failed: {error}",
                        "suggested_labels": ingredient,
                    }
                )
                stats[source]["queued"] += 1
    print(
        f"Detector source {source}: {stats[source]['samples_selected']:,} usable, "
        f"{stats[source]['queued']:,} queued for review.",
        flush=True,
    )


def _add_grapenet(
    samples: list[DetectionSample],
    queue: list[dict],
    root: Path,
    max_variants: int,
    stats: dict,
) -> None:
    source = "grapenet"
    print("Detector source grapenet: reading grouped ZIP images.", flush=True)
    for archive in sorted(root.rglob("*.zip")):
        try:
            with zipfile.ZipFile(archive) as zipped:
                members = sorted(
                    member
                    for member in zipped.namelist()
                    if Path(member).suffix.lower() in IMAGE_SUFFIXES
                )
                stats[source]["images_discovered"] += len(members)
                grouped: dict[str, list[str]] = defaultdict(list)
                for member in members:
                    grouped[clean_group_stem(Path(member).name)].append(member)
                for group, variants in grouped.items():
                    selected = variants if max_variants <= 0 else variants[:max_variants]
                    stats[source]["excluded_by_cap"] += len(variants) - len(selected)
                    for member in selected:
                        try:
                            with (
                                zipped.open(member) as handle,
                                Image.open(handle) as image,
                            ):
                                image.load()
                                rgb = np.asarray(image.convert("RGB"))
                            x, y, w, h = foreground_box_from_array(rgb)
                            samples.append(
                                DetectionSample(
                                    source,
                                    [("grape", x, y, w, h)],
                                    f"{source}:{group}",
                                    "derived_foreground",
                                    archive,
                                    "train",
                                    member,
                                )
                            )
                            stats[source]["samples_selected"] += 1
                        except (
                            OSError,
                            ValueError,
                            UnidentifiedImageError,
                            zipfile.BadZipFile,
                        ) as error:
                            queue.append(
                                {
                                    "source": source,
                                    "path": f"{archive}!{member}",
                                    "reason": f"foreground_box_failed: {error}",
                                    "suggested_labels": "grape",
                                }
                            )
                            stats[source]["queued"] += 1
        except zipfile.BadZipFile as error:
            queue.append(
                {
                    "source": source,
                    "path": str(archive),
                    "reason": f"bad_zip: {error}",
                    "suggested_labels": "grape",
                }
            )
            stats[source]["queued"] += 1
    print(
        f"Detector source grapenet: {stats[source]['samples_selected']:,} usable, "
        f"{stats[source]['queued']:,} queued for review.",
        flush=True,
    )


def _write_archive_image(sample: DetectionSample, destination: Path) -> None:
    with (
        zipfile.ZipFile(sample.source_path) as zipped,
        zipped.open(sample.archive_member) as source,
        destination.open("wb") as target,
    ):
        shutil.copyfileobj(source, target)


def _validate_staging(root: Path, class_count: int) -> None:
    epsilon = 1e-6
    for split in ("train", "val", "test"):
        image_stems = {path.stem for path in (root / "images" / split).iterdir() if path.is_file()}
        label_paths = list((root / "labels" / split).glob("*.txt"))
        label_stems = {path.stem for path in label_paths}
        if image_stems != label_stems:
            raise RuntimeError(f"staging {split} image/label mismatch")
        if not image_stems:
            raise RuntimeError(f"staging {split} is empty")

        def validate_label(label: Path) -> None:
            for line in label.read_text(encoding="utf-8").splitlines():
                fields = line.split()
                if len(fields) != 5 or not 0 <= int(fields[0]) < class_count:
                    raise RuntimeError(f"invalid staging label row in {label}: {line}")
                x, y, width, height = map(float, fields[1:])
                if (
                    width <= 0
                    or height <= 0
                    or x - width / 2 < -epsilon
                    or y - height / 2 < -epsilon
                    or x + width / 2 > 1 + epsilon
                    or y + height / 2 > 1 + epsilon
                ):
                    raise RuntimeError(f"out-of-bounds staging box in {label}: {line}")

        with ThreadPoolExecutor(max_workers=min(8, max(1, os.cpu_count() or 1))) as executor:
            list(executor.map(validate_label, label_paths, chunksize=64))


def _inventory_defaults(collection: str, root: Path) -> dict[str, dict]:
    result: dict[str, dict] = {}
    if not root.exists():
        return result
    for item in sorted(root.iterdir()):
        result[item.name] = {
            "collection": collection,
            "folder": item.name,
            "status": "pending_audit",
            "reason": "",
            "images_discovered": 0,
            "samples_selected": 0,
            "samples_written": 0,
            "queued": 0,
            "excluded_by_cap": 0,
        }
    return result


def prepare_detector(
    detection_root: Path,
    freshness_root: Path,
    output: Path,
    rejected: list[dict],
    *,
    max_derived_per_class: int = 600,
    max_grapenet_variants: int = 3,
) -> dict:
    final_target = output / "ingredient_detection"
    staging = output / f"ingredient_detection.staging-{os.getpid()}"
    backup = output / f"ingredient_detection.backup-{os.getpid()}"
    shutil.rmtree(staging, ignore_errors=True)
    shutil.rmtree(backup, ignore_errors=True)
    for split in ("train", "val", "test"):
        (staging / "images" / split).mkdir(parents=True, exist_ok=True)
        (staging / "labels" / split).mkdir(parents=True, exist_ok=True)

    samples: list[DetectionSample] = []
    review_queue: list[dict] = []
    source_stats: dict[str, Counter] = defaultdict(Counter)
    folder_inventory = {
        **{
            f"detection/{key}": value
            for key, value in _inventory_defaults("Food Detection", detection_root).items()
        },
        **{
            f"freshness/{key}": value
            for key, value in _inventory_defaults("Food Freshness", freshness_root).items()
        },
    }

    try:
        # Native Objects365 food boxes.
        object_root = detection_root / "Object365" / "Objects365-Food"
        class_file = object_root / "food_classes.txt"
        base_classes = [
            slug(line)
            for line in class_file.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        object_mapping = {index: name for index, name in enumerate(base_classes)}
        object_samples = _native_yolo_samples(
            "objects365",
            object_root / "images" / "val",
            object_root / "labels" / "val",
            object_mapping,
            rejected,
        )
        samples.extend(object_samples)
        source_stats["objects365"]["images_discovered"] = len(
            list((object_root / "images" / "val").glob("*"))
        )
        source_stats["objects365"]["samples_selected"] = len(object_samples)
        folder_inventory["detection/Object365"].update(
            status="ingested",
            reason="Objects365-Food native YOLO subset; raw COCO archive is not duplicated",
        )

        # Newly supplied native refrigerator datasets.
        fridge_root = detection_root / "fridge food images.v14-yolo-nass-model-training.yolo26"
        fridge_yaml = fridge_root / "data.yaml"
        fridge_names: list[str] = []
        if fridge_yaml.exists():
            match = re.search(
                r"^names:\s*(\[.*\])\s*$",
                fridge_yaml.read_text(encoding="utf-8"),
                flags=re.MULTILINE,
            )
            if match:
                fridge_names = [str(value) for value in ast.literal_eval(match.group(1))]
        fridge_mapping = {
            index: ingredient
            for index, raw_name in enumerate(fridge_names)
            if (ingredient := canonical_ingredient(raw_name)) is not None
        }
        fridge_total = 0
        for source_split in ("train", "valid", "test"):
            found = _native_yolo_samples(
                f"fridge_food_{source_split}",
                fridge_root / source_split / "images",
                fridge_root / source_split / "labels",
                fridge_mapping,
                rejected,
            )
            samples.extend(found)
            fridge_total += len(found)
            source_stats[f"fridge_food_{source_split}"]["samples_selected"] += len(found)
        folder_inventory["detection/fridge food images.v14-yolo-nass-model-training.yolo26"].update(
            status="ingested",
            reason="native YOLO26 boxes; Roboflow variants grouped by original stem",
            images_discovered=fridge_total,
            samples_selected=fridge_total,
        )

        voc_root = detection_root / "archive (1)"
        voc_samples = _native_voc_samples("refrigerator_voc", voc_root, voc_root, rejected)
        samples.extend(voc_samples)
        source_stats["refrigerator_voc"]["samples_selected"] += len(voc_samples)
        folder_inventory["detection/archive (1)"].update(
            status="ingested",
            reason="Pascal VOC refrigerator boxes converted to normalized YOLO boxes",
            images_discovered=len(_image_paths(voc_root)),
            samples_selected=len(voc_samples),
        )

        classification_archive = detection_root / "archive"
        queued = _queue_images(
            review_queue,
            "food_classification_archive",
            classification_archive,
            "classification_only_natural_scene_requires_reviewed_instance_boxes",
            lambda path: _folder_ingredient(path, classification_archive) or "",
        )
        source_stats["food_classification_archive"]["images_discovered"] = queued
        source_stats["food_classification_archive"]["queued"] = queued
        folder_inventory["detection/archive"].update(
            status="requires_annotation",
            reason="natural classification images have no instance boxes",
            images_discovered=queued,
            queued=queued,
        )

        # Fruits-360: original-size is preferred. Only raw classes missing from it are
        # taken from the 100x100 branch; the 3-body branch is an exact duplicate view.
        original_root = detection_root / "fruits-360-original-size-main"
        original_class_names = {
            folder.name
            for split in ("Training", "Validation", "Test")
            for folder in (original_root / split).glob("*")
            if folder.is_dir()
        }
        _add_foreground_source(
            samples,
            review_queue,
            "fruits360_original",
            original_root,
            max_derived_per_class,
            source_stats,
        )
        folder_inventory["detection/fruits-360-original-size-main"].update(
            status="ingested",
            reason="isolated objects receive validated foreground-derived boxes",
        )

        compact_root = detection_root / "fruits-360-100x100-main"
        compact_unique = [
            path
            for path in _image_paths(compact_root)
            if path.parent.name not in original_class_names
        ]
        compact_cap = max(50, max_derived_per_class // 6) if max_derived_per_class > 0 else 0
        _add_foreground_source(
            samples,
            review_queue,
            "fruits360_100_unique",
            compact_root,
            compact_cap,
            source_stats,
            eligible_paths=compact_unique,
        )
        folder_inventory["detection/fruits-360-100x100-main"].update(
            status="partially_ingested",
            reason="only classes absent from original-size; overlapping captures are deduplicated",
        )
        folder_inventory["detection/fruits-360-3-body-problem-main"].update(
            status="duplicate", reason="exact duplicate subset of fruits-360-100x100"
        )

        multi_root = detection_root / "fruits-360-multi-main"
        queued = _queue_images(
            review_queue,
            "fruits360_multi",
            multi_root,
            "multi_object_scene_requires_reviewed_instance_boxes",
            lambda path: canonical_ingredient(path.stem) or "",
        )
        source_stats["fruits360_multi"]["images_discovered"] = queued
        source_stats["fruits360_multi"]["queued"] = queued
        folder_inventory["detection/fruits-360-multi-main"].update(
            status="requires_annotation",
            reason="multi-object scenes have image-level labels but no instance boxes",
            queued=queued,
        )
        folder_inventory["detection/fruits-360-meta-main"].update(
            status="metadata_only",
            reason="contains class metadata and no training images",
        )

        grocery_root = detection_root / "GroceryStoreDataset-master"
        queued = _queue_images(
            review_queue,
            "grocery_store",
            grocery_root,
            "natural_scene_requires_reviewed_instance_boxes",
            lambda path: _folder_ingredient(path, grocery_root) or "",
        )
        source_stats["grocery_store"]["images_discovered"] = queued
        source_stats["grocery_store"]["queued"] = queued
        folder_inventory["detection/GroceryStoreDataset-master"].update(
            status="requires_annotation",
            reason="classification labels only; natural scenes may contain many objects",
            queued=queued,
        )

        grape_root = detection_root / "GrapeNet An Image Dataset for Grape Variety and Qu"
        _add_grapenet(samples, review_queue, grape_root, max_grapenet_variants, source_stats)
        folder_inventory["detection/GrapeNet An Image Dataset for Grape Variety and Qu"].update(
            status="ingested",
            reason="ZIP images grouped by original capture; validated foreground boxes; augmented variants capped",
        )
        folder_inventory["detection/AllSmaples-Report"].update(
            status="non_visual",
            reason="CSV sensor reports cannot train an image detector",
        )

        # Native spatial annotations from Food Freshness.
        comprehensive = next(
            (
                path
                for path in [
                    freshness_root
                    / "Comprehensive Dataset on Ripening Stages of Strawberries and Avocados From Unripe to Rotten",
                    *list(
                        (
                            freshness_root
                            / "Comprehensive Dataset on Ripening Stages of Strawberries and Avocados From Unripe to Rotten"
                        ).rglob("*")
                    ),
                ]
                if path.is_dir() and (path / "images").is_dir() and (path / "labels").is_dir()
            ),
            None,
        )
        if comprehensive:
            mapping = {
                0: "strawberry",
                1: "strawberry",
                2: "strawberry",
                3: "strawberry",
                4: "avocado",
                5: "avocado",
                6: "avocado",
                7: "avocado",
            }
            found = _native_yolo_samples(
                "freshness_boxes",
                comprehensive / "images",
                comprehensive / "labels",
                mapping,
                rejected,
            )
            samples.extend(found)
            source_stats["freshness_boxes"]["samples_selected"] += len(found)
            folder_inventory[
                "freshness/Comprehensive Dataset on Ripening Stages of Strawberries and Avocados From Unripe to Rotten"
            ].update(status="ingested", reason="native YOLO boxes")
        strawberry_parent = freshness_root / "Strawberry Riupeness"
        strawberry = next(
            (
                path
                for path in [strawberry_parent, *list(strawberry_parent.rglob("*"))]
                if path.is_dir() and (path / "images").is_dir() and (path / "labels").is_dir()
            ),
            None,
        )
        if strawberry:
            found = _native_yolo_samples(
                "strawberry_boxes",
                strawberry / "images",
                strawberry / "labels",
                {0: "strawberry", 1: "strawberry", 2: "strawberry"},
                rejected,
            )
            samples.extend(found)
            source_stats["strawberry_boxes"]["samples_selected"] += len(found)
            folder_inventory["freshness/Strawberry Riupeness"].update(
                status="ingested",
                reason="native segmentation polygons converted to boxes",
            )
        tomato = freshness_root / "Tomato_Dataset.v5" / "Tomato_Dataset.v5"
        tomato_count = 0
        for source_split in ("train", "valid", "test"):
            found = _native_yolo_samples(
                f"tomato_{source_split}",
                tomato / source_split / "images",
                tomato / source_split / "labels",
                {0: "tomato", 1: "tomato"},
                rejected,
            )
            samples.extend(found)
            tomato_count += len(found)
            source_stats[f"tomato_{source_split}"]["samples_selected"] += len(found)
        folder_inventory["freshness/Tomato_Dataset.v5"].update(
            status="ingested",
            reason="native YOLO boxes; augmented stems grouped deterministically",
        )

        # Classification-only sources with simple product backgrounds are admitted only
        # when foreground extraction passes strict geometry checks; all failures are queued.
        safe_foreground_sources = {
            "foodclass2": freshness_root / "FoodClass2",
            "fruq_multi": freshness_root / "FruQ-multi",
            "fruit_ripeness": freshness_root / "Fruit Ripeness, Unripe, Ripe, Rotten",
            "fruit_quality_original": freshness_root / "Original Image",
            "litchi_identity": freshness_root / "Original Images",
        }
        for source, root in safe_foreground_sources.items():
            resolver = (lambda _path: "lychee") if source == "litchi_identity" else None
            _add_foreground_source(
                samples,
                review_queue,
                source,
                root,
                max_derived_per_class,
                source_stats,
                label_resolver=resolver,
            )
        folder_inventory["freshness/FoodClass2"].update(
            status="partially_ingested",
            reason="only images passing strict foreground-box validation; per-class cap balances augmented data",
        )
        folder_inventory["freshness/FruQ-multi"].update(
            status="partially_ingested",
            reason="ingredient folders plus validated foreground boxes",
        )
        folder_inventory["freshness/Fruit Ripeness, Unripe, Ripe, Rotten"].update(
            status="partially_ingested",
            reason="unique canonical tree with foreground boxes; duplicates capped",
        )
        folder_inventory["freshness/Original Image"].update(
            status="partially_ingested",
            reason="foreground-derived boxes; failures require review",
        )
        folder_inventory["freshness/Original Images"].update(
            status="partially_ingested",
            reason="litchi identity retained, including Formalin images; freshness meaning is not used",
        )

        # Account explicitly for unsafe, duplicate and non-visual freshness sources.
        asad_root = freshness_root / "Fruit Ripeness Dataset Asad Ullah"
        queued = _queue_images(
            review_queue,
            "asad_ripeness",
            asad_root,
            "multi_object_scene_requires_reviewed_instance_boxes",
            lambda path: canonical_ingredient(path.name) or "",
        )
        source_stats["asad_ripeness"]["images_discovered"] = queued
        source_stats["asad_ripeness"]["queued"] = queued
        folder_inventory["freshness/Fruit Ripeness Dataset Asad Ullah"].update(
            status="requires_annotation",
            reason="multi-fruit scenes need reviewed instance boxes",
            queued=queued,
        )
        fruq_db = freshness_root / "FruQ-DB"
        queued = _queue_images(
            review_queue, "fruq_db", fruq_db, "ingredient_identity_missing", None
        )
        source_stats["fruq_db"]["images_discovered"] = queued
        source_stats["fruq_db"]["queued"] = queued
        folder_inventory["freshness/FruQ-DB"].update(
            status="requires_annotation",
            reason="freshness folders do not identify the ingredient",
            queued=queued,
        )
        folder_inventory["freshness/Augmented Image"].update(
            status="duplicate",
            reason="pre-augmented derivatives of Original Image; runtime augmentation is used",
        )
        folder_inventory["freshness/Fruit Fresh and rotten Classification"].update(
            status="duplicate",
            reason="exact duplicate content embedded in Fruit Ripeness, Unripe, Ripe, Rotten",
        )
        if "freshness/Litchi Sensor Data.csv" in folder_inventory:
            folder_inventory["freshness/Litchi Sensor Data.csv"].update(
                status="non_visual", reason="sensor CSV cannot train an image detector"
            )

        # Build the dynamic class ontology after every usable sample has been collected.
        discovered_classes = {name for sample in samples for name, *_ in sample.ingredient_boxes}
        classes = [*base_classes, *sorted(discovered_classes - set(base_classes))]
        class_id = {name: index for index, name in enumerate(classes)}
        manifest_rows: list[dict] = []
        counts = Counter()

        def materialize(sample: DetectionSample):
            digest = hashlib.sha256(
                f"{sample.source}|{sample.source_path}|{sample.archive_member}".encode("utf-8")
            ).hexdigest()[:20]
            extension = (
                Path(sample.archive_member).suffix.lower()
                if sample.archive_member
                else sample.source_path.suffix.lower()
            )
            extension = extension if extension in IMAGE_SUFFIXES else ".jpg"
            stem = f"{slug(sample.source)}_{digest}"
            destination = staging / "images" / sample.split / f"{stem}{extension}"
            if sample.archive_member:
                _write_archive_image(sample, destination)
            else:
                link_or_copy(sample.source_path, destination)
            clipped_boxes = [
                (name, *clip_box_to_image(x, y, w, h))
                for name, x, y, w, h in sample.ingredient_boxes
            ]
            label_lines = [
                f"{class_id[name]} {x:.7f} {y:.7f} {w:.7f} {h:.7f}"
                for name, x, y, w, h in clipped_boxes
            ]
            (staging / "labels" / sample.split / f"{stem}.txt").write_text(
                "\n".join(label_lines) + "\n", encoding="utf-8"
            )
            return {
                "sample_id": digest,
                "source": sample.source,
                "source_path": str(sample.source_path),
                "archive_member": sample.archive_member,
                "group_id": sample.group_id,
                "split": sample.split,
                "annotation_method": sample.annotation_method,
                "classes": ";".join(sorted({name for name, *_ in sample.ingredient_boxes})),
                "image": f"images/{sample.split}/{stem}{extension}",
                "label": f"labels/{sample.split}/{stem}.txt",
            }, len(label_lines)

        ordered_samples = sorted(
            samples,
            key=lambda item: (
                item.split,
                item.source,
                str(item.source_path),
                item.archive_member,
            ),
        )
        print(
            f"Materializing {len(ordered_samples):,} detector image/label pairs.",
            flush=True,
        )
        with ThreadPoolExecutor(max_workers=min(8, max(1, os.cpu_count() or 1))) as executor:
            for sample, (row, box_count) in zip(
                ordered_samples,
                executor.map(materialize, ordered_samples, chunksize=32),
            ):
                source_stats[sample.source]["samples_written"] += 1
                counts[f"images_{sample.split}"] += 1
                counts["boxes"] += box_count
                manifest_rows.append(row)

        yaml = [
            f"path: {final_target.resolve().as_posix()}",
            "train: images/train",
            "val: images/val",
            "test: images/test",
            f"nc: {len(classes)}",
            "names:",
            *[f"  {index}: {name}" for index, name in enumerate(classes)],
        ]
        (staging / "dataset.yaml").write_text("\n".join(yaml) + "\n", encoding="utf-8")
        with (staging / "detection_manifest.csv").open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(manifest_rows[0]))
            writer.writeheader()
            writer.writerows(manifest_rows)
        with (staging / "annotation_queue.csv").open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle, fieldnames=["source", "path", "reason", "suggested_labels"]
            )
            writer.writeheader()
            writer.writerows(review_queue)

        # Fold per-source counters into their top-level inventory where possible, while
        # retaining a detailed machine-readable source report.
        source_report = {source: dict(counter) for source, counter in sorted(source_stats.items())}
        inventory_rows = list(folder_inventory.values())
        with (staging / "source_inventory.csv").open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=[
                    "collection",
                    "folder",
                    "status",
                    "reason",
                    "images_discovered",
                    "samples_selected",
                    "samples_written",
                    "queued",
                    "excluded_by_cap",
                ],
            )
            writer.writeheader()
            writer.writerows(inventory_rows)
        (staging / "source_report.json").write_text(
            json.dumps(source_report, indent=2), encoding="utf-8"
        )

        identity_payload = {
            "classes": classes,
            "manifest_sha256": hashlib.sha256(
                "\n".join(json.dumps(row, sort_keys=True) for row in manifest_rows).encode("utf-8")
            ).hexdigest(),
            "samples": len(manifest_rows),
            "boxes": counts["boxes"],
        }
        identity_payload["fingerprint"] = hashlib.sha256(
            json.dumps(identity_payload, sort_keys=True).encode("utf-8")
        ).hexdigest()
        (staging / "dataset_fingerprint.json").write_text(
            json.dumps(identity_payload, indent=2), encoding="utf-8"
        )
        _validate_staging(staging, len(classes))

        # Only replace the live generated dataset after the new one is complete and valid.
        if final_target.exists():
            os.replace(final_target, backup)
        try:
            os.replace(staging, final_target)
        except Exception:
            if backup.exists() and not final_target.exists():
                os.replace(backup, final_target)
            raise
        shutil.rmtree(backup, ignore_errors=True)
        counts["classes"] = len(classes)
        counts["annotation_queue"] = len(review_queue)
        counts["sources"] = len(source_report)
        counts["fingerprint"] = identity_payload["fingerprint"]
        counts["by_annotation_method"] = dict(
            Counter(row["annotation_method"] for row in manifest_rows)
        )
        return dict(counts)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
