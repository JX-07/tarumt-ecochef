"""Fill missing Railway showcase imagery using licensed Pexels photographs.

Run with DATABASE_PUBLIC_URL set. The script is read-only until --apply is passed.
Photographs are stored in EcoChef's image tables, so app clients use the API
instead of hotlinking to Pexels. Source pages are listed below for traceability.
Pexels permits use in apps without attribution: https://www.pexels.com/license/
"""

from __future__ import annotations

import argparse
import os
import struct
import urllib.request
import zlib
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row

API_BASE = "https://api-production-d786293b.up.railway.app/api/v1"

# Each number is the ID at the end of its Pexels photo page URL.
RECIPE_PHOTOS = {
    "Apple Cinnamon Oats": 4382900,
    "Banana Oat Pancakes": 9428259,
    "Banana Yogurt Breakfast Bowl": 1660532,
    "Carrot Ginger Soup": 16203215,
    "Citrus Fruit Salad": 7542051,
    "Cucumber Tofu Salad": 30415957,
    "Egg and Tomato Toast": 31314910,
    "Ginger Chicken Rice Bowl": 24738519,
    "Lemon Mint Cooler": 298720,
    "Quick Chickpea Salad": 23285946,
    "Roasted Pumpkin Soup": 5662123,
    "Spinach Mushroom Omelette": 37547474,
    "Tofu Vegetable Noodles": 23645814,
    "Tomato Egg Stir Fry": 29529570,
    "Tomato Spinach Pasta": 31501714,
    "Vegetable Fried Rice": 36293910,
}

PRODUCT_PHOTOS = {
    "Brown Rice 1kg": 4110257,
    "Carrots 500g": 7543101,
    "Cherry Tomatoes 250g": 35977434,
    "Cucumbers 2 Pack": 3568039,
    "Firm Tofu 300g": 4518584,
    "Free Range Eggs 10 Pack": 30805254,
    "Fresh Baby Spinach 200g": 28797268,
    "Fresh Milk 1L": 5946755,
    "Plain Yogurt 500g": 10809259,
    "Red Onions 500g": 7890170,
    "Wholemeal Bread Loaf": 16602271,
    "Cherry Tomato Box": 6297450,
    "Fresh Spinach Bundle": 38695159,
    "Orange Juice Bottle": 8679601,
    "Sourdough Loaf": 33972459,
}

STORE_COVER_PHOTO = 36289943
ICON_STORES = ("Green Basket Market", "Eco Fresh Produce")

INGREDIENT_ICONS = {
    "banana": "🍌",
    "bread": "🍞",
    "capsicum": "🫑",
    "carrot": "🥕",
    "cherry tomato": "🍅",
    "chicken": "🍗",
    "cinnamon": "🧂",
    "corn": "🌽",
    "cucumber": "🥒",
    "egg": "🥚",
    "egg omelette": "🍳",
    "fried mantou": "🥟",
    "garlic": "🧄",
    "ginger": "🫚",
    "haidilao mala soup": "🍲",
    "haidilao tomato soup": "🍲",
    "lamb roll": "🥩",
    "lemon": "🍋",
    "milk": "🥛",
    "mushroom": "🍄",
    "noodles": "🍜",
    "oats": "🥣",
    "olive oil": "🫒",
    "onion": "🧅",
    "pork roll": "🥩",
    "rice": "🍚",
    "roasted sesame": "🌾",
    "spinach": "🥬",
    "tofu": "🧈",
    "tomato": "🍅",
    "yogurt": "🥛",
    "虾滑": "🍤",
    "酸辣粉": "🍜",
}


def photo_url(photo_id: int) -> str:
    return (
        f"https://images.pexels.com/photos/{photo_id}/"
        f"pexels-photo-{photo_id}.jpeg?auto=compress&cs=tinysrgb&w=800"
    )


def download_photo(photo_id: int) -> bytes:
    request = urllib.request.Request(
        photo_url(photo_id),
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; EcoChefAI image backfill)",
            "Referer": "https://www.pexels.com/",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        image = response.read(8 * 1024 * 1024 + 1)
        content_type = response.headers.get_content_type()
    if content_type != "image/jpeg" or not image.startswith(b"\xff\xd8\xff"):
        raise ValueError(f"Photo {photo_id} did not return a JPEG")
    if len(image) > 8 * 1024 * 1024:
        raise ValueError(f"Photo {photo_id} exceeded the upload limit")
    return image


