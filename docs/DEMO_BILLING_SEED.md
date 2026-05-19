# 演示账单造数脚本

该脚本用于给专属演示租户生成最近一段时间的 Token 消耗、账单、充值和开票数据。脚本默认只做 dry-run，不写数据库。

## 推荐执行方式

服务器上优先使用包装脚本：

```bash
scripts/seed-demo-billing.sh --dry-run
scripts/seed-demo-billing.sh --apply
```

如果项目不在当前目录，可指定项目目录：

```bash
APP_DIR=/srv/taas/app/TaaS scripts/seed-demo-billing.sh --apply
```

## Dry-run

```bash
DEMO_BILLING_SEED_CONFIRM=YES \
DEMO_TENANT_SLUG=aiot \
DEMO_TENANT_NAME=AIoT \
DEMO_USER_EMAIL=aiot@redtea.com \
npm run seed:demo-billing
```

## 正式写入

正式写入需要额外确认生产类环境风险，并在需要创建账号时提供密码：

```bash
DEMO_BILLING_SEED_CONFIRM=YES \
DEMO_BILLING_SEED_APPLY=YES \
DEMO_ALLOW_PROD_LIKE=YES \
DEMO_TENANT_SLUG=aiot \
DEMO_TENANT_NAME=AIoT \
DEMO_USER_EMAIL=aiot@redtea.com \
DEMO_USER_PASSWORD='admin123' \
npm run seed:demo-billing
```

可选参数：

- `DEMO_TENANT_SLUG`：演示租户 slug，默认 `aiot`
- `DEMO_TENANT_NAME`：控制台展示租户名称，默认 `AIoT`
- `DEMO_USER_EMAIL`：演示登录账号，默认 `aiot@redtea.com`
- `DEMO_USER_PASSWORD`：创建演示账号时使用的密码，默认 `admin123`
- `DEMO_USER_NAME`：演示用户名称，默认 `AIoT 演示账号`
- `DEMO_RESET_USER_PASSWORD=YES`：用户已存在时同步重置密码
- `DEMO_BATCH_ID`：批次标识，默认 `default`
- `DEMO_APPEND_DAILY_RECORDS`：是否追加当天新消耗记录，默认 `YES`；设为 `NO` 时按批次清理并完整重建历史数据
- `DEMO_DAYS`：生成最近多少天数据，默认 30，范围 1-90
- `DEMO_REQUESTS_PER_DAY`：每天请求数，默认 8，范围 1-50
- `DEMO_INITIAL_TOKENS`：演示租户初始余额，默认 `1587342917`
- `DEMO_RECHARGE_TOKENS`：演示充值到账 Token，默认 `523418769`
- `DEMO_INCLUDE_FINANCE=NO`：不生成充值和开票记录
- `DEMO_ALLOW_EXISTING_TENANT=YES`：允许使用未标记为演示的既有租户，仅限确认该租户为专属演示租户时使用

生成的数据在控制台可见字段中使用正式商用语义，例如生产调用密钥、智能设备诊断问答、预充值和开票信息；内部批次标记仅用于重复执行时清理，不作为订单名称或账单说明展示。默认执行 `--apply` 会追加一批当天新的 USD 和 Token 消耗记录，不清理历史请求/账单；如需完整重建历史数据，设置 `DEMO_APPEND_DAILY_RECORDS=NO`。今日非缓存消耗金额控制在约 `486.37 USD` 且低于 `500 USD`，避免展示为整数，Token 数按各模型单价换算，余额保持亿级，并生成缓存命中行用于展示缓存节省金额。模型消耗会不规律覆盖 `deepseekv4`、`gpt-5.4`、`claude-opus-4-7`、`GLM-5`，并分别对应 DeepSeek、OpenAI、Anthropic、GLM 供应商，避免模型和供应商不一致。

`aiot@redtea.com` 登录成功后，后端会自动检查当前 AIoT 租户当天是否已有登录自动追加记录；如果没有，会自动追加一批当天不同的 USD 和 Token 消耗记录，并从当前余额扣减本次用量。该自动逻辑只对 `aiot@redtea.com` 且租户 slug 为 `aiot` 生效，不影响其他账号。

为了避免演示账号余额显示为负数，AIoT 租户余额带有最低展示保护：登录自动检查会把低于 `836482917` 的余额补回该值；脚本追加扣减或完整重建时也不会把余额设置到该值以下。

演示数据避免使用过于整齐的数字：金额、预算、模型单价使用带小数的值，其中用量和账单金额按美元保留小数点后两位；Token 余额、充值到账、缓存节省和消耗量使用不整齐的整数值，减少界面上出现 `500000000`、`6800.00`、`5000.0000` 这类明显造数痕迹。

用量页展示的每条演示请求会控制在百万以内：`prompt_tokens`、`completion_tokens`、`total_tokens` 均小于 `1000000`，并避免 `00` 结尾的整齐 Token 数。超出上限的请求不会统一压到同一个固定值，而是按日期、序号和模型扰动到不同的百万以内区间，避免大量出现 `579990` 这类重复输入 Token。插入演示请求前会检查同租户当天已存在的模型、输入 Token、输出 Token、总 Token 和金额组合，如冲突则自动微调 Token 后重新计算金额；缓存命中记录仍保留 saved tokens 用于展示节省金额，但不会向 `usage_records` 写入 0 Token 的消耗行。

## 安全约束

- `scripts/seed-demo-billing.sh` 默认 `--dry-run` 不写库，只有 `--apply` 会自动带上正式写入确认变量。
- 邮箱不能使用 `@demo.local`，该后缀会被启动种子清理。
- 正式写入必须设置 `DEMO_BILLING_SEED_APPLY=YES` 和 `DEMO_ALLOW_PROD_LIKE=YES`。
- 脚本只清理同一租户下本脚本批次生成的日志、用量、账单、充值和开票记录。
- 脚本写入 `api_request_logs`、`usage_records`、`billing_records` 时保持 `log_id` 一致，并在结束时设置演示租户余额。
- 不要在真实客户租户上运行；应使用专属演示租户 slug。
