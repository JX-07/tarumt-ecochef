# E-nose dataset test for the current ESP32

Tested on 16 November 2026 using the source data under
`C:\Users\tanji\Desktop\Datasets\Electronic Nose Datasete`. The source files were
read only. The board sends MQ-3, MQ-135, MQ-136, MQ-137, temperature, and humidity.
These results are **source-dataset tests**, not validation on this ESP32 or on food
stored in a household fridge.

## All available e-nose tasks

The existing `train_enose_suite.py` completed 12 training and held-out tests.
Accuracy is shown for classification; MAE is in days for storage-day regression.

| Dataset task               | Test rows | Held-out result | Relevance to this fridge                                                                                              |
| -------------------------- | --------: | --------------: | --------------------------------------------------------------------------------------------------------------------- |
| Trout freshness            |        32 |   100% accuracy | Fresh/spoiled labels; 42 recording features and a different sensor array. This suite uses a random recording holdout. |
| Beef quality               |     2,528 |  99.5% accuracy | Four freshness classes, but row holdout from continuous data can overstate transfer accuracy.                         |
| Pork adulteration          |       112 |  99.1% accuracy | Detects adulteration, not fridge spoilage.                                                                            |
| Aroma identity             |     3,570 |   8.6% accuracy | Odour identity, not spoilage.                                                                                         |
| Coffee powder identity     |     2,527 |  18.0% accuracy | Product identity, not spoilage.                                                                                       |
| Seafood freshness          |    50,547 |  99.9% accuracy | Source-array result with row holdout; requires external-session validation.                                           |
| Beef cut identity          |     3,996 |   100% accuracy | Identifies cut; row holdout from continuous source series.                                                            |
| Fish species identity      |        10 |  20.0% accuracy | Identifies species, not spoilage.                                                                                     |
| Fish storage day           |        10 |    0.56-day MAE | Day progression is not a spoilage label.                                                                              |
| Food storage day           |         8 |    0.55-day MAE | Day progression is not a spoilage label.                                                                              |
| Gas concentration identity |        94 |  80.9% accuracy | Uses a 62-channel resistance array, not the ESP32's MQ board.                                                         |
| Wine/ethanol substance     |        45 |  97.8% accuracy | Identifies substances, not food spoilage.                                                                             |

Derived `partition` files duplicate the beef-cut source and were excluded. The
beef-cut workbook in `dataverse_files` is byte-for-byte identical to the root
copy. Raw photographs are not e-nose readings. Files without a defensible target label remain
available for calibration or unsupervised work; they cannot directly measure
spoiled-versus-fresh accuracy.

## Tests using channels available on the ESP32

`evaluate_current_sensor.py` trained an Extra Trees model separately for beef
and trout, using their existing group-separated holdouts. The beef test holds out
the complete TS5 recording; the trout test holds out six complete fillets. No
source datasets were merged because their foods, labels, and sampling protocols
differ. The trout inputs are statistics over 120 readings, so that result cannot
be applied to one live ESP32 reading.

| Dataset            | Feature set                                                                               | Test rows | Accuracy | Balanced accuracy | Macro F1 |
| ------------------ | ----------------------------------------------------------------------------------------- | --------: | -------: | ----------------: | -------: |
| Beef, four classes | All eight source features                                                                 |     2,160 |    66.1% |             64.9% |    58.9% |
| Beef, four classes | ESP32 overlap: MQ-3, MQ-135, MQ-136, temperature, humidity                                |     2,160 |    71.5% |             68.7% |    58.5% |
| Beef, four classes | Shared four: MQ-3, MQ-135, temperature, humidity                                          |     2,160 |    51.7% |             56.9% |    53.2% |
| Trout, binary      | All 42 source features                                                                    |        24 |     100% |              100% |     100% |
| Trout, binary      | ESP32 overlap: MQ-3, MQ-135, MQ-137, temperature, humidity, each summarized over a window |        24 |     100% |              100% |     100% |
| Trout, binary      | Shared four channels, summarized over a window                                            |        24 |     100% |              100% |     100% |

**Critical beef failure:** the ESP32-overlap model predicted zero of the 420
held-out `acceptable` examples as `acceptable`. It also called 172 of 840
`spoiled` examples another class. High overall accuracy would conceal these
errors.

**Trout limit:** the 24 test windows include 16 `fresh` and 8 `spoiled`
examples from only six fillets. Perfect accuracy on this small source set does
not establish performance on the current ESP32, another fish species, or a
mixed-food fridge.

## Decision

Do not connect these models to the consumer spoilage status yet. The source
arrays, ADC scaling, food conditions, and calibration differ from the current
ESP32. Collect labelled fresh-to-spoiled recordings with this exact board in
several refrigerators, preserve food/batch separation in validation, and test
false alarms and missed spoilage before enabling an automated label. Continue
showing temperature, humidity, and raw MQ trends while model status is unknown.

## Reproduce the focused comparison

From the repository root, with the training virtual environment installed:

```powershell
services/ai_training/.venv/Scripts/python.exe services/ai_training/scripts/evaluate_current_sensor.py --beef services/ai_training/data/processed_v2/enose_spoilage.csv --fish services/ai_training/data/processed_v2/enose_fish_freshness.csv --output services/ai_training/reports/current_sensor_subset_2026-11-16.json
```

The complete machine-readable results are in
`all_dataset_suite_2026-11-16.json` and `current_sensor_subset_2026-11-16.json`.