def shop_icon_png(store_name: str) -> bytes:
    """Draw a compact, original basket or leaf mark as an ordinary PNG."""
    size = 180
    pixels = bytearray()
    for y in range(size):
        pixels.append(0)  # PNG scanline filter
        for x in range(size):
            corner_x = min(max(x, 34), 145)
            corner_y = min(max(y, 34), 145)
            if (x - corner_x) ** 2 + (y - corner_y) ** 2 > 34**2:
                color = (0, 0, 0, 0)
            elif store_name == "Green Basket Market":
                color = (225, 248, 236, 255)
                left_leaf_x = 75 - (y - 61) * 0.38
                right_leaf_x = 105 + (y - 61) * 0.38
                if ((x - left_leaf_x) / 12) ** 2 + ((y - 61) / 21) ** 2 < 1:
                    color = (54, 179, 126, 255)
                if ((x - right_leaf_x) / 12) ** 2 + ((y - 61) / 21) ** 2 < 1:
                    color = (39, 160, 111, 255)
                handle = ((x - 90) / 39) ** 2 + ((y - 96) / 42) ** 2
                if y < 96 and 0.60 < handle < 1:
                    color = (8, 126, 104, 255)
                if 93 <= y <= 143 and 52 + (y - 93) * 0.18 <= x <= 128 - (y - 93) * 0.18:
                    color = (8, 185, 143, 255)
                    if 105 <= y <= 133 and any(abs(x - line) < 2 for line in (73, 90, 107)):
                        color = (216, 247, 232, 255)
            else:
                color = (221, 248, 236, 255)
                if (x - 90) ** 2 + (y - 87) ** 2 < 48**2:
                    color = (8, 185, 143, 255)
                if ((x - 90) / 27) ** 2 + ((y - 94) / 30) ** 2 < 1 and y >= 72:
                    color = (240, 255, 247, 255)
                if 69 <= y <= 82 and abs(x - 90) < max(0, 7 - (y - 69) * 0.5):
                    color = (8, 185, 143, 255)
                if 56 <= y <= 75 and abs(x - (90 + (y - 56) * 0.12)) < 3:
                    color = (8, 126, 104, 255)
                if ((x - (103 + (y - 60) * 0.5)) / 12) ** 2 + ((y - 60) / 8) ** 2 < 1:
                    color = (8, 126, 104, 255)
            pixels.extend(color)

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(pixels), level=9))
        + chunk(b"IEND", b"")
    )


