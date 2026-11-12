"""Conservative recipe outlier checks, scaled by servings rather than fixed totals."""
import re
from collections import defaultdict
from fractions import Fraction


def ingredient_quantity_issues(ingredients: list, servings: int) -> list[str]:
    issues: list[str] = []
    totals = defaultdict(float)
    labels = {}
    for ingredient in ingredients:
        name, quantity = ingredient.name.strip(), ingredient.quantity.strip()
        if not any(char.isalpha() for char in name):
            issues.append(f'"{name}" needs a valid ingredient name.')
            continue
        if quantity.lower() in {"to taste", "as needed"}:
            continue
        parsed = re.fullmatch(r"(\d+(?:\.\d+)?(?:\s+\d+/\d+)?|\d+/\d+)\s*([a-zA-Z ]*)", quantity)
        try:
            amount = sum(float(Fraction(part)) for part in parsed[1].split()) if parsed else 0
        except (ValueError, ZeroDivisionError, OverflowError):
            amount = 0
        if amount <= 0:
            issues.append(f"{name}: enter a positive amount and a unit, such as 2 pcs or 100 g.")
            continue
        unit = parsed[2].strip().lower()
        aliases = {"gram": "g", "grams": "g", "kilogram": "kg", "kilograms": "kg", "millilitre": "ml", "millilitres": "ml", "liter": "l", "litre": "l", "litres": "l", "liters": "l", "piece": "pcs", "pieces": "pcs", "pc": "pcs", "": "pcs", "cups": "cup", "tablespoon": "tbsp", "tablespoons": "tbsp", "teaspoon": "tsp", "teaspoons": "tsp"}
        unit = aliases.get(unit, unit)
        if unit in {"kg", "l"}:
            amount *= 1000
            unit = "g" if unit == "kg" else "ml"
        key = re.sub(r"\s+", " ", name.lower())
        if key.endswith("s") and not key.endswith("ss"):
            key = key[:-1]
        totals[(key, unit)] += amount
        labels[key] = name
    for (name, unit), amount in totals.items():
        # Broad outlier limits, not dietary advice or recommended portions.
        limit = {"g": 2000, "ml": 3000, "cup": 12, "tbsp": 100, "tsp": 300, "bunch": 10, "pcs": 500}.get(unit, 500)
        if unit == "pcs" and re.search(r"\b(apple|orange|banana|pear|peach|avocado|mango|potato|tomato)\b", name):
            limit = 10
        if unit == "pcs" and re.search(r"\begg\b", name):
            limit = 12
        if unit == "pcs" and re.search(r"\b(chicken|duck|turkey|watermelon|pumpkin)\b", name):
            limit = 4
        if re.search(r"\b(salt|black pepper|white pepper|ground pepper|cinnamon|cumin|turmeric|paprika|nutmeg)\b", name):
            limit = {"g": 50, "tsp": 10, "tbsp": 4, "cup": 0.25}.get(unit, limit)
        if amount / servings > limit:
            issues.append(f"{labels[name]}: {amount:g} {unit} for {servings} servings is unusually high ({amount / servings:g} {unit} per serving). Correct the amount, unit, or number of servings.")
    return issues
