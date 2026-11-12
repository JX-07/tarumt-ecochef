import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "scripts" / "prepare_enose_fish.py"
SPEC = importlib.util.spec_from_file_location("prepare_enose_fish", MODULE_PATH)
prepare = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(prepare)


class FishPreparationTests(unittest.TestCase):
    def test_fillet_id_ignores_acquisition_date(self):
        self.assertEqual(prepare.fillet_id(Path("20260515F4F19.csv")), "F4F19")

    def test_split_is_stable_by_fillet(self):
        self.assertEqual(prepare.split_for("F1F1"), prepare.split_for("F1F1"))

    def test_signal_features_include_dynamics(self):
        features = prepare.signal_features(prepare.np.array([1.0, 2.0, 3.0]))
        self.assertAlmostEqual(features["mean"], 2.0)
        self.assertAlmostEqual(features["slope"], 1.0)
        self.assertAlmostEqual(features["delta"], 2.0)

    def test_clean_signal_repairs_an_isolated_spike(self):
        values = prepare.pd.Series([50.0] * 5 + [90.0] + [50.0] * 5, name="Humidity(%)")
        cleaned, invalid, corrected = prepare.clean_signal(values)
        self.assertEqual(invalid, 0)
        self.assertEqual(corrected, 1)
        self.assertEqual(cleaned[5], 50.0)

    def test_clean_signal_repairs_out_of_bounds_value(self):
        values = prepare.pd.Series([100.0, 101.0, 2000.0, 103.0], name="MQ3")
        cleaned, invalid, _ = prepare.clean_signal(values)
        self.assertEqual(invalid, 1)
        self.assertTrue((cleaned <= 1023.0).all())


if __name__ == "__main__":
    unittest.main()
