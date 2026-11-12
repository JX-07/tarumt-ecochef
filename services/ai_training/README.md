# EcoChef AI training

This folder prepares and trains three coordinated models:

1. `detector`: YOLO ingredient identity and bounding-box detection. The original 57
   Objects365 food classes keep stable IDs; safely derived new ingredient classes are
   appended by the all-source preparation pipeline.
2. `vision`: MobileNet visual freshness classification (`unripe`, `fresh`, `overripe`, `rotten`) on detected crops.
3. `enose`: beef spoilage classification (`excellent`, `good`, `acceptable`, `spoiled`) from common MQ channels plus temperature and humidity.

The preparation step never edits the source folders. It writes cleaned manifests,
reports and a hard-linked YOLO dataset under `data/processed_v2`. Detector output is
built in a staging directory and swapped into place only after its image/label pairs
and boxes pass validation, so a failed rebuild does not destroy the previous dataset.

The 2026 rainbow-trout collection is trained as a separate binary model because its
sensor channels and Fresh/Spoiled labels are not compatible with the four-class beef
model. Prepare and train it with:

```cmd
python scripts\prepare_enose_fish.py --root "C:\Users\tanji\Desktop\Datasets\Electronic Nose Datasete\dataset" --output data\processed_v2\enose_fish_freshness.csv
python scripts\train_enose.py --data data\processed_v2\enose_fish_freshness.csv --run-dir runs\enose_fish
```

Recordings are summarized with distribution and response-dynamics features, and the
split is grouped by fillet identity to prevent the same fish leaking across splits.
The default nonlinear Extra Trees estimator trains in one pass; `resume` deterministically
rebuilds it. Pass `--estimator sgd` only when incremental, epoch-based training is needed.

To clean and train the full specialist e-nose suite in Command Prompt:

```cmd
train-enose-suite.cmd
```

Models are written under `runs/enose_models`. The suite keeps incompatible sensor
systems and targets separate and records exclusions in `suite_report.json`.

Bounding-box freshness sources are intentionally shared: their boxes teach the detector the ingredient identity, while cropped regions teach the freshness model the condition. The models do not share incompatible class IDs or validation samples.

## First-time setup

Open Command Prompt in this folder and run:

```cmd
setup-training.cmd cuda
prepare-datasets.cmd
```

`cuda` installs CUDA-enabled PyTorch for the NVIDIA GPU. Omit it for CPU-only training.

## Start, stop and resume

```cmd
train.cmd start detector
train.cmd stop detector
train.cmd resume detector

train.cmd start vision
train.cmd stop vision
train.cmd resume vision

train.cmd start enose
train.cmd stop enose
train.cmd resume enose

train.cmd status all
train.cmd stop all
```

To keep training in the current Command Prompt and see one summary after each completed epoch, use:

```cmd
train.cmd run detector
train.cmd run vision
train.cmd run enose
```

To train all three sequentially in one visible session (detector, then vision, then e-nose), use:

```cmd
train.cmd run all
```

Resume visible training with `train.cmd run-resume detector` (or `vision`/`enose`). Closing the foreground window interrupts the active process, so use `train.cmd stop <model>` from a second terminal for a safe checkpoint stop.

The detector has two profiles. `accurate-s` is the default: YOLO26s at 768px, batch 4,
four data-loader workers, at most 120 epochs, and validation-fitness early stopping
with patience 20. `fast-n` uses YOLO26n at 640px, batch 16, at most 100 epochs, and
patience 15. Both use CUDA mixed precision and the YOLO26 MuSGD/augmentation recipe.

```cmd
train.cmd run detector
train.cmd run detector -DetectorProfile fast-n
train.cmd start detector -DetectorProfile fast-n
train.cmd resume detector -DetectorProfile fast-n
```

The profiles write to `runs/detector_yolo26s_accurate_all_sources` and
`runs/detector_yolo26n_fast_all_sources`, respectively, preserving earlier detector
baselines and preventing incompatible checkpoints from being mixed. Each run stores
its resolved profile, ordered class list, and dataset fingerprint; resume is refused
if the dataset or class ordering differs. Early stopping retains the best checkpoint
under the selected run directory at `train/weights/best.pt`.

Train only one visual model at a time. The RTX 4060 Laptop GPU has 8 GB of memory, so starting `vision` and `detector` together can run out of GPU memory. `status all` and `stop all` are supported; `start all` is intentionally blocked.

`stop` creates a safe-stop request. Training saves its checkpoint after the current epoch and exits. Use `powershell -File training-control.ps1 -Action stop -Target vision -Force` only if the process is unresponsive; forced stopping can lose the current epoch.

Logs and checkpoints are stored under `runs/<model>`.

## Dataset decisions

- Every top-level folder in `Food Detection` and `Food Freshness` is accounted for in
  `ingredient_detection/source_inventory.csv`.
- Native YOLO boxes and polygons are preserved. Isolated objects on simple backgrounds
  can receive geometry-checked foreground boxes; these derived boxes are train-only.
- Natural multi-object/classification scenes without instance locations are written to
  `ingredient_detection/annotation_queue.csv`, not assigned fake full-image boxes.
- Known duplicate directory trees are recorded and excluded.
- Augmented variants from the same original capture stay in one split and are capped at three variants.
- YOLO labels with missing images or invalid boxes are rejected and logged.
- Images are fingerprinted across selected freshness sources; duplicate visual content stays in one split.
- Large pre-augmented sources are deterministically capped per ingredient/condition. Runtime augmentation is used instead.
- E-nose rows are split by complete recording, so one time series cannot leak between train and validation/test.
- The spoilage model uses the common `MQ2`, `MQ3`, `MQ4`, `MQ5`, `MQ135`, `MQ136`, temperature and humidity columns.
- D1-D5 recordings remain in `enose_day_recordings.csv` as auxiliary progression data and are excluded from the safety-labelled model.

Before using this system for food-safety decisions, collect independent validation data with explicit spoilage ground truth, sensor calibration, temperature/humidity and multiple refrigerators.

The default `prepare-datasets.cmd` caps foreground-derived samples at 600 per
source/class so large studio collections do not overwhelm real scenes. Run
`scripts\prepare_datasets_v2.py --help` to adjust the cap; `0` keeps every derived
sample, although that is generally worse for balance and training time.

## Current coverage limit

Objects365 plus the strawberry, avocado and tomato sources supply reviewed localization
truth. Fruits-360 and other clean-background sources add foreground-derived training
boxes. GroceryStore, Fruits-360 multi, Asad multi-fruit scenes and FruQ-DB remain in the
annotation queue until instance boxes and ingredient identities are reviewed. Add
EcoChef refrigerator photographs before treating benchmark accuracy as real-world app
accuracy.
