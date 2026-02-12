#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

: "${BOT_MODEL_VALUE_PATH:="${BOT_MODEL_MOVE_PATH:-"$ROOT/ml/checkpoints/asym_value.onnx"}"}"
: "${BOT_MODEL_DOUBLE_PATH:="$ROOT/ml/checkpoints/asym_value_double.onnx"}"

if [[ ! -f "$BOT_MODEL_VALUE_PATH" ]]; then
  echo "Missing BOT_MODEL_VALUE_PATH: $BOT_MODEL_VALUE_PATH" >&2
  echo "Train/export the model or set BOT_MODEL_VALUE_PATH to an existing ONNX file." >&2
  exit 1
fi

if [[ ! -f "$BOT_MODEL_DOUBLE_PATH" ]]; then
  echo "Missing BOT_MODEL_DOUBLE_PATH: $BOT_MODEL_DOUBLE_PATH" >&2
  echo "Train/export the model or set BOT_MODEL_DOUBLE_PATH to an existing ONNX file." >&2
  exit 1
fi

export BOT_POLICY=model
export BOT_MODEL_VALUE_PATH
export BOT_MODEL_DOUBLE_PATH

exec npm start
