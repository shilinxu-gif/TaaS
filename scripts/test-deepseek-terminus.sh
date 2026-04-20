#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3001}"
LOGIN="${LOGIN:-}"
PASSWORD="${PASSWORD:-}"
MODEL="${MODEL:-deepseek-ai/DeepSeek-V3.1-Terminus}"
PROMPT="${PROMPT:-请用一句中文介绍你自己，并说明当前使用的模型。}"
APPKEY_NAME="${APPKEY_NAME:-deepseek-self-test}"

if [[ -z "${LOGIN}" || -z "${PASSWORD}" ]]; then
  echo "请先提供 LOGIN 和 PASSWORD 环境变量，例如："
  echo "  LOGIN=your-admin PASSWORD=your-password MODEL=Qwen/Qwen3-32B PROMPT='你好' bash scripts/test-deepseek-terminus.sh"
  exit 1
fi

START_EPOCH="$(date +%s)"
START_TIME="$(date '+%Y-%m-%d %H:%M:%S')"

echo "==> 开始时间: ${START_TIME}"
echo "==> 登录平台账号"
LOGIN_JSON="$(curl -sS -X POST "${BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"login\":\"${LOGIN}\",\"password\":\"${PASSWORD}\"}")"

JWT_TOKEN="$(
  LOGIN_JSON="${LOGIN_JSON}" python3 - <<'PY'
import json, os, sys
data = json.loads(os.environ["LOGIN_JSON"])
token = data.get("token")
if not token:
    print(json.dumps(data, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit("登录失败，未拿到 token")
print(token)
PY
)"

echo "==> 创建测试 AppKey"
APPKEY_JSON="$(curl -sS -X POST "${BASE_URL}/app-keys" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${JWT_TOKEN}" \
  -d "$(APPKEY_NAME="${APPKEY_NAME}" MODEL="${MODEL}" python3 - <<'PY'
import json, os
print(json.dumps({
    "name": os.environ["APPKEY_NAME"],
    "description": "脚本自动创建的真实上游调用测试 Key",
    "environment": "development",
    "scopes": ["chat:complete"],
    "qpsLimit": 10,
    "allowedModels": [os.environ["MODEL"]],
}, ensure_ascii=False))
PY
)")"

APPKEY_TOKEN="$(
  APPKEY_JSON="${APPKEY_JSON}" python3 - <<'PY'
import json, os, sys
data = json.loads(os.environ["APPKEY_JSON"])
token = data.get("token")
if not token:
    print(json.dumps(data, ensure_ascii=False, indent=2), file=sys.stderr)
    raise SystemExit("创建 AppKey 失败，未拿到明文 token")
print(token)
PY
)"

echo "==> 调用本地网关"
CHAT_JSON="$(curl -sS -X POST "${BASE_URL}/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${APPKEY_TOKEN}" \
  -d "$(MODEL="${MODEL}" PROMPT="${PROMPT}" python3 - <<'PY'
import json, os
print(json.dumps({
    "model": os.environ["MODEL"],
    "messages": [
        {"role": "system", "content": "你是一个简洁的中文助手。"},
        {"role": "user", "content": os.environ["PROMPT"]},
    ],
    "temperature": 0.2,
}, ensure_ascii=False))
PY
)")"

echo "==> 调用结果"
CHAT_JSON="${CHAT_JSON}" python3 - <<'PY'
import json, os
data = json.loads(os.environ["CHAT_JSON"])
summary = {
    "model": data.get("model"),
    "reply": ((data.get("choices") or [{}])[0].get("message") or {}).get("content"),
    "usage": data.get("usage"),
}
print(json.dumps(summary, ensure_ascii=False, indent=2))
PY

END_EPOCH="$(date +%s)"
END_TIME="$(date '+%Y-%m-%d %H:%M:%S')"
DURATION="$((END_EPOCH - START_EPOCH))"

echo
echo "==> 结束时间: ${END_TIME}"
echo "==> 模型耗时: ${DURATION} 秒"
echo "完成。"
echo "你也可以自定义参数，例如："
echo "  LOGIN=your-admin PASSWORD=your-password MODEL=Qwen/Qwen3-32B PROMPT='你好' bash scripts/test-deepseek-terminus.sh"
