import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "prepare_datasets.py"
SPEC = importlib.util.spec_from_file_location("prepare_datasets", MODULE_PATH)
prepare = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(prepare)


class PreparationTests(unittest.TestCase):
    def test_polygon_is_converted_to_bounding_box(self):
        with tempfile.TemporaryDirectory(dir=Path(__file__).parent) as folder:
            label = Path(folder) / "sample.txt"
            label.write_text("2 0.1 0.2 0.5 0.2 0.5 0.8 0.1 0.8\n", encoding="utf-8")
            cleaned, boxes, problems = prepare.valid_yolo_lines(label, {2: 0})
        self.assertEqual(problems, [])
        self.assertEqual(len(cleaned), 1)
        self.assertTrue(cleaned[0].startswith("0 0.3000000 0.5000000 0.4000000 0.6000000"))
        self.assertEqual(boxes[0][0], 2)

    def test_group_split_is_balanced_and_disjoint(self):
        split = prepare.balanced_group_splits(f"group-{index}" for index in range(20))
        self.assertEqual(set(split.values()), {"train", "val", "test"})
        self.assertEqual(list(split.values()).count("val"), 2)
        self.assertEqual(list(split.values()).count("test"), 2)

    def test_sensor_day_is_not_renamed_as_spoilage(self):
        ingredient, day = prepare.sensor_label(Path("Green Apple D5.csv"))
        self.assertEqual(ingredient, "green apple")
        self.assertEqual(day, 5)
        mixture, mixture_day = prepare.sensor_label(Path("AppleBananaTomato.csv"))
        self.assertEqual(mixture, "apple banana tomato")
        self.assertIsNone(mixture_day)


if __name__ == "__main__":
    unittest.main()
