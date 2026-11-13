#!/usr/bin/env python3
"""Download/extract an Objects365 food-only subset from class-mixed patch archives."""

from __future__ import annotations

import argparse
import json
import shutil
import tarfile
import urllib.request
from collections import defaultdict
from pathlib import Path, PurePosixPath


BASE = "https://dorc.ks3-cn-beijing.ksyun.com/data-set/2020Objects365%E6%95%B0%E6%8D%AE%E9%9B%86"

INGREDIENTS = {
    "Apple",
    "Other Fish",
    "Orange/Tangerine",
    "Tomato",
    "Green Vegetables",
    "Banana",
    "Pumpkin",
    "Lemon",
    "Duck",
    "Broccoli",
    "Carrot",
    "Strawberry",
    "Pepper",
    "Grape",
    "Potato",
    "Sausage",
    "Egg",
    "Cucumber",
    "Pear",
    "Onion",
    "Green beans",
    "Chicken",
    "Watermelon",
    "Cabbage",
    "Peach",
    "Rice",
    "Pineapple",
    "Mango",
    "Corn",
    "Lettuce",
    "Garlic",
    "Green Onion",
    "Nuts",
    "Plum",
    "Kiwi fruit",
    "Shrimp",
    "Cheese",
    "Cherry",
    "Pasta",
    "Avocado",
    "Hamimelon",
    "Mushroom",
    "Eggplant",
    "Coconut",
    "Steak",
    "Pomegranate",
    "Crab",
    "Meat ball",
    "Papaya",
    "Grapefruit",
    "Radish",
    "Red Cabbage",
    "Asparagus",
    "Scallop",
    "Oyster",
    "Lobster",
    "Durian",
    "Okra",
}

PREPARED_FOOD = {
    "Bread",
    "Canned",
    "Cake",
    "Pizza",
    "Donut",
    "Dessert",
    "Pie",
    "Cookies",
    "Candy",
    "Hamburger",
    "Ice cream",
    "French Fries",
    "Hot dog",
    "Sandwich",
    "Sushi",
    "Chips",
    "Egg tart",
    "Baozi",
    "French",
    "Spring Rolls",
    "Noddles",
    "Dumpling",
}


def download(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    print(f"Downloading {url}\n       -> {target}")
    with urllib.request.urlopen(url) as response, partial.open("wb") as output:
        shutil.copyfileobj(response, output, length=1024 * 1024)
    partial.replace(target)


def annotation_url(split: str) -> str:
    return f"{BASE}/{split}/zhiyuan_objv2_{split}.json"


def archive_url(split: str, patch: int) -> str:
    if split == "train":
        return f"{BASE}/train/patch{patch}.tar.gz"
    version = "v1" if patch <= 15 else "v2"
    return f"{BASE}/val/images/{version}/patch{patch}.tar.gz"


def build_subset(
    root: Path,
    source: Path,
    split: str,
    wanted_names: set[str],
    keep_downloads: bool,
    plan_only: bool,
) -> None:
    annotation = source / split / f"zhiyuan_objv2_{split}.json"
    if not annotation.exists():
        download(annotation_url(split), annotation)

    print(f"Reading {annotation} ...")
    with annotation.open("r", encoding="utf-8") as handle:
        data = json.load(handle)

    categories = [category for category in data["categories"] if category["name"] in wanted_names]
    if not categories:
        raise RuntimeError(
            "None of the selected class names exist in this Objects365 annotation file"
        )

    old_to_new = {category["id"]: index for index, category in enumerate(categories)}
    selected_annotations = [a for a in data["annotations"] if a["category_id"] in old_to_new]
    image_ids = {a["image_id"] for a in selected_annotations}
    selected_images = [image for image in data["images"] if image["id"] in image_ids]
    image_by_id = {image["id"]: image for image in selected_images}

    images_by_patch: dict[int, set[str]] = defaultdict(set)
    for image in selected_images:
        path = PurePosixPath(image["file_name"])
        patch_part = next(part for part in path.parts if part.startswith("patch"))
        images_by_patch[int(patch_part.removeprefix("patch"))].add(path.name)

    print(
        f"Plan for {split}: {len(selected_images):,} images, "
        f"{len(selected_annotations):,} boxes, {len(categories)} classes across "
        f"{len(images_by_patch)} patch archives"
    )
    if plan_only:
        return

    output_images = root / "images" / split
    output_labels = root / "labels" / split
    output_images.mkdir(parents=True, exist_ok=True)
    output_labels.mkdir(parents=True, exist_ok=True)

    for patch, filenames in sorted(images_by_patch.items()):
        archive = source / split / f"patch{patch}.tar.gz"
        existed = archive.exists()
        if not existed:
            download(archive_url(split, patch), archive)

        missing = {name for name in filenames if not (output_images / name).exists()}
        if missing:
            print(f"Extracting {len(missing)} selected images from {archive.name} ...")
            with tarfile.open(archive, "r:gz") as bundle:
                for member in bundle:
                    name = PurePosixPath(member.name).name
                    if name not in missing or not member.isfile():
                        continue
                    source_file = bundle.extractfile(member)
                    if source_file is not None:
                        with (output_images / name).open("wb") as destination:
                            shutil.copyfileobj(source_file, destination)

        # Never remove an archive that was already present unless explicitly requested.
        if not keep_downloads and not existed:
            archive.unlink(missing_ok=True)

    annotations_by_image: dict[int, list[dict]] = defaultdict(list)
    for annotation_item in selected_annotations:
        annotations_by_image[annotation_item["image_id"]].append(annotation_item)

    for image_id, annotations in annotations_by_image.items():
        image = image_by_id[image_id]
        width, height = image["width"], image["height"]
        label_path = output_labels / f"{Path(image['file_name']).stem}.txt"
        with label_path.open("w", encoding="utf-8", newline="\n") as label_file:
            for item in annotations:
                x, y, w, h = item["bbox"]
                xc = (x + w / 2) / width
                yc = (y + h / 2) / height
                label_file.write(
                    f"{old_to_new[item['category_id']]} {xc:.6f} {yc:.6f} "
                    f"{w / width:.6f} {h / height:.6f}\n"
                )

    filtered = {
        "info": data.get("info", {}),
        "licenses": data.get("licenses", []),
        "images": selected_images,
        "annotations": selected_annotations,
        "categories": categories,
    }
    annotations_dir = root / "annotations"
    annotations_dir.mkdir(parents=True, exist_ok=True)
    with (annotations_dir / f"objects365_food_{split}.json").open("w", encoding="utf-8") as handle:
        json.dump(filtered, handle)

    with (root / "food_classes.txt").open("w", encoding="utf-8", newline="\n") as handle:
        handle.write("\n".join(category["name"] for category in categories) + "\n")

    print(
        f"Finished {split}: {len(selected_images):,} images, "
        f"{len(selected_annotations):,} boxes, {len(categories)} classes"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("Objects365-Food"))
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--splits", nargs="+", choices=("train", "val"), default=("val",))
    parser.add_argument("--profile", choices=("ingredients", "all-food"), default="ingredients")
    parser.add_argument("--keep-downloads", action="store_true")
    parser.add_argument("--plan-only", action="store_true")
    args = parser.parse_args()

    wanted = set(INGREDIENTS)
    if args.profile == "all-food":
        wanted.update(PREPARED_FOOD)
    source = (args.source_root or (args.root / "source")).resolve()
    for split in args.splits:
        build_subset(
            args.root.resolve(),
            source,
            split,
            wanted,
            args.keep_downloads,
            args.plan_only,
        )


if __name__ == "__main__":
    main()
