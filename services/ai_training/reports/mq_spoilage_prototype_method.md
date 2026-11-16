# Using EcoChef's current MQ array for a possible spoilage signal

## What the prototype can report

EcoChef can report **possible spoiled food** when several MQ readings rise together
relative to the same board's earlier fridge readings. It prompts the user to
inspect stored food, spills, and recent cleaning. This is an odour-change cue, not
a diagnosis of which food is spoiled or a food-safety result. Temperature above
4°C remains the first warning.

The implementation in `apps/mobile/src/features/fridge-sensors/sensor-insights.ts`
uses the last six hours. For each channel, it compares the median of at least five
earlier readings with at least three readings from the latest 20 minutes. It
ignores near-zero and saturated ADC values. A rise must exceed the larger of 40
raw counts, 25% of that channel's earlier median, or four times its earlier
median absolute deviation. Two or more rising channels trigger the prompt. The
MQ scale displays that channel's actual earlier median and rise guide. These
numbers are **prototype heuristics**, not calibrated gas or spoilage limits.

## Why this approach fits the hardware

- The [MQ-3 reference manual](https://www.winsen-sensor.com/d/files/manual/mq-3b.pdf)
  describes an alcohol-sensitive sensor. The [MQ-135 manual](https://www.winsen-sensor.com/manual/mq135.html?lang=en)
  lists sensitivity to ammonia, sulfides, and other vapours. The
  [MQ-136 page](https://www.winsen-sensor.com/product/mq136.html) describes
  hydrogen-sulfide sensitivity, while the
  [MQ-137 page](https://www.winsen-sensor.com/product/mq137.html) describes
  ammonia and amine sensitivity. Their overlapping responses make a combined
  change more useful than a single raw reading.
- Winsen's MQ-136 and MQ-137 specifications use controlled temperature and
  humidity conditions and call for more than 48 hours of preheating. The module
  supplier and calibration of this particular XXSR69 board have not been
  established, so the app treats its ADC values as relative readings, not ppm.
- A [refrigerated beef e-nose experiment](https://pubmed.ncbi.nlm.nih.gov/37297471/)
  linked gas readings with microbial and pH measurements from specific beef
  samples. That supports testing a gas pattern against labelled food, but does
  not validate EcoChef's sensor array or a mixed-food fridge.
- A [refrigerator odour study](https://www.sciencedirect.com/science/article/pii/S0963996926010513)
  used sensory labels and an optimised sensor pair to classify odour grade. It
  supports a modest odour-change claim; odour grade is not proof of spoilage.
- An [experimental e-nose humidity compensation study](https://www.mdpi.com/1424-8220/24/18/5881)
  found that changing humidity affects gas classification. EcoChef records
  temperature and humidity so this possible confounder can be checked during
  testing; the current heuristic has not been calibrated to remove it.

## What the available datasets establish

The [current-sensor dataset evaluation](current_sensor_dataset_test_2026-11-16.md)
used source data with overlapping channels. A beef model scored 71.5% accuracy
on one held-out recording, but recognised none of 420 `acceptable` examples and
misclassified 172 of 840 `spoiled` examples. A trout model scored 100% on only
24 windows from six held-out fillets. The source sensors, ADC scaling, food,
and sampling conditions differ from the XXSR69 board. Those percentages must
not be presented as EcoChef's detection accuracy. The other available dataset
tasks often concern food identity, adulteration, or storage day rather than
fresh-versus-spoiled status.

## Short validation plan for the final year project

1. Keep the same board, wiring, power, sensor position, and reporting interval.
   Log the board's preheating time and fridge temperature and humidity.
2. Record separate sessions for an empty or normal fridge, fresh food, and food
   independently judged to be spoiled. Include ordinary confounders such as
   opening the door and cleaning. Record the food type, batch, start and end
   times, and the reason for each label. Do not label a sample spoiled solely
   because the MQ readings rose.
3. Keep every recording from a food batch in one split. Tune the heuristic on
   earlier batches, then test on at least one untouched batch or session. Count
   true alarms, false alarms, and missed spoiled sessions. Report precision,
   recall, and false alarms per day, with the number of sessions and food types.
4. If there is only time for a few labelled sessions, report them as case studies
   and show the raw traces. Do not report a general accuracy percentage from
   those few examples.

Suggested report wording: “EcoChef uses a relative, multi-sensor odour-change
heuristic to flag _possible_ spoiled food for inspection. Public e-nose datasets
were tested, but their sensors and conditions did not match our device closely
enough to justify deploying their classifiers. Time and equipment limits
allowed only prototype testing; performance on mixed household fridges remains
unmeasured.”
