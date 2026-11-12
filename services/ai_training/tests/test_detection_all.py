import sys
import unittest
from pathlib import Path

import numpy as np


SCRIPTS = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import prepare_detection_all as detection  # noqa: E402


class AllSourceDetectionTests(unittest.TestCase):
    def test_canonical_ingredient_collapses_varieties_and_synonyms(self):
        cases = {
            "Apple Golden 3": "apple",
            "Banana Lady Finger": "banana",
            "Mandarine": "orange_tangerine",
            "Aubergine": "eggplant",
            "Silver_Barb": "other_fish",
            "Bellpepper": "pepper",
            "Ananas": "pineapple",
            "KakiQ": "persimmon",
            "Litchi": "lychee",
            "FreshApple": "apple",
            "RottenBanana": "banana",
            "FreshApples": "apple",
            "RottenOranges": "orange_tangerine",
            "FreshStrawberries": "strawberry",
            "blue berry": "blueberry",
            "brinjal": "eggplant",
            "green chilly": "chili_pepper",
            "green leaves": "spinach",
            "stawberry": "strawberry",
            "fresh cream": "cream",
            "yoghurt": "yogurt",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(detection.canonical_ingredient(raw), expected)

    def test_foreground_box_is_tight_for_simple_background(self):
        image = np.full((120, 160, 3), 255, dtype=np.uint8)
        image[30:90, 45:125] = (180, 40, 30)
        x, y, width, height = detection.foreground_box_from_array(image)
        self.assertAlmostEqual(x, 0.531, delta=0.04)
        self.assertAlmostEqual(y, 0.5, delta=0.04)
        self.assertGreater(width, 0.45)
        self.assertLess(width, 0.65)
        self.assertGreater(height, 0.45)
        self.assertLess(height, 0.65)

    def test_foreground_box_rejects_blank_image(self):
        image = np.full((100, 100, 3), 255, dtype=np.uint8)
        with self.assertRaisesRegex(ValueError, "foreground"):
            detection.foreground_box_from_array(image)

    def test_stable_split_is_deterministic(self):
        self.assertEqual(detection.stable_split("sample-group"), detection.stable_split("sample-group"))

    def test_source_box_is_clipped_to_image_boundaries(self):
        x, y, width, height = detection.clip_box_to_image(0.962399, 0.383068, 0.075672, 0.10914)
        self.assertLessEqual(x + width / 2, 1.0)
        self.assertGreaterEqual(x - width / 2, 0.0)
        self.assertAlmostEqual(x + width / 2, 1.0)


if __name__ == "__main__":
    unittest.main()
