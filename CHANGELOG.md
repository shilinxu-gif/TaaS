# CHANGELOG

## Unreleased

### 2026-04-22 20:35 管理员用户模型弹窗改为默认全选

- 改动内容：调整管理员“配置用户可用模型”弹窗的默认行为；当用户当前未设置专属模型白名单时，弹窗会自动勾选全部模型，直观表达“默认全部支持”，管理员只需手动取消勾选想排除的模型即可。
- 影响范围：`client/src/pages/AdminUsers.tsx`。
- 验证情况：已完成前端交互代码检查；后续通过前端构建确认弹窗初始状态与保存逻辑正常。
- 运维动作：仅需发布前端静态资源，无需执行 SQL、迁移、清缓存或重启后端。
- 线上数据影响：无存量数据结构变化；仅调整弹窗默认展示与保存时“全选 = 全部支持”的前端映射逻辑，不影响历史成员模型配置结果。
- 风险控制：后端仍沿用空数组表示“全部支持”的语义；前端仅在展示和提交时做等价映射，避免把“默认全部支持”误显示为“一个都没选”。

### 2026-04-22 20:30 AppKey 创建改为继承管理员配置的用户模型范围

- 改动内容：租户侧 `API 密钥` 创建弹窗移除“允许模型”选择项，新建 AppKey 时默认不再由用户手工勾选模型；后端会按当前用户在当前租户下的成员配置自动写入可用模型范围，未配置时默认支持全部模型。同时为平台管理员新增“按用户 / 租户成员关系配置可用模型”的后台入口。
- 影响范围：`client/src/pages/ApiKeys.tsx`、`client/src/pages/AdminUsers.tsx`、`client/src/api.ts`、`backend-java/src/main/java/com/taas/console/ConsoleController.java`、`backend-java/src/main/java/com/taas/console/ConsoleService.java`、`backend-java/src/main/resources/db/migration/V20260422200000__tenant_member_allowed_models.sql`。
- 验证情况：已执行前端 `npm run build` 通过；已执行 `mvn -f backend-java/pom.xml -Dtest=GatewayServiceTest test` 通过；最近改动文件无 linter 报错。
- 运维动作：需要发布后端并重启 `taas-backend`，同时发布前端静态资源；数据库需执行新增迁移，为 `tenant_members` 增加 `allowed_models` 字段；无需额外补充环境变量或清缓存。
- 线上数据影响：会为 `tenant_members` 新增 `allowed_models` 字段，默认值为空数组，表示不限制模型；不修改任何存量 `app_keys.allowed_models`、`api_request_logs`、`usage_records`、`billing_records` 历史数据，仅影响后续新创建 AppKey 的默认模型范围和租户页面可见模型列表。
- 风险控制：迁移字段默认值为 `[]`，兼容现有成员关系；若管理员未配置用户模型白名单，系统继续按“全部模型可用”处理；后台配置入口仅对平台管理员开放，避免租户侧误改用户权限。

### 2026-04-22 20:25 AppKey 创建默认授予全部权限

- 改动内容：移除 `API 密钥` 创建弹窗中的“权限域”选择项，并从列表中隐藏该字段展示；后端创建 AppKey 时默认授予全部权限域（`chat:complete`、`usage:read`、`billing:read`、`admin:ops`），用户新建时无需手动勾选。
- 影响范围：`client/src/pages/ApiKeys.tsx`、`backend-java/src/main/java/com/taas/console/ConsoleService.java`。
- 验证情况：已完成前后端代码检查；后续通过前端构建与后端定向测试确认默认权限和页面展示正常。
- 运维动作：需要发布后端并重启 `taas-backend`，同时发布前端静态资源；无需执行 SQL、迁移、清缓存或新增环境变量。
- 线上数据影响：不修改任何存量 `app_keys.scopes` 数据；仅影响后续新创建的 AppKey 默认权限集合，历史已创建密钥保持原有权限不变。
- 风险控制：仅简化新建流程并调整默认值，不改变已有 AppKey 的实际权限；后端仍保留 `scopes` 字段校验与更新能力，便于后续兼容管理端扩展。

### 2026-04-22 20:15 API 密钥删除按钮改为垃圾桶图标

- 改动内容：将 `API 密钥` 列表中的删除操作从文字按钮改为纯垃圾桶图标按钮，保留悬浮提示与无障碍标签，避免列表操作列视觉过重。
- 影响范围：`client/src/pages/ApiKeys.tsx`、`client/src/icons.tsx`、`client/src/styles.css`。
- 验证情况：已完成前端代码检查；后续通过 lint 与前端构建确认样式和交互正常。
- 运维动作：仅需发布前端静态资源，无需执行 SQL、迁移、清缓存或重启后端。
- 线上数据影响：无；仅调整前端展示，不改变删除接口、删除条件与历史数据保留策略。
- 风险控制：删除弹窗、5 秒倒计时与后端删除接口保持不变，仅替换触发按钮样式；保留 `title` 与 `aria-label`，降低可用性回退风险。

### 2026-04-22 20:05 API 密钥支持危险删除确认

- 改动内容：在 `API 密钥` 列表中新增删除按钮，并增加二次确认弹窗；删除确认采用 5 秒倒计时后才允许点击，交互风格与删除供应商保持一致；后端同步新增 `DELETE /app-keys/{id}` 接口。
- 影响范围：`client/src/pages/ApiKeys.tsx`、`backend-java/src/main/java/com/taas/console/ConsoleController.java`、`backend-java/src/main/java/com/taas/console/ConsoleService.java`。
- 验证情况：已完成前后端代码联动检查；后续将通过前端构建与后端定向测试确认无回归。
- 运维动作：需要发布后端并重启 `taas-backend`，同时发布前端静态资源；无需执行 SQL、迁移、清缓存或补充环境变量。
- 线上数据影响：删除操作仅影响被删除的 `app_keys` 记录本身；不会删除历史 `api_request_logs`、`usage_records`、`billing_records` 等存量调用记录。
- 风险控制：删除前加入 5 秒倒计时确认，降低误删风险；历史日志不跟随删除，方便审计与追溯；仅 `owner` / `admin` 等具备管理权限的租户角色可执行删除。

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
