# TaaS

企业级 AI Gateway / Token Billing SaaS。

当前默认后端为 `backend-java/`（Spring Boot）。

## 当前能力

- 多租户控制台：注册即创建试用租户、默认预算、路由与缓存策略
- AppKey 管理：哈希存储、环境隔离、作用域、QPS/日预算/月预算
- OpenAI 兼容网关：`POST /v1/chat/completions`
- 真实上游适配：OpenAI、Anthropic、Google Gemini
- 成本与账单：按输入/输出 Token 单价落账，保留计费快照
- 运营能力：运营概览、供应商健康、审计日志
- 财务流程：套餐、充值、开票生产占位链路

## 本地启动

前置要求：

- Java 17+（生产建议 Java 21）
- Maven 3.9+
- Docker Desktop
- Node.js 20+（仅前端开发需要）

根目录执行：

```bash
npm run setup
npm run dev:server
npm run dev:client
```

默认地址：

- 前端：`http://localhost:5174`
- Java 后端：`http://localhost:3001`

初始化管理员：

- 通过环境变量 `BOOTSTRAP_ADMIN_LOGIN` / `BOOTSTRAP_ADMIN_PASSWORD` 配置
- 未配置时，系统不会自动创建或重置平台管理员账号

## 真实供应商配置

在根目录 `.env` 或运行环境中配置：

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `JWT_SECRET`
- `PROVIDER_CONFIG_SECRET`
- `APP_KEY_PEPPER`
- `BOOTSTRAP_ADMIN_LOGIN`
- `BOOTSTRAP_ADMIN_PASSWORD`

如未配置真实上游密钥，网关会直接返回上游未配置/不可用错误。

## Java 后端说明

- 主工程：`backend-java/`
- 默认本地数据库端口：`5433`
- 默认开发命令：`npm run dev:server`
- Docker Compose 中 `api` 服务已切换为 Java 后端
- Java 启动时会自动补齐基础 seed（套餐、provider 目录），并清理旧的历史测试种子数据
- Provider seed 不再写入固定上游地址，需由运维或管理员在部署后手动配置

## 商业化改造重点

- 真实多供应商网关与 fallback
- 可审计账单与预算控制
- RBAC、审计日志、AppKey 治理
- 运营与供应商健康视图
- 企业试用与升级链路