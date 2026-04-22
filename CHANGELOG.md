# CHANGELOG

## Unreleased

### 2026-04-22 15:05 控制台 JWT 默认有效期调整为 2 小时

- 改动内容：将租户控制台登录 JWT 的默认有效期从 7 天调整为 2 小时，并在环境变量示例中补充 `JWT_EXPIRE_SECONDS=7200`；当前前端已保留 `401` 后清理登录态并回到登录页的处理，因此 token 过期后，用户在页面中再次发起操作时会被要求重新登录。
- 影响范围：`backend-java/src/main/java/com/taas/infra/config/TaasProperties.java`、`backend-java/src/main/resources/application.yml`、`.env.example`。
- 验证情况：配置项已与 `JwtService.issue()` 的 `expiration` 逻辑对齐；前端现有 `api.ts` 未授权事件与 `Protected` 路由守卫可承接过期后的回登录流程。
- 运维动作：需要发布后端并重启 `taas-backend`；如线上希望沿用其他时长，需要显式设置环境变量 `JWT_EXPIRE_SECONDS` 后再重启服务；无需执行 SQL、迁移、清缓存。
- 线上数据影响：不影响任何存量业务数据；仅影响后续新签发的控制台 JWT 过期时间，已签发但尚未过期的旧 token 按原有效期继续生效。
- 风险控制：仅调整默认配置，不改动 JWT 签名算法与鉴权结构；支持通过环境变量覆盖，便于回退到更长或更短的有效期。

### 2026-04-22 14:45 网关试用按钮增加请求中状态

- 改动内容：为 `API 密钥` 页面中的 `网关试用` 发送按钮增加本地 loading 状态；点击后按钮文案切换为“请求中…”，并在请求完成前禁用，避免重复点击触发多次网关请求。
- 影响范围：`client/src/pages/ApiKeys.tsx`；影响控制台租户侧 `Gateway Playground` 的交互体验，不影响后端接口协议。
- 验证情况：已执行前端 `npm run build`，构建通过；页面逻辑已补充成功/失败后恢复按钮状态。
- 运维动作：仅需发布前端静态资源，无需执行 SQL、迁移、清缓存或补充环境变量。
- 线上数据影响：无存量数据变更；仅减少用户重复点击时可能产生的重复请求。
- 风险控制：仅引入前端本地状态控制，不改动网关请求参数与接口返回结构；如发现异常可单独回退前端资源。

### 2026-04-22 14:38 Claude Messages 网关与文档协议拆分

- 改动内容：新增真实可用的 Claude / Anthropic 风格网关入口 `POST /v1/messages` 与 `POST /gateway/v1/messages`，并同步更新模型广场、SDK 文档中心、README、复制示例与 API 密钥页提示，明确 Claude 不再复用 OpenAI 的 `chat/completions` 示例格式。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/*`、`backend-java/src/main/java/com/taas/auth/*`、`backend-java/src/main/resources/messages_*.properties`、`backend-java/src/test/java/com/taas/gateway/GatewayServiceTest.java`、`client/src/pages/ModelHub.tsx`、`client/src/pages/IntegrationDocs.tsx`、`client/src/pages/ApiKeys.tsx`、`README.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml -Dtest=GatewayServiceTest test` 通过；已执行前端 `npm run build` 通过；已检查相关页面无 linter 报错。
- 运维动作：需要发布后端新 `app.jar` 并重启 `taas-backend`，同时发布前端静态资源并 reload `nginx`；无需执行 SQL、Flyway 迁移、清缓存或补配置。
- 线上数据影响：不改写任何存量表数据；仅影响后续通过 Claude 协议入口发起的新请求，并继续向 `api_request_logs`、`usage_records`、`billing_records` 写入新增调用记录。
- 风险控制：保留原有 `POST /v1/chat/completions` 兼容路径不变；新增入口独立放行并补充单测，降低对现有 OpenAI 风格调用的回归风险；上线后需同时验证 `/v1/messages` 与 `/v1/chat/completions`。

### 2026-04-22 12:10 模型广场与模型目录接口上线

- 改动内容：新增租户侧 `模型广场` 页面与后端 `model-catalog` 只读接口，展示模型 ID、价格、能力标签、计费规则、协议说明，并支持复制模型 ID、cURL 与 SDK 示例。
- 影响范围：`backend-java/src/main/java/com/taas/console/ConsoleController.java`、`backend-java/src/main/java/com/taas/console/ConsoleService.java`、`client/src/App.tsx`、`client/src/Layout.tsx`、`client/src/api.ts`、`client/src/pages/ModelHub.tsx`、`client/src/pages/IntegrationDocs.tsx`、`client/src/pages/ApiKeys.tsx`、`client/src/i18n/resources.ts`、`client/src/styles.css`。
- 验证情况：已完成前后端联调；本地后端成功启动后已验证 `model-catalog` 可访问，前端构建通过。
- 运维动作：需要发布后端与前端；无需执行 SQL、手工数据修复、缓存清理或新增环境变量。
- 线上数据影响：无存量数据写入或结构变更；接口仅读取现有 `providers` / `model_catalog` 配置并向前端展示。
- 风险控制：后端接口为只读查询；页面入口仅面向租户展示，不影响既有管理与网关调用链路；如需回退可仅下线前端入口与接口路由。

### 2026-04-21 19:53 AppKey 自动选模型

- 改动内容：当租户网关请求未显式传入 `model` 时，若 `AppKey` 仅绑定一个模型则自动使用该模型；若绑定多个允许模型，则在当前可用模型中随机选择，并同步更新 Playground、SDK 文档与错误提示文案。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayService.java`、`backend-java/src/main/resources/messages_*.properties`、`client/src/pages/ApiKeys.tsx`、`client/src/pages/IntegrationDocs.tsx`。
- 验证情况：已补充并执行后端相关测试；前端说明与交互已同步更新并完成构建验证。
- 运维动作：需要发布后端与前端；无需执行 SQL、迁移、缓存清理或手工数据修复。
- 线上数据影响：不修改存量表数据；仅改变后续未传 `model` 请求的路由选择逻辑，并影响后续新增的 `api_request_logs`、`usage_records`、`billing_records` 记录内容。
- 风险控制：仅在请求缺省 `model` 时触发新逻辑；若 `AppKey` 未绑定默认模型，仍返回明确错误，避免无意路由到错误模型。
