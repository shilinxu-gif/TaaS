#!/usr/bin/env bash
set -euo pipefail

LOGIN="${LOGIN:?请设置 LOGIN}"
PASSWORD="${PASSWORD:?请设置 PASSWORD}"
PROMPT="${PROMPT:-帮我写一个Java的冒泡排序}"

LOGIN="${LOGIN}" \
PASSWORD="${PASSWORD}" \
MODEL="Qwen3.5-397B-A17B" \
PROMPT="${PROMPT}" \
APPKEY_NAME="qwen3-5-397b-a17b-test" \
bash "$(dirname "$0")/test-deepseek-terminus.sh"