def missing_records(connection: psycopg.Connection) -> tuple[list, list, list, list]:
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT id, user_id, title FROM recipes WHERE image_url IS NULL OR "
            "btrim(image_url) = '' ORDER BY title, id"
        )
        recipes = cursor.fetchall()
        cursor.execute(
            "SELECT p.id, s.business_owner_id, p.product_name FROM products p "
            "JOIN stores s ON s.id = p.store_id WHERE p.image_url IS NULL OR "
            "btrim(p.image_url) = '' ORDER BY p.product_name, p.id"
        )
        products = cursor.fetchall()
        cursor.execute(
            "SELECT id, business_owner_id, store_name, cover_image_url, icon_url FROM stores "
            "WHERE store_name = ANY(%s) AND (cover_image_url IS NULL OR "
            "btrim(cover_image_url) = '' OR icon_url IS NULL OR btrim(icon_url) = '' "
            "OR icon_url LIKE 'data:image/svg+xml;base64,%%')",
            (list(ICON_STORES),),
        )
        stores = cursor.fetchall()
        cursor.execute(
            "SELECT id, ingredient_name FROM ingredients "
            "WHERE icon IS NULL OR btrim(icon) = '' ORDER BY ingredient_name"
        )
        ingredients = cursor.fetchall()
    return recipes, products, stores, ingredients


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write missing images to Railway")
    args = parser.parse_args()
    database_url = os.environ.get("DATABASE_PUBLIC_URL")
    if not database_url:
        parser.error("DATABASE_PUBLIC_URL is required")

    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        recipes, products, stores, ingredients = missing_records(connection)
        unknown_recipes = sorted({r["title"] for r in recipes} - RECIPE_PHOTOS.keys())
        unknown_products = sorted({p["product_name"] for p in products} - PRODUCT_PHOTOS.keys())
        unknown_ingredients = sorted(
            {
                i["ingredient_name"]
                for i in ingredients
                if i["ingredient_name"].casefold() not in INGREDIENT_ICONS
            }
        )
        if unknown_recipes or unknown_products or unknown_ingredients:
            raise ValueError(
                f"Unmapped missing records: recipes={unknown_recipes}, "
                f"products={unknown_products}, ingredients={unknown_ingredients}"
            )
        counts = Counter(
            recipes=len(recipes),
            products=len(products),
            stores=len(stores),
            ingredients=len(ingredients),
        )
        print("Missing records:", dict(counts))
        if not args.apply:
            print("Dry run only. Use --apply to download and store the images.")
            return

        needed_photos = {
            *(RECIPE_PHOTOS[r["title"]] for r in recipes),
            *(PRODUCT_PHOTOS[p["product_name"]] for p in products),
            *(STORE_COVER_PHOTO for s in stores if not s["cover_image_url"]),
        }
        with ThreadPoolExecutor(max_workers=4) as pool:
            images = dict(zip(needed_photos, pool.map(download_photo, needed_photos)))
        print(f"Validated {len(images)} source photographs")

        with connection.transaction(), connection.cursor() as cursor:
            for recipe in recipes:
                image_id = uuid4()
                cursor.execute(
                    "INSERT INTO recipe_images (id, uploaded_by, content_type, image_data) "
                    "VALUES (%s, %s, 'image/jpeg', %s)",
                    (image_id, recipe["user_id"], images[RECIPE_PHOTOS[recipe["title"]]]),
                )
                cursor.execute(
                    "UPDATE recipes SET image_url = %s WHERE id = %s AND "
                    "(image_url IS NULL OR btrim(image_url) = '')",
                    (f"{API_BASE}/recipes/images/{image_id}", recipe["id"]),
                )
            for product in products:
                image_id = uuid4()
                cursor.execute(
                    "INSERT INTO product_images (id, uploaded_by, content_type, image_data) "
                    "VALUES (%s, %s, 'image/jpeg', %s)",
                    (
                        image_id,
                        product["business_owner_id"],
                        images[PRODUCT_PHOTOS[product["product_name"]]],
                    ),
                )
                cursor.execute(
                    "UPDATE products SET image_url = %s WHERE id = %s AND "
                    "(image_url IS NULL OR btrim(image_url) = '')",
                    (f"{API_BASE}/vendor/product-images/{image_id}", product["id"]),
                )
            for store in stores:
                if not store["cover_image_url"]:
                    image_id = uuid4()
                    cursor.execute(
                        "INSERT INTO product_images (id, uploaded_by, content_type, image_data) "
                        "VALUES (%s, %s, 'image/jpeg', %s)",
                        (image_id, store["business_owner_id"], images[STORE_COVER_PHOTO]),
                    )
                    cursor.execute(
                        "UPDATE stores SET cover_image_url = %s WHERE id = %s AND "
                        "(cover_image_url IS NULL OR btrim(cover_image_url) = '')",
                        (f"{API_BASE}/vendor/product-images/{image_id}", store["id"]),
                    )
                if not store["icon_url"] or store["icon_url"].startswith(
                    "data:image/svg+xml;base64,"
                ):
                    image_id = uuid4()
                    cursor.execute(
                        "INSERT INTO product_images (id, uploaded_by, content_type, image_data) "
                        "VALUES (%s, %s, 'image/png', %s)",
                        (image_id, store["business_owner_id"], shop_icon_png(store["store_name"])),
                    )
                    cursor.execute(
                        "UPDATE stores SET icon_url = %s WHERE id = %s AND "
                        "icon_url IS NOT DISTINCT FROM %s",
                        (
                            f"{API_BASE}/vendor/product-images/{image_id}",
                            store["id"],
                            store["icon_url"],
                        ),
                    )
            for ingredient in ingredients:
                cursor.execute(
                    "UPDATE ingredients SET icon = %s WHERE id = %s AND "
                    "(icon IS NULL OR btrim(icon) = '')",
                    (INGREDIENT_ICONS[ingredient["ingredient_name"].casefold()], ingredient["id"]),
                )
        print("Applied:", dict(counts))


if __name__ == "__main__":
    main()
