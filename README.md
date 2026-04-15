# TaaS

企业级 AI Gateway / Token Billing SaaS。

## 当前能力

- 多租户控制台：注册即创建试用租户、默认预算、路由与缓存策略
- AppKey 管理：哈希存储、环境隔离、作用域、QPS/日预算/月预算
- OpenAI 兼容网关：`POST /v1/chat/completions`
- 真实上游适配：OpenAI、Anthropic、Google Gemini
- 成本与账单：按输入/输出 Token 单价落账，保留计费快照
- 运营能力：运营概览、供应商健康、审计日志
- 财务流程：套餐、充值、开票演示链路

## 本地启动

前置要求：

- Node.js 20+
- Docker Desktop

根目录执行：

```bash
npm run setup
npm run dev:server
npm run dev:client
```

默认地址：

- 前端：`http://localhost:5174`
- 后端：`http://localhost:3001`

演示账号：

- `wangqiang / 123456`
- `liwei / 123456`

## 真实供应商配置

在根目录 `.env` 或运行环境中配置：

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `JWT_SECRET`
- `PROVIDER_CONFIG_SECRET`
- `APP_KEY_PEPPER`

如果未配置真实上游密钥，开发环境下网关会返回一条明确的演示回复，用于本地联调控制台。

## 商业化改造重点

- 真实多供应商网关与 fallback
- 可审计账单与预算控制
- RBAC、审计日志、AppKey 治理
- 运营与供应商健康视图
- 企业试用与升级链路