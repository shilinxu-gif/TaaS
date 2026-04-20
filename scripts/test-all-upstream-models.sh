#!/usr/bin/env bash
set -euo pipefail

LOGIN="${LOGIN:?请设置 LOGIN}"
PASSWORD="${PASSWORD:?请设置 PASSWORD}"
PROMPT="${PROMPT:-帮我写一个Java的冒泡排序}"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOTAL_START_EPOCH="$(date +%s)"
TOTAL_START_TIME="$(date '+%Y-%m-%d %H:%M:%S')"

echo "==> 总测试开始时间: ${TOTAL_START_TIME}"
echo "==> 测试账号: ${LOGIN}"
echo "==> 测试提示词: ${PROMPT}"
echo

run_one() {
  local label="$1"
  local script="$2"
  local model_start_epoch
  local model_end_epoch
  local model_start_time
  local model_end_time
  local model_duration

  model_start_epoch="$(date +%s)"
  model_start_time="$(date '+%Y-%m-%d %H:%M:%S')"
  echo "========================================"
  echo "==> 开始测试: ${label}"
  echo "==> ${label} 开始时间: ${model_start_time}"
  LOGIN="${LOGIN}" PASSWORD="${PASSWORD}" PROMPT="${PROMPT}" bash "${ROOT_DIR}/${script}"
  model_end_epoch="$(date +%s)"
  model_end_time="$(date '+%Y-%m-%d %H:%M:%S')"
  model_duration="$((model_end_epoch - model_start_epoch))"
  echo "==> ${label} 结束时间: ${model_end_time}"
  echo "==> ${label} 独立耗时: ${model_duration} 秒"
  echo "==> 完成测试: ${label}"
  echo "========================================"
  echo
}

run_one "DeepSeek-V3.1-Terminus" "test-deepseek-v3-1-terminus.sh"
run_one "Qwen3.5-397B-A17B" "test-qwen3-5-397b-a17b.sh"
run_one "Qwen/Qwen3-32B" "test-qwen-qwen3-32b.sh"

TOTAL_END_EPOCH="$(date +%s)"
TOTAL_END_TIME="$(date '+%Y-%m-%d %H:%M:%S')"
TOTAL_DURATION="$((TOTAL_END_EPOCH - TOTAL_START_EPOCH))"

echo "==> 总测试结束时间: ${TOTAL_END_TIME}"
echo "==> 总测试耗时: ${TOTAL_DURATION} 秒"
