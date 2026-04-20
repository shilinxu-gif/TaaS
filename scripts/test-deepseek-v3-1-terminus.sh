#!/usr/bin/env bash
set -euo pipefail

LOGIN="${LOGIN:?请设置 LOGIN}"
PASSWORD="${PASSWORD:?请设置 PASSWORD}"
PROMPT="${PROMPT:-帮我写一个Java的冒泡排序}"

LOGIN="${LOGIN}" \
PASSWORD="${PASSWORD}" \
MODEL="deepseek-ai/DeepSeek-V3.1-Terminus" \
PROMPT="${PROMPT}" \
APPKEY_NAME="deepseek-v3-1-terminus-test" \
bash "$(dirname "$0")/test-deepseek-terminus.sh"
