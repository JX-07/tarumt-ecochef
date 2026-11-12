import argparse
import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import train_detector  # noqa: E402


class DetectorTrainingProfileTests(unittest.TestCase):
    def test_accurate_profile_keeps_high_resolution(self):
        args = argparse.Namespace(profile="accurate-s")
        config = train_detector.resolved_training_config(args)
        self.assertEqual(config["model"], "yolo26s.pt")
        self.assertEqual(config["imgsz"], 768)
        self.assertEqual(config["batch_size"], 4)
        self.assertEqual(config["optimizer"], "MuSGD")
        self.assertGreater(config["scale"], 0.8)

    def test_fast_profile_uses_nano_and_larger_batch(self):
        args = argparse.Namespace(profile="fast-n")
        config = train_detector.resolved_training_config(args)
        self.assertEqual(config["model"], "weights/yolo26n.pt")
        self.assertEqual(config["imgsz"], 640)
        self.assertGreaterEqual(config["batch_size"], 8)

    def test_command_line_override_wins_over_profile(self):
        args = argparse.Namespace(profile="fast-n", batch_size=8, workers=2)
        config = train_detector.resolved_training_config(args)
        self.assertEqual(config["batch_size"], 8)
        self.assertEqual(config["workers"], 2)
        self.assertEqual(config["imgsz"], 640)


if __name__ == "__main__":
    unittest.main()
