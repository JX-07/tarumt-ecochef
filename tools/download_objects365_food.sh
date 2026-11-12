#!/usr/bin/env bash
set -Eeuo pipefail

# Start small by default: validation ingredients only. Examples:
#   ./download_objects365_food.sh
#   SPLITS="train val" ./download_objects365_food.sh
#   FOOD_PROFILE=all-food SPLITS="train val" ./download_objects365_food.sh
#
# Newly downloaded class-mixed archives are deleted after selected images are
# extracted. Set KEEP_DOWNLOADS=1 to retain them.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_DIR="${OUTPUT_DIR:-$PWD/Objects365-Food}"
SOURCE_DIR="${SOURCE_DIR:-$PWD/Objects365-2020}"
SPLITS="${SPLITS:-val}"
FOOD_PROFILE="${FOOD_PROFILE:-ingredients}"
KEEP_DOWNLOADS="${KEEP_DOWNLOADS:-0}"
PLAN_ONLY="${PLAN_ONLY:-0}"

args=(
  "$SCRIPT_DIR/objects365_food_subset.py"
  --root "$OUTPUT_DIR"
  --source-root "$SOURCE_DIR"
  --profile "$FOOD_PROFILE"
  --splits
)

read -r -a split_args <<< "$SPLITS"
args+=("${split_args[@]}")

if [[ "$KEEP_DOWNLOADS" == "1" ]]; then
  args+=(--keep-downloads)
fi

if [[ "$PLAN_ONLY" == "1" ]]; then
  args+=(--plan-only)
fi

python "${args[@]}"
