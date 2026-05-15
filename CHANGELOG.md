# CHANGELOG

## Unreleased

### 2026-05-15 19:03 演示造数：新增一键执行脚本

- 改动内容：新增 `scripts/seed-demo-billing.sh`，内置 AIoT 演示账号、租户和密码默认值，支持 `--dry-run` 与 `--apply` 两种模式；同步更新 `docs/DEMO_BILLING_SEED.md`，说明阿里云服务器上直接执行包装脚本的方式。
- 影响范围：`scripts/seed-demo-billing.sh`、`docs/DEMO_BILLING_SEED.md`、`CHANGELOG.md`。
- 验证情况：已执行 `bash -n scripts/seed-demo-billing.sh`、`mvn -f backend-java/pom.xml -DskipTests compile`、`mvn -f backend-java/pom.xml test` 通过；`ReadLints` 检查相关脚本与文档无新增诊断。
- 运维动作：发版后在服务器项目根目录执行 `scripts/seed-demo-billing.sh --dry-run` 预览，确认无误后执行 `scripts/seed-demo-billing.sh --apply` 写入演示数据；如项目目录不同，可设置 `APP_DIR=/srv/taas/app/TaaS`。
- 线上数据影响：`--dry-run` 不写库；`--apply` 会通过既有 Java 造数入口向 AIoT 演示租户写入/更新演示账号、租户、AppKey、请求日志、用量、账单、充值和开票记录。
- 风险控制：脚本默认 dry-run；正式写入仍走 Java 入口的双确认、租户隔离、`@demo.local` 拒绝和批次清理保护；不应在真实客户租户上执行。

### 2026-05-15 18:51 演示造数：默认账号改为 AIoT

- 改动内容：将演示账单造数脚本的默认演示信息调整为登录账号 `aiot@redtea.com`、默认密码 `admin123`、租户展示名 `AIoT`、租户 slug `aiot`，并新增 `DEMO_TENANT_NAME` 参数；同步更新 `docs/DEMO_BILLING_SEED.md` 的 dry-run 与正式写入示例。
- 影响范围：`backend-java/src/main/java/com/taas/tools/DemoBillingSeedCommand.java`、`docs/DEMO_BILLING_SEED.md`、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml -DskipTests compile`、`mvn -f backend-java/pom.xml test` 通过；`ReadLints` 检查相关 Java/Markdown 文件无新增诊断。
- 运维动作：发版并重启后端后生效；执行 `npm run seed:demo-billing` 时可省略默认账号、密码与展示租户名参数，也可通过环境变量覆盖。
- 线上数据影响：仅在显式执行演示造数脚本且设置正式写入确认变量时，影响指定演示租户与账号相关数据；不自动修改线上存量数据。
- 风险控制：仍保留正式写入双确认、`@demo.local` 拒绝、非演示租户默认拒绝复用等保护；默认密码仅用于演示账号，生产客户账号不要复用。

### 2026-05-15 18:36 演示账单造数脚本

- 改动内容：新增 `DemoBillingSeedCommand` 专用命令入口和 `demo-billing-seed` profile，用于按指定演示租户生成账号、AppKey、请求日志、用量、账单、充值和开票演示数据；脚本默认 dry-run，正式写入需 `DEMO_BILLING_SEED_APPLY=YES` 与 `DEMO_ALLOW_PROD_LIKE=YES` 双确认；默认种子 Runner 与 Web Security FilterChain 在该 profile 下不执行，避免 dry-run 隐式写库或启动 Web 安全链路；新增 `npm run seed:demo-billing` 与操作文档。
- 影响范围：`backend-java/src/main/java/com/taas/tools/DemoBillingSeedCommand.java`、`backend-java/src/main/java/com/taas/boot/SeedDataRunner.java`、`backend-java/src/main/java/com/taas/auth/SecurityConfig.java`、`package.json`、`docs/DEMO_BILLING_SEED.md`、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml -DskipTests compile`、`mvn -f backend-java/pom.xml test` 通过；`ReadLints` 检查新增/改动 Java 文件无诊断；已执行 dry-run 命令验证专用 profile 启动且不触发 Flyway，但本机 Docker daemon 未运行、Postgres 连接失败，未完成数据库级 dry-run 输出与正式写入验证。
- 运维动作：发版并重启后端后可使用；执行造数前先确认目标环境已完成 Flyway 迁移，并按 `docs/DEMO_BILLING_SEED.md` 设置环境变量运行 `npm run seed:demo-billing`。正式写入必须使用专属演示租户，不要在真实客户租户上执行。
- 线上数据影响：仅在显式执行且设置正式写入确认变量时，向指定演示租户写入或更新 `users`、`tenants`、`tenant_members`、`tenant_routing_strategies`、`tenant_cache_settings`、`app_keys`、`api_request_logs`、`usage_records`、`billing_records`、`wallet_recharge_orders`、`invoice_requests`；不会自动随服务启动写入数据。重复执行会清理同租户下本脚本批次标记的数据后重建。
- 风险控制：脚本拒绝 `@demo.local` 邮箱；未设置确认变量默认退出或 dry-run；正式写入需额外确认生产类环境风险；既有非演示租户默认拒绝复用，除非显式 `DEMO_ALLOW_EXISTING_TENANT=YES`；脚本入口强制禁用 Flyway，避免造数时隐式迁移。

### 2026-04-28 补提交：ConsoleService modelCatalog 能力标签逻辑入库

- 改动内容：将此前未提交的 `ConsoleService.java` 变更纳入版本控制，包括 `modelCatalog` 从 `modelCatalog` JSON 项读取 `capabilityTags`（数组或逗号分隔字符串）、空配置时回退 `chat`/`streaming`，以及创建/更新供应商时对 `capabilityTags` 类型与单标签长度的校验
- 影响范围：`backend-java/src/main/java/com/taas/console/ConsoleService.java`、`CHANGELOG.md`
- 验证情况：已执行 `mvn -f backend-java/pom.xml test` 通过
- 运维动作：发版并重启 Java 后端生效；无需新增迁移或手工 SQL
- 线上数据影响：无；仅改变读取与校验逻辑，不写新表
- 风险控制：与既有「模型能力标签」发版说明一致；非法 `capabilityTags` 仍会在保存供应商时被拒绝

### 2026-04-28 管理员供应商：列表上移/下移调整模型广场顺序

- 改动内容：后端 `modelCatalog` 已按供应商 `priority` 升序合并模型目录；前端 `AdminProviders.tsx` 将列表按优先级与名称排序展示，新增「排序」列的上移/下移按钮，通过 PATCH 仅更新 `priority`（含与相邻行优先级相同时的避让逻辑）完成重排；页头与「优先级」表单项补充说明其与模型广场合并顺序的关系；保存/新增/删除供应商及重排成功后失效 `model-catalog` 查询；`ModelHub.tsx` 对筛选结果按 `priority`、供应商名、模型 ID 排序以与后台一致
- 影响范围：`client/src/pages/AdminProviders.tsx`、`client/src/pages/ModelHub.tsx`、`CHANGELOG.md`
- 验证情况：已执行 `ReadLints`（上述 TSX 无新增诊断）、`npm run build --prefix client` 通过
- 运维动作：仅需发版前端静态资源；无需数据库迁移或后端接口变更
- 线上数据影响：无；仍仅更新既有 `providers.priority` 字段，不写新表
- 风险控制：重排为两次顺序 PATCH，极端同优先级且均为 999 时上移可能受 `priority` 上限约束，管理员仍可通过数字输入微调

### 2026-04-28 前端：移除中文展示文案中的全角句号

- 改动内容：在 `client/src` 内对含用户可见中文的页面与组件（含 `IntegrationDocs`、`ModelHub`、`ApiKeys`、`AdminProviders`、`BillingRechargeSection`、`i18n/resources.ts` 等）统一去掉全角句号 `。`，英文句点与代码逻辑不变。
- 影响范围：`client/src/pages/IntegrationDocs.tsx`、`ModelHub.tsx`、`ApiKeys.tsx`、`AdminProviders.tsx`、`AdminUsers.tsx`、`AdminUsage.tsx`、`Billing.tsx`、`Dashboard.tsx`、`Routing.tsx`、`Recharge.tsx`、`Invoices.tsx`、`Customers.tsx`、`Accounts.tsx`、`Contacts.tsx`、`Leads.tsx`、`client/src/components/BillingRechargeSection.tsx`、`client/src/i18n/resources.ts`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；`client/src` 内已无 `。` 字符。
- 运维动作：仅需发版前端静态资源；本地可依赖 Vite HMR。
- 线上数据影响：无。
- 风险控制：纯展示层标点调整，不涉及接口与业务规则。

### 2026-04-28 SDK 文档中心：精简概览首段 Base URL 引导文案

- 改动内容：`IntegrationDocs.tsx` 概览区首段去掉「首屏只需记住一个 Base URL：」前缀，其余关于根域名、按供应商族查看 path、以及多模态 `gateway/v1/...` 的说明保持不变。
- 影响范围：`client/src/pages/IntegrationDocs.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `ReadLints`（`IntegrationDocs.tsx` 无新增诊断）、`npm run build --prefix client` 通过。
- 运维动作：仅需发版前端静态资源；本地可依赖 Vite HMR。
- 线上数据影响：无。
- 风险控制：纯文案。

### 2026-04-28 模型广场：精简首页说明与推荐接入形态展示文案

- 改动内容：`ModelHub.tsx` 将模型广场首段说明改为仅强调可快速查看模型 ID、输入/输出价格、流式能力与计费规则；统计卡片「推荐接入形态」下方由「OpenAI / Claude 分开展示」改为展示「OpenAI / Claude」。
- 影响范围：`client/src/pages/ModelHub.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `ReadLints`（`ModelHub.tsx` 无新增诊断）、`npm run build --prefix client` 通过。
- 运维动作：仅需发版前端静态资源；本地开发环境可依赖 Vite HMR，无 SQL 与后端依赖。
- 线上数据影响：无；仅用户可见文案调整。
- 风险控制：纯文案，不涉及接口与路由逻辑。

### 2026-04-28 管理员供应商：保存后模型目录 JSON 不再被旧缓存覆盖

- 改动内容：`AdminProviders.tsx` 中保存供应商的 `onSuccess` 改为用 PATCH 返回的最新 `ProviderConfigRow` 调用 `buildForm` 更新表单，并对 `["admin","providers"]` 执行 `setQueryData` 合并该行；移除在 refetch 完成前用 `rows.find` 重建表单的逻辑，避免保存成功后界面上的模型目录 JSON 短暂回退为旧内容。
- 影响范围：`client/src/pages/AdminProviders.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `ReadLints`（`AdminProviders.tsx` 无新增诊断）、`npm run build --prefix client` 通过。
- 运维动作：仅需发版前端静态资源；本地开发环境需重启前端服务生效。无 SQL、迁移或后端依赖。
- 线上数据影响：无；仅修正前端保存成功后的本地状态同步，不改变接口或数据库写入行为。
- 风险控制：与后端 `updateProvider` 返回整行供应商配置的行为一致；若未来 PATCH 不返回完整行需同步调整前端类型与赋值逻辑。

### 2026-04-28 15:34 模型能力标签：支持按模型动态配置并在模型广场筛选

- 改动内容：后端 `ConsoleService` 支持从供应商 `modelCatalog` 每个模型项读取 `capabilityTags`（支持数组或字符串配置），模型广场接口优先返回配置标签，未配置时回退默认 `chat/streaming`；前端 `AdminProviders.tsx` 的模型目录默认模板新增 `capabilityTags`，并在编辑/新增表单补充能力标签配置示例；`ModelHub.tsx` 扩展能力标签映射与展示，支持对话、思考、文生图、图生图、文案生成、图片生成、推理、代码能力、图生视频、视频生产、文案能力等标签的展示与筛选。
- 影响范围：`backend-java/src/main/java/com/taas/console/ConsoleService.java`、`client/src/pages/AdminProviders.tsx`、`client/src/pages/ModelHub.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `ReadLints`（改动文件无新增诊断）、`npm run build --prefix client`、`mvn -f backend-java/pom.xml test` 均通过。
- 运维动作：发版并重启后端与前端服务生效；无需新增数据库迁移与手工 SQL。若已有供应商需要能力标签，请在供应商模型目录 JSON 中为模型项补充 `capabilityTags`。
- 线上数据影响：无表结构变更；仅当管理员更新供应商 `model_catalog` 时会写入或更新模型能力标签，不影响历史请求日志、账单、余额或密钥数据。
- 风险控制：保持未配置标签时的默认能力回退逻辑，避免旧数据导致模型广场能力列为空；能力标签仅用于展示与筛选，不参与路由和计费决策。

### 2026-04-28 14:57 软著材料命名统一：Token分销字段改为算力无限

- 改动内容：将软著相关文档中的“Token分销平台/Token分销”名称字段统一替换为“算力无限”，同步更新说明书与申请表文本文件，并对 `docs/` 下相关 `.docx` 内部 XML 文本执行同样替换，确保导出版名称一致。
- 影响范围：`docs/SOFTWARE_COPYRIGHT_TOKEN_DISTRIBUTION_PLATFORM_V1.0.0.md`、`docs/SOFTWARE_COPYRIGHT_TOKEN_DISTRIBUTION_PLATFORM_V1.0.0_SOURCE_CODE.txt`、`docs/计算机软件著作权登记申请表_已补充.txt` 及 `docs/` 下相关软著 `.docx` 文件、`CHANGELOG.md`。
- 验证情况：已检索 `docs/` 目录，确认不再包含“Token分销”文本；已抽查申请表与说明书内容显示为“算力无限”。
- 运维动作：无；纯软著文档内容调整，不需要重启前后端服务，不需要执行 SQL 或迁移。
- 线上数据影响：无。
- 风险控制：仅替换软著材料命名字段，不涉及业务代码逻辑；建议提交软著前再人工核对公司证照信息与日期字段。

### 2026-04-28 14:26 认证：切页遇到 403 时自动退出登录

- 改动内容：`client/src/api.ts` 调整会话失效判定逻辑，除 `401` 外，对带 JWT 的请求在返回疑似认证失效的 `403` 时也会清理本地 `crm_token` 并触发 `crm:unauthorized`，避免 token 过期后切页只弹 `HTTP 403` 而不自动跳登录页。
- 影响范围：`client/src/api.ts`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；已核对 `client/src/api.ts` 会话失效判定逻辑（`401` 与疑似认证失效 `403`）生效。
- 运维动作：仅需发版前端静态资源；本地开发环境需重启前后端开发服务生效。无数据库迁移与 SQL 操作。
- 线上数据影响：无；仅调整前端鉴权失败处理流程，不修改任何业务数据。
- 风险控制：仅在存在控制台 JWT 的请求上生效；保留原有错误抛出路径，避免影响正常错误提示。

### 2026-04-28 12:13 管理员：调整供应商编辑区上间距

- 改动内容：`AdminProviders.tsx` 为供应商编辑区域增加专用样式类，`styles.css` 补充顶部间距，避免编辑标题贴近上方供应商列表。
- 影响范围：`client/src/pages/AdminProviders.tsx`、`client/src/styles.css`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；已人工核对 `AdminProviders.tsx` 与 `styles.css` 改动位置。
- 运维动作：仅需发版前端静态资源；本地开发环境需重启前端服务生效。无数据库与后端依赖。
- 线上数据影响：无；仅调整管理员供应商页面展示间距，不改写任何业务数据。
- 风险控制：使用页面专用类限制影响范围，不改变通用 `bill-section` 间距，避免影响其他页面布局。

### 2026-04-28 12:06 前端：补齐控制台中英文适配

- 改动内容：补齐管理员供应商、管理员统计、充值、开票、账单、工作台风险提醒、路由说明、品牌图标替代文本，以及旧 CRM 页面（联系人、客户、线索、商机、客户列表）的中英文适配；将可见中文硬编码接入 `pickText` / `useTranslation`，并对部分后端返回的账单、充值、开票、风险提示标签做前端双语兜底展示。
- 影响范围：`client/src/pages/AdminProviders.tsx`、`AdminUsage.tsx`、`Invoices.tsx`、`Billing.tsx`、`Dashboard.tsx`、`Routing.tsx`、`client/src/components/BillingRechargeSection.tsx`、`client/src/BrandLogo.tsx`、旧 CRM 页面与 `CHANGELOG.md`。
- 验证情况：已执行 `ReadLints` 检查本轮前端改动文件无新增诊断；已执行 `npm run build --prefix client` 通过，仅保留 Vite 大 chunk 提示。
- 运维动作：仅需发版前端静态资源；本地开发环境需重启前端服务生效。无需执行 SQL、迁移、清缓存或重启后端。
- 线上数据影响：无；仅调整前端展示文案和语言选择逻辑，不读写或迁移业务数据。
- 风险控制：改动限定在用户可见文案与本地标签映射，保留原有 API 字段、筛选、排序、提交和删除逻辑；英文环境缺少后端多语言字段时使用前端兜底，避免继续显示中文状态。

### 2026-04-28 11:54 供应商：新增弹窗不再预填模型厂商

- 改动内容：`AdminProviders.tsx` 将新增供应商弹窗中的模型厂商默认值改为空，切换协议类型时不再自动覆盖模型厂商，避免默认预填 OpenAI。
- 影响范围：`client/src/pages/AdminProviders.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；`ReadLints` 检查 `AdminProviders.tsx` 与 `CHANGELOG.md` 无新增诊断。
- 运维动作：仅需发版前端静态资源；本地开发环境需重启前端服务生效。无数据库与后端依赖。
- 线上数据影响：无；仅调整新增供应商弹窗默认表单值，不改写 `providers.model_vendor` 存量数据。
- 风险控制：管理员仍可从下拉候选选择模型厂商或手动填写，不影响编辑已有供应商。

### 2026-04-28 11:51 供应商：模型厂商候选补充 Qwen 与 BAAI

- 改动内容：`AdminProviders.tsx` 在模型厂商预设下拉候选中补充 Qwen、BAAI，新增或编辑供应商时可直接选择；仍支持手动填写其他厂商并加入候选。
- 影响范围：`client/src/pages/AdminProviders.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；`ReadLints` 检查 `AdminProviders.tsx` 与 `CHANGELOG.md` 无新增诊断。
- 运维动作：仅需发版前端静态资源；本地开发环境需重启前端服务生效。无数据库与后端依赖。
- 线上数据影响：无；仅调整管理员供应商表单候选项，不改写 `providers.model_vendor` 存量数据。
- 风险控制：候选补充不改变已保存字段值，也不限制自由输入。

### 2026-04-28 11:48 供应商：扩展模型厂商下拉候选

- 改动内容：`AdminProviders.tsx` 将模型厂商预设候选扩展为 Anthropic、Google、OpenAI、DeepSeek、Tongyi、BytePlus、xAI、Zhipu、MiniMax、Kling、Moonshot；下拉列表同时合并已有供应商保存的厂商值和当前手动输入的新值，使新增或编辑时可下拉选择，也可直接填写新厂商并加入候选。
- 影响范围：`client/src/pages/AdminProviders.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；`ReadLints` 检查 `AdminProviders.tsx` 与 `CHANGELOG.md` 无新增诊断。
- 运维动作：仅需发版前端静态资源；本地开发环境需重启前端服务生效。无数据库与后端依赖。
- 线上数据影响：无；仅调整管理员供应商表单的前端候选项，不改写 `providers.model_vendor` 存量数据。
- 风险控制：候选扩展不限制自由输入，避免阻断未预设的新模型厂商。

### 2026-04-28 11:43 供应商：新增模型厂商字段与模型广场筛选

- 改动内容：新增 Flyway 迁移为 `providers` 表增加 `model_vendor` 字段，并按既有 slug / provider_type 回填 OpenAI、Anthropic、Google、DeepSeek、Qwen 等默认厂商；后端供应商创建、编辑、列表和模型广场目录接口读写并返回 `modelVendor`；管理员供应商表单支持填写模型厂商，模型广场新增“模型厂商”筛选并在卡片中展示厂商信息。
- 影响范围：`backend-java/src/main/resources/db/migration/V20260428114500__providers_model_vendor.sql`、`SeedDataRunner.java`、`ConsoleService.java`、`client/src/api.ts`、`AdminProviders.tsx`、`ModelHub.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml test`、`npm run build --prefix client` 通过；`ReadLints` 检查后端、前端与 `CHANGELOG.md` 相关改动文件无新增诊断。
- 运维动作：发版并重启后端以执行 Flyway 迁移；发版前端静态资源。无需手工 SQL，除非目标环境禁用了 Flyway。
- 线上数据影响：`providers` 表新增可空字段 `model_vendor`；迁移仅回填当前 `model_vendor IS NULL` 的供应商行，不改写已有非空厂商值，不影响请求日志、账单、余额或 AppKey 数据。
- 风险控制：模型广场筛选仅读新字段做前端过滤；未填写厂商的模型仍可在“全部厂商”下展示，避免隐藏现有可用模型。

### 2026-04-28 11:31 后端：移除 DeepSeek 组合供应商种子

- 改动内容：`SeedDataRunner` 移除默认种子供应商 `deepseek-v3-1-terminus`，避免管理员删除该供应商后在后端重启时再次自动补建；其他默认供应商与单模型种子保持不变。
- 影响范围：`backend-java/src/main/java/com/taas/boot/SeedDataRunner.java`、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml test` 通过；`ReadLints` 检查 `SeedDataRunner.java` 与 `CHANGELOG.md` 无新增诊断。
- 运维动作：发版并重启后端服务生效；无需执行 SQL、迁移或清缓存。
- 线上数据影响：不会自动删除线上已有 `providers.slug = 'deepseek-v3-1-terminus'` 行；仅影响后续服务启动时不再自动新增该种子行。若线上已存在且需要移除，仍需管理员在控制台删除或按明确范围手工删除该供应商。
- 风险控制：变更仅删除一个启动种子声明，不修改网关路由、模型匹配、计费或已存在供应商配置。

### 2026-04-28 11:24 管理员：新增供应商 Base URL 支持选择已有地址

- 改动内容：`AdminProviders.tsx` 在新增供应商弹窗中为 Base URL 输入框增加已有供应商 Base URL 的下拉候选，候选文案带上供应商与模型信息；输入框仍保留自由输入能力，可直接填写新的上游地址。
- 影响范围：`client/src/pages/AdminProviders.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；`ReadLints` 检查 `AdminProviders.tsx` 与 `CHANGELOG.md` 无新增诊断。
- 运维动作：仅需发版前端静态资源；本地开发环境需重启前端服务生效。无数据库与后端依赖。
- 线上数据影响：无；仅影响管理员新建供应商时的表单交互，不改写存量 `providers` 数据。
- 风险控制：变更限定在新增供应商弹窗的 Base URL 输入控件；选择候选和手动输入共用原有提交字段，后端保存逻辑不变。

### 2026-04-27 19:51 SDK 文档中心：快速开始页两列等分铺满

- 改动内容：`IntegrationDocs.tsx` 将快速开始标签页从通用三列网格改为 `integration-grid--quickstart` 专用布局；`styles.css` 增加两列等分、等高撑满样式，使“5 分钟快速开始”和“环境变量参考”在宽屏下平均占据页面宽度，请求规范模块继续作为下方全宽独立模块展示。
- 影响范围：`client/src/pages/IntegrationDocs.tsx`、`client/src/styles.css`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；`ReadLints` 检查 `IntegrationDocs.tsx` 与 `styles.css` 无新增诊断。
- 运维动作：仅需发版前端静态资源；本地开发环境需重启前端服务生效。无数据库与后端依赖。
- 线上数据影响：无。
- 风险控制：变更仅影响 SDK 文档中心快速开始标签页排版；窄屏仍回退单列，避免横向溢出。

### 2026-04-27 19:50 SDK 文档中心：请求规范改为全宽独立模块

- 改动内容：`IntegrationDocs.tsx` 将快速开始标签页内的“请求规范”卡片标记为独立全宽模块；`styles.css` 让该模块跨越整行、排在快速开始与环境变量之后，并将内部 OpenAI/Gemini 与 Claude 两组协议规范改为纵向排列，同时限制卡片、协议块和角色说明区域的最大宽度与溢出。
- 影响范围：`client/src/pages/IntegrationDocs.tsx`、`client/src/styles.css`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；`ReadLints` 检查 `IntegrationDocs.tsx` 与 `styles.css` 无新增诊断。
- 运维动作：仅需发版前端静态资源；本地开发环境需重启前端服务生效。无数据库与后端依赖。
- 线上数据影响：无。
- 风险控制：变更仅影响 SDK 文档中心快速开始标签页的请求规范排版；接口地址、鉴权方式和示例文案不变。

### 2026-04-27 19:45 SDK 文档中心：改为标签页分区并锁定横向溢出

- 改动内容：`IntegrationDocs.tsx` 新增文档分区状态，将原本全部顺序堆叠的 SDK 文档中心改为顶部标签切换展示；概览、OpenAI 系、Claude 系、Gemini 系、能力边界、快速开始、请求与返回、错误与排查、限流策略、FAQ、更新记录、上线建议按标签独立显示。`styles.css` 增加文档页、卡片、网格、供应商族面板、代码块的 `min-width` / `max-width` / `overflow-x` 约束，代码块允许换行，避免横向布局撑出页面滚动。
- 影响范围：`client/src/pages/IntegrationDocs.tsx`、`client/src/styles.css`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；`ReadLints` 检查 `IntegrationDocs.tsx` 与 `styles.css` 无新增诊断。
- 运维动作：仅需发版前端静态资源；本地开发环境需重启前端服务生效。无数据库与后端依赖。
- 线上数据影响：无。
- 风险控制：仅调整 SDK 文档中心的展示结构与响应式布局，不改变实际接口地址、鉴权方式和示例内容；标签页隐藏非当前分区，减少单页内容过长与横向溢出风险。

### 2026-04-27 19:39 SDK 文档中心：修复请求规范模块窄屏布局重叠

- 改动内容：调整 `IntegrationDocs` 请求规范模块相关样式：`integration-contract-grid` 在中等宽度下避免两列过窄，`integration-contract-block` 与 `integration-spec-item` 增加可收缩约束，规范项由 flex 改为网格布局，长 URL/鉴权字段使用 `overflow-wrap: anywhere` 断行；小屏下规范项改为纵向展示，避免内容互相覆盖。
- 影响范围：`client/src/styles.css`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；`ReadLints` 检查 `client/src/styles.css` 无新增诊断。
- 运维动作：仅需发版前端静态资源；本地开发环境需重启前端服务生效。无数据库与后端依赖。
- 线上数据影响：无。
- 风险控制：变更限定在 SDK 文档中心请求规范及其响应式样式；长字符串改为断行展示，不改变文档内容和接口示例。

### 2026-04-24 管理员：新增模型供应商（POST /providers）

- 改动内容：后端 `ConsoleController` 增加 `POST /providers`，`ConsoleService#createProvider` 校验名称/slug/协议类型、slug 唯一性，写入 `providers` 表并写审计；`normalizeProviderSlug` 规范化 slug。前端 `AdminProviders.tsx` 增加「新增供应商」按钮与创建弹窗（名称、slug、openai/anthropic/google、启用、优先级、超时、可选 Base URL、健康状态、流式开关、可选 API Key、模型目录 JSON），空列表时展示占位说明；创建成功后选中新建项并刷新列表相关 query。
- 影响范围：`backend-java/src/main/java/com/taas/console/ConsoleController.java`、`ConsoleService.java`、`client/src/pages/AdminProviders.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml test`、`npm run build --prefix client`。
- 运维动作：发版并重启后端；发版前端静态资源；无需数据库迁移（沿用现有 `providers` 表结构）。
- 线上数据影响：仅新增管理员在控制台创建的 `providers` 行；不修改存量行。
- 风险控制：slug 冲突返回 409；API Key 仍走既有加密存储；未配置 Key 的供应商在网关侧行为与既有「未配置」逻辑一致。

### 2026-04-24 SDK 文档中心：单 Base URL + 按供应商族分栏

- 改动内容：`IntegrationDocs.tsx` 首屏改为单一可复制 Base URL，并增加 Claude Code 类 JSON 配置示例；移除原四宫格 Endpoint 卡与独立「SDK 示例中心」单页大 Tab；新增 OpenAI / Claude / Gemini 三族分节（锚点 `family-openai` / `family-claude` / `family-gemini`），各族含完整 URL、鉴权说明、独立请求体示例与 `FamilySdkPanel` 栈级 Tab（含 Gemini 专用 Python/Node/requests/cURL 示例，仍指向 `chat/completions`）；`sectionLinks`、能力概览、快速开始、请求规范、环境变量示例、FAQ、`changelogItems` v1.5 与「请求与返回」文案同步；`openAiExampleModel` 排除 `gemini-*` 以免误入 OpenAI 示例。`styles.css` 增补 `integration-hero-*`、`integration-family-*`、`integration-contract-*` 等样式。
- 影响范围：`client/src/pages/IntegrationDocs.tsx`、`client/src/styles.css`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过。
- 运维动作：仅需发版前端静态资源；无数据库与后端依赖。
- 线上数据影响：无。
- 风险控制：无；纯文档页与样式。

### 2026-04-24 网关：缓存命中落库真实供应商与路由

- 改动内容：写入 Redis 幂等/bodyfp 响应前通过 `GatewayCachePayloads.withMeta` 在 JSON 顶层附加 `_taasGatewayCacheMeta`（`providerId`、`routingPrimary`、`routingActual`、`routingReason`），读缓存返回客户端前 `unwrap` 剥离；`recordCacheHit` 按 meta 查 `providers.id` 写入 `api_request_logs.provider_id`，并写入 `routing_primary` / `routing_actual` / `routing_reason`；无 meta 的旧条目仍回退为原「priority 首条」逻辑。新增 `GatewayCachePayloads` 与 `GatewayCachePayloadsTest`。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayService.java`、`GatewayCachePayloads.java`、测试、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml test`。
- 运维动作：发版并重启后端；无需迁移。存量 Redis 键在 TTL 内仍可能无 meta，命中时供应商列行为与升级前一致直至键过期或被覆盖。
- 线上数据影响：仅影响**新产生**的缓存命中行与之后写入的 Redis 条目；不修改历史行。
- 风险控制：`_taasGatewayCacheMeta` 在返回前已剥离；若 meta 中 `providerId` 在库中已删除则回退首条 provider。

### 2026-04-24 用量页筛选区单行对齐

- 改动内容：`Usage.tsx` 筛选容器增加 `usage-filter-grid--tenant-row` 等修饰类；`styles.css` 中用量筛选改为横向 flex（标签与日期/下拉同一基线），时间快捷按钮与日期同一行；窄屏（≤960px）恢复纵向堆叠以便可操作。
- 影响范围：`client/src/pages/Usage.tsx`、`client/src/styles.css`、`CHANGELOG.md`。
- 验证情况：已人工核对 DOM 结构与样式选择器；`:has(.usage-filter-grid--tenant-row)` 仅作用于用量筛选卡片。
- 运维动作：仅需发版前端静态资源；无数据库与后端依赖。
- 线上数据影响：无。
- 风险控制：极旧浏览器不支持 CSS `:has` 时「共 N 条」上行距略回退为默认，不影响功能。

### 2026-04-24 19:40 网关：无幂等键时非流式 chat 请求体指纹缓存（第三方零改）

- 改动内容：对 **非流式** `chat/completions`，在租户缓存策略开启、且未传 `Idempotency-Key` 时，对白名单字段（`model`、`messages`、`temperature`、`tools` 等）做稳定规范化 JSON 后 **SHA-256**，Redis 键 `bodyfp:{appKeyId}:{sha}` 读写响应；**仍优先** `idem:{appKeyId}:{Idempotency-Key}`。新增 `ChatCompletionBodyFingerprint`、`GatewayCacheService` 的 bodyfp 读写；`taas.gateway.body-fingerprint-cache-enabled`（`TAAS_GATEWAY_BODY_FINGERPRINT_CACHE`，默认 true）可关闭。`stream: true` 不使用指纹缓存。部署文档与集成文档 FAQ 已补充。
- 影响范围：`backend-java` 网关、`TaasProperties`、`application.yml`、`IntegrationDocs.tsx`、`docs/ALIBABA_CLOUD_LINUX_DEPLOYMENT.md`、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml test`。
- 运维动作：发版并重启后端；可选在 `.env` 设置 `TAAS_GATEWAY_BODY_FINGERPRINT_CACHE=false` 后重启以关闭指纹缓存。无需迁移。Redis 将新增 `bodyfp:*` 键，与 `idem:*` 并存。
- 线上数据影响：无表结构变更；命中指纹缓存时 `api_request_logs.idempotency_key` 可为空（与幂等命中相同计费语义）。
- 风险控制：相同规范化体不同业务语义可能误命中，需知悉白名单字段设计；关闭指纹后行为回退为仅幂等键缓存。

### 2026-04-24 19:05 成本优化 MVP：缓存命中估算列、控制台聚合与网关读租户缓存策略

- 改动内容：`recordCacheHit` 从缓存响应体解析 OpenAI/Anthropic 形态 `usage`，写入 `saved_tokens_estimate` / `saved_prompt_tokens` / `saved_completion_tokens`（`CachedResponseUsageEstimate`）；`usage_records` 与余额仍为 0。控制台 `optimizationSummary`、`estimateCacheSavings`、高频重复 SQL 改为 `sum(saved_tokens_estimate)`；工作台/用量图表/本月用量等「真实消耗」类 `sum(total_tokens)` 仅统计 `cache_hit = false`；运营侧按用户/租户/AppKey/模型的 Token 汇总同步排除缓存命中。网关新增 `TenantIdempotencyCachePolicyService`（Caffeine ~45s）读 `tenant_cache_settings`：`enabled=false` 时跳过幂等缓存读写；`ttl_seconds` 传入 `GatewayCacheService.setIdempotentResponse` 的 Redis TTL；MVP 语义/混合与精确一致（代码注释说明）。`pom.xml` 增加 `caffeine` 依赖。集成文档 FAQ 补充控制台开关/TTL 与网关关系。新增 `CachedResponseUsageEstimateTest`；`GatewayServiceTest` 注入策略 Mock。
- 影响范围：`backend-java` 网关与控制台服务、`backend-java/pom.xml`、`client/src/pages/IntegrationDocs.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml test` 通过。
- 运维动作：发版并重启后端；需已执行迁移 `V20260424183000__api_request_logs_saved_tokens_estimate`（若尚未 Flyway，先部署含迁移版本）。无需清 Redis；控制台改 TTL/开关后最多约 45s 网关侧策略缓存延迟。无需手工改数。
- 线上数据影响：新产生的缓存命中日志会写入 `saved_*`；历史 `cache_hit=true` 行 `saved_tokens_estimate` 仍为 `NULL`，节省类聚合为 0 直至新流量产生；「消耗」类统计不因历史缓存行虚增（此前 `total_tokens` 已为 0）。
- 风险控制：本地 Redis 不可用时仍走内存兜底，TTL 与现网一致为「尽力」；策略查询异常时回退为开启缓存、TTL 86400。

### 2026-04-24 18:30 Flyway：api_request_logs 增加缓存节省 token 估算列

- 改动内容：新增迁移 `V20260424183000__api_request_logs_saved_tokens_estimate.sql`，为 `api_request_logs` 增加可空列 `saved_tokens_estimate`、`saved_prompt_tokens`、`saved_completion_tokens`；供 `cache_hit = true` 的请求日志写入「未命中缓存时按缓存体 usage 估算的 token」，与 `total_tokens` 恒为 0 的扣费语义分离。
- 影响范围：`backend-java/src/main/resources/db/migration/V20260424183000__api_request_logs_saved_tokens_estimate.sql`、`CHANGELOG.md`；后续需配合应用层 `recordCacheHit` 与控制台聚合 SQL 读写这些列（本提交仅 schema）。
- 验证情况：已核对 Flyway 版本号晚于既有迁移；列均为 `INTEGER` 可空、无默认值，存量行保持 `NULL`。
- 运维动作：发版或重启后端使 Flyway 执行新迁移；无需手工 SQL（除非在禁用 Flyway 的环境需自行执行等同 `ALTER TABLE`）。无需清缓存。
- 线上数据影响：仅新增列，不改写任何存量行；新列默认全为 `NULL`，直至应用开始写入。
- 风险控制：可重复执行（`IF NOT EXISTS`）；应用未升级前读新列为 `NULL`，聚合侧需 `coalesce` 直至代码对齐。

### 2026-04-24 17:05 Cursor 规则：自动推送目标改为 prod

- 改动内容：`.cursor/rules/auto-commit-push.mdc` 将助手自动 `git push` 的目标由 `origin dev` 改为 **`origin prod`**，并约定默认在 **`prod`** 上提交；若当前不在 `prod` 须先 `checkout` + `pull --ff-only` 再推送。
- 影响范围：`.cursor/rules/auto-commit-push.mdc`、`CHANGELOG.md`。
- 验证情况：已人工核对规则正文与分支名一致。
- 运维动作：无；不涉及运行中的服务或数据库。
- 线上数据影响：无。
- 风险控制：团队若仍习惯在 `dev` 开发，需在合并进 `prod` 后再发版，或自行约定分支流程；规则仅约束 Cursor 助手行为。

### 2026-04-24 16:25 网关可选 TAAS_GATEWAY_DEBUG_LOG_HTTP_BODIES 临时打印请求/响应体

- 改动内容：新增 `taas.gateway.debug-log-http-bodies`（环境变量 `TAAS_GATEWAY_DEBUG_LOG_HTTP_BODIES`，默认 `false`）及 `debug-log-max-chars` / `debug-log-sse-head-max-chars`；为 `true` 时 `GatewayController` 以 **WARN** 打印 `gateway.debug_http`：入站 JSON 请求体（去掉 `_gateway_debug_trace_id`）、非流式与流式 JSON 错误响应体（Jackson 序列化后按字符数截断）；流式 SSE 在写出时用 `HeadCopyOutputStream` 复制下游前若干字节并在结束后打 `kind=sse_head`。**不**记录完整 SSE 流以免内存与日志爆炸。`GatewayController` 构造注入 `TaasProperties`；`TaasProperties` 增加嵌套 `Gateway` 配置段。部署文档 `.env` 示例增加上述变量说明。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayController.java`、`backend-java/src/main/java/com/taas/infra/config/TaasProperties.java`、`backend-java/src/main/resources/application.yml`、`backend-java/src/test/java/com/taas/gateway/GatewayControllerTest.java`、`docs/ALIBABA_CLOUD_LINUX_DEPLOYMENT.md`、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml test` 通过。
- 运维动作：临时排查时在服务器 `.env` 设 `TAAS_GATEWAY_DEBUG_LOG_HTTP_BODIES=true`，`systemctl restart taas-backend`；排查完改回 `false` 再重启。无需 SQL、迁移。
- 线上数据影响：无；仅日志与磁盘体积风险。
- 风险控制：**高敏感**：日志含用户消息与可能含 AppKey 上下文，勿长期开启；建议限制日志文件权限与保留周期；SSE 仅为响应头一段非完整模型输出。

### 2026-04-24 16:15 部署手册：journalctl 与文件日志分工、说明 stop 退出码 143

- 改动内容：在 `docs/ALIBABA_CLOUD_LINUX_DEPLOYMENT.md` 的 systemd 示例中注明 `SuccessExitStatus=0 143` 可选配置，避免将 `systemctl stop` 时 Java 因 SIGTERM 退出码 143 误判为异常崩溃；在「查看日志」中明确 `journalctl` 主要反映服务启停，**应用 stdout/stderr 已重定向到** `/srv/taas/logs/backend.out.log` 与 `backend.err.log`，并说明默认 Spring 不会在 INFO 下逐条打印每个 HTTP 请求。
- 影响范围：`docs/ALIBABA_CLOUD_LINUX_DEPLOYMENT.md`、`CHANGELOG.md`。
- 验证情况：已人工核对与文中 `StandardOutput`/`StandardError` 配置一致。
- 运维动作：无；纯文档。可选：在现网 unit 中按需增加 `SuccessExitStatus=0 143` 后 `systemctl daemon-reload`（以实际 unit 名为准）。
- 线上数据影响：无。
- 风险控制：无。

### 2026-04-24 16:00 网关流式改为 HttpServletResponse 直写，彻底规避 SSE 消息转换器 500

- 改动内容：`GatewayController` 的 `completions` / `anthropicMessages` 改为 `void`，通过 `HttpServletResponse` 写出 JSON 与 `text/event-stream`：非流式与流式下的 JSON 错误体使用 `ObjectMapper` 写 `OutputStream`；流式成功分支设置 SSE 相关响应头后直接调用 `StreamingResponseBody.writeTo(response.getOutputStream())`，不再把 `StreamingResponseBody` 作为 MVC 返回值交给 `RequestResponseBodyMethodProcessor`，从根上避免部分运行环境仍报 `No converter for … GatewayService$$Lambda … text/event-stream`。构造函数注入 `ObjectMapper`；`GatewayControllerTest` 改为 `MockHttpServletResponse` 断言。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayController.java`、`backend-java/src/test/java/com/taas/gateway/GatewayControllerTest.java`、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml -Dtest=GatewayControllerTest,GatewayServiceTest test` 通过。
- 运维动作：发布新后端 jar 并重启 `taas-backend`（或等价服务）；无需 SQL、迁移或清缓存。若仍见同类 500，在服务器用 `journalctl -u taas-backend -n 300 --no-pager` 查完整栈，并核对 `ps aux`/`readlink` 实际加载的 jar 与发版 commit 是否一致。
- 线上数据影响：无。
- 风险控制：响应头与状态码仍由 `GatewayService` 提供字段驱动，协议与鉴权逻辑未改；直写路径需注意后续若增加全局响应包装过滤器，应确认不与已提交响应冲突。

### 2026-04-24 15:50 网关流式入口返回 Object 并分流 ResponseEntity 泛型

- 改动内容：`GatewayController` 的 `completions` / `anthropicMessages` 公开方法返回类型由 `ResponseEntity<Object>` 改为 `Object`；`stream: true` 且上游错误等需返回 JSON 时走 `ResponseEntity<Map<String, Object>>`（`streamJsonEntity`），正常 SSE 时返回 `ResponseEntity<StreamingResponseBody>`（`streamSseEntity`），避免部分 Spring 版本仍将 `Object` 体误判为需 `HttpMessageConverter`、对已预设 `text/event-stream` 的 `StreamingResponseBody` lambda 报 `No converter for …`。同步调整 `GatewayControllerTest` 中对控制器返回值的强转方式。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayController.java`、`backend-java/src/test/java/com/taas/gateway/GatewayControllerTest.java`、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml -Dtest=GatewayControllerTest,GatewayServiceTest test` 通过。
- 运维动作：发布包含上述改动的后端 jar 并重启网关进程（如 `taas-backend`）；无需 SQL、迁移或清缓存。
- 线上数据影响：无。
- 风险控制：仅 MVC 返回类型与 `ResponseEntity` 泛型分流，不改变鉴权、上游协议与 SSE 字节格式。

### 2026-04-24 15:10 部署手册修正一键脚本示例命令

- 改动内容：`docs/ALIBABA_CLOUD_LINUX_DEPLOYMENT.md` 中「使用一键更新脚本」小节误写为 `image.png`，已改为正确的 `bash scripts/deploy-prod.sh` 示例。
- 影响范围：`docs/ALIBABA_CLOUD_LINUX_DEPLOYMENT.md`、`CHANGELOG.md`。
- 验证情况：已人工核对小节上下文与脚本路径一致。
- 运维动作：无；纯文档修正。
- 线上数据影响：无。
- 风险控制：无。

### 2026-04-24 14:35 网关 SSE 再加固：避免 BodyBuilder 预设 Content-Type 触发转换器

- 改动内容：在已改为 `ResponseEntity<Object>` 的基础上，流式分支不再使用 `ResponseEntity.BodyBuilder.contentType(TEXT_EVENT_STREAM).body(StreamingResponseBody)` 链式写法，改为 `HttpHeaders` 设置 `Content-Type` / `Cache-Control` 后使用全参 `new ResponseEntity<>(stream, headers, status)`；非流式 JSON 同样统一为 `jsonEntity` 全参构造，降低部分 Spring 版本仍对 SSE 体误走 `HttpMessageConverter`、报 `No converter for … Lambda … text/event-stream` 的概率。该问题与 Claude Code 请求 JSON 结构无直接冲突，属服务端写出路径。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayController.java`、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml -DskipTests compile` 与 `mvn -f backend-java/pom.xml -Dtest=GatewayControllerTest,GatewayServiceTest test` 通过。
- 运维动作：发布后端并重启网关进程；无需 SQL、迁移或清缓存。
- 线上数据影响：无。
- 风险控制：仅调整 `ResponseEntity` 构造方式，不改变 Anthropic/OpenAI 兼容语义与流式字节格式。

### 2026-04-23 22:30 修复流式网关 ResponseEntity 通配符导致 SSE 500

- 改动内容：Claude Code 等客户端在 `stream: true` 下访问 `/v1/messages` 或 Chat Completions 时，Spring 报 `No converter for [GatewayService$$Lambda…] with preset Content-Type 'text/event-stream'` 并返回 500；根因为控制器方法声明为 `ResponseEntity<?>` 时，框架无法将 `StreamingResponseBody` 交给流式写出处理器而误走 `HttpMessageConverter`（与 Spring Framework #25996 同类问题）。将 `GatewayController` 中流式相关入口与 `toResponse` 的返回类型改为 `ResponseEntity<Object>`，使流式体按 `StreamingResponseBody` 正常写出。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayController.java`、`backend-java/src/test/java/com/taas/gateway/GatewayControllerTest.java`、`CHANGELOG.md`。
- 验证情况：已执行 `mvn -f backend-java/pom.xml -DskipTests compile` 与 `mvn -f backend-java/pom.xml -Dtest=GatewayControllerTest,GatewayServiceTest test` 通过。
- 运维动作：发布后端并重启 `taas-backend`（或等价网关进程）使新控制器签名生效；无需 SQL、迁移或清缓存。
- 线上数据影响：无。
- 风险控制：仅变更 MVC 返回类型声明与测试变量类型，不改变网关鉴权、路由、流式协议与错误体结构。

### 2026-04-23 22:05 工作台最近请求表支持排序

- 改动内容：在租户「工作台」的「最近请求」表格上，为时间、模型、供应商、Token、延迟、缓存列增加与用量页一致的 `UsageSortTh` 双箭头排序；数据仍为接口返回日志截取前 10 条后再在浏览器内排序，不改变接口；`useMemo` / `useState` 置于工作台摘要查询的提前 `return` 之前，避免 Hooks 顺序问题。
- 影响范围：`client/src/pages/Dashboard.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；已检查 `Dashboard.tsx` 的 linter 且无报错。
- 运维动作：仅需发布前端静态资源。
- 线上数据影响：无。
- 风险控制：仅本地重排已展示的最多 10 条记录，不改变拉取范围与 KPI 数据。

### 2026-04-23 21:50 修复计费中心白屏（Hooks 顺序）

- 改动内容：`Billing` 组件在加载/错误分支提前 `return` 之后才调用 `useMemo`，违反 React Hooks 规则，数据加载完成后会抛错导致整页白屏；将账单排序 `useMemo` 与 `toggleRecordSort` 提前到所有条件 `return` 之前，并在无 `data` 时对 `records` 做空数组兼容。
- 影响范围：`client/src/pages/Billing.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过。
- 运维动作：仅需发布前端静态资源。
- 线上数据影响：无。
- 风险控制：无逻辑变更，仅修正 Hooks 调用顺序与空数据安全。

### 2026-04-23 21:35 租户用量页与计费账单表明细支持表头排序

- 改动内容：抽取共享组件 `UsageSortTh`（与既有 `.admin-usage-sort-*` 样式一致）；在租户「用量」页（`/usage`）对请求明细表全部数据列增加双箭头排序，筛选条件变化时重置为按请求时间降序；在租户「计费中心」账单明细表对日期、类型、金额、状态、说明列增加同样排序；管理员统计页改为引用该组件以去重。账单页底部「首条记录快照」仍固定使用接口返回顺序中的首条，避免用户自定义排序后快照语义错位。
- 影响范围：`client/src/components/UsageSortTh.tsx`（新建）、`client/src/pages/Usage.tsx`、`client/src/pages/Billing.tsx`、`client/src/pages/AdminUsage.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；已检查上述改动文件的 linter 且无报错。
- 运维动作：仅需发布前端静态资源；无需重启后端、执行 SQL、迁移或清缓存。
- 线上数据影响：无。
- 风险控制：排序均在浏览器端完成；金额字段按可解析数字比较，无法解析时按 0；缓存列按布尔（命中=1）比较，升序时未命中在前。

### 2026-04-23 21:10 管理员统计页各数据表统一可排序列

- 改动内容：在「调用与充值统计」页除趋势图外的各表格上，为数值、金额、时间与名称类列统一接入与「用户模型调用情况」相同的双箭头表头排序（无边框 `UsageSortTh`）；覆盖租户/用户维度汇总、AppKey 调用、模型调用、租户充值主表，以及展开后的充值单明细子表；用户模型表补充「费用(USD)」列排序；切换时间范围、维度、搜索时重置各表默认排序，切换展开租户时重置明细表排序为按创建时间降序。
- 影响范围：`client/src/pages/AdminUsage.tsx`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；已检查 `AdminUsage.tsx` 的 linter 且无报错。
- 运维动作：仅需发布前端静态资源；无需重启后端、执行 SQL、迁移或清缓存。
- 线上数据影响：无。
- 风险控制：排序均在浏览器端完成，不改变 `/admin/usage-overview` 接口与统计口径；金额类字段按可解析数字比较，无法解析时按 0 处理，与展示字符串在极端脏数据下可能略有偏差。

### 2026-04-23 20:45 管理员用户模型表头改为固定双箭头排序控件

- 改动内容：将「用户模型调用情况」可排序列表头从带边框的 `.btn` 改为无边距的文本式按钮；列名右侧固定并排展示 ↑ 与 ↓（纵向叠放、占位不变），仅当前排序列按升/降序高亮对应箭头，避免原先「只有一个箭头 / 按钮 ghost 边框」在点击与切换列时产生的视觉跳动；保留点击同一列在升序与降序之间切换、点击另一列则默认降序的逻辑。
- 影响范围：`client/src/pages/AdminUsage.tsx`、`client/src/styles.css`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；已检查 `AdminUsage.tsx` 的 linter 且无报错。
- 运维动作：仅需发布前端静态资源；无需重启后端、执行 SQL、迁移或清缓存。
- 线上数据影响：无。
- 风险控制：仅影响管理端页面展示与无障碍 `aria-sort`（仅当前排序列），不改变统计接口与排序算法本身。

### 2026-04-23 20:20 管理员用户模型表头去掉排序按钮焦点蓝框

- 改动内容：说明「用户模型调用情况」表头可排序列为 `<button>`，点击后浏览器会为该按钮绘制默认焦点环（视觉上像蓝色方框）；曾为 `.admin-usage-sort-th` 关闭默认 `outline`/`box-shadow` 等（后续已由 **20:45** 固定双箭头无边框表头方案替代，相关类名已移除）。
- 影响范围：`client/src/styles.css`、`CHANGELOG.md`。
- 验证情况：已核对样式选择器仅作用于管理员统计页排序表头按钮；建议本地刷新管理统计页点击「总 Token」等列确认蓝框消失。
- 运维动作：仅需发布前端静态资源；无需重启后端、执行 SQL、迁移或清缓存。
- 线上数据影响：无。
- 风险控制：仅影响表头按钮的焦点外观，不改变排序逻辑与接口行为。

### 2026-04-23 19:05 管理员统计页支持用户模型调用时间排序

- 改动内容：在管理员「调用与充值统计」页的「用户模型调用情况」表格中，为「请求数」「总 Token」「最近调用」列增加可点击排序；默认按「最近调用」从新到旧排序，便于快速定位最新模型调用；切换筛选区间、维度或搜索条件时重置为默认时间倒序，避免旧排序与新筛选结果错位。
- 影响范围：`client/src/pages/AdminUsage.tsx`、`client/src/styles.css`、`CHANGELOG.md`。
- 验证情况：已执行 `npm run build --prefix client` 通过；已检查最近改动文件的 linter 且无报错。
- 运维动作：仅需发布前端静态资源并刷新浏览器缓存；无需执行 SQL、迁移、清缓存或重启后端服务。
- 线上数据影响：无；本次仅调整前端展示与本地排序逻辑，不修改任何数据库表、请求日志、账单或余额数据。
- 风险控制：排序在浏览器端完成，不改变 `/admin/usage-overview` 接口返回结构与统计口径；默认排序与重置规则尽量贴近管理员排查「最新调用」的常见路径，降低误读风险。

### 2026-04-23 15:02 DeepSeek 模型 ID 大小写按目录纠正

- 改动内容：调整网关对请求 `model` 的处理逻辑；当客户端传入的模型 ID 与 AppKey 白名单或 provider 模型目录仅大小写不一致时，先按大小写无关方式匹配授权，再使用 provider 目录中配置的标准模型 ID 继续路由并转发上游，避免 `deepseek-ai/deepseek-v3.1-terminus` 这类小写请求被上游因大小写敏感拒绝。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayService.java`、`backend-java/src/test/java/com/taas/gateway/GatewayServiceTest.java`、`CHANGELOG.md`。
- 验证情况：待执行 `mvn -f backend-java/pom.xml -Dtest=GatewayServiceTest test` 与后端编译，确认新增大小写兼容逻辑不会影响现有 AppKey 白名单校验、provider 选路和 Anthropic/OpenAI 兼容入口。
- 运维动作：需要发布后端并重启 `taas-backend` 使新的模型 ID 纠正规则生效；无需执行 SQL、迁移、清缓存或额外补配置。
- 线上数据影响：无；本次仅调整网关内存中的模型名匹配与上游转发逻辑，不修改数据库表结构、存量配置、历史请求日志、账单或余额数据。
- 风险控制：仅在白名单或 provider 目录已存在大小写无关匹配项时才改写为配置里的标准模型 ID；若目录中没有匹配项，仍保持原有行为，避免误改其他模型名或影响未建模的上游兼容场景。

### 2026-04-23 14:35 管理员统计页新增用户模型归因

- 改动内容：为 `app_keys` 新增 `owner_user_id`、为 `api_request_logs` 新增 `user_id`，新建迁移并让网关在请求成功与幂等缓存命中时写入用户归因；管理员统计接口新增“用户模型调用情况”数据集，并将用户维度汇总的请求量改为按 `api_request_logs.user_id / app_keys.owner_user_id` 归因统计；前端管理统计页同步新增“用户模型调用情况”表，展示用户、邮箱、模型、请求数、总 Token、费用与最近调用时间。
- 影响范围：`backend-java/src/main/resources/db/migration/V20260423160000__usage_user_attribution.sql`、`backend-java/src/main/java/com/taas/gateway/GatewayService.java`、`backend-java/src/main/java/com/taas/console/ConsoleService.java`、`client/src/api.ts`、`client/src/pages/AdminUsage.tsx`、`CHANGELOG.md`。
- 验证情况：已完成最近改动文件的 linter 检查且无报错；待执行后端测试/编译与前端构建，确认新字段、统计接口与页面表格能一起通过。
- 运维动作：发布前需要执行新增数据库迁移，再重启后端服务加载新的请求日志归因逻辑；前端需重新发版静态资源；本地联调环境按项目规则重启前后端开发服务。
- 线上数据影响：会新增 `app_keys.owner_user_id` 与 `api_request_logs.user_id` 字段及索引；不回填历史日志，历史请求会在统计查询时尽量回退使用当前 `app_keys.owner_user_id` 进行展示，仅影响管理统计口径，不改动历史账单、余额或请求结果。
- 风险控制：新字段均为可空并通过 `coalesce(l.user_id, a.owner_user_id)` 做兼容查询，避免迁移前后请求或存量 AppKey 因归因字段缺失导致接口报错；写日志只在网关内部生效，不影响上游协议兼容性。

### 2026-04-23 14:12 上游失败日志串联 Anthropic 调试 traceId

- 改动内容：将 `POST /v1/messages` 入口生成的调试 `traceId` 透传到网关内部 provider 调用链，在上游返回 `4xx/5xx`、超时、网络错误以及 `all_providers_failed` 聚合失败时同步打印同一个 `traceId`；同时尝试从上游错误消息中提取 `request id` 并写入日志，便于把 Anthropic 摘要日志与真实 provider 失败日志一条链路串起来排障。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayService.java`、`CHANGELOG.md`。
- 验证情况：待执行后端编译与网关测试，确认新增 traceId 串联日志不会泄露内部字段到上游请求，也不影响现有 Messages / Streaming 兼容行为。
- 运维动作：本地联调环境需重启后端开发服务以加载新的失败链路日志；线上发布后可通过 `gateway.anthropic.debug`、`gateway.provider.http_error`、`gateway.provider.failed`、`gateway.provider.failed_all` 等关键字联动检索。
- 线上数据影响：无；仅补充运行日志，不修改数据库结构、配置、计费逻辑或请求结果。
- 风险控制：内部 `traceId` 仅保留在网关内存请求上下文中，合并上游请求体时会主动移除，不会透传给模型供应商接口。

### 2026-04-23 12:28 新增 Anthropic 请求归一化摘要日志

- 改动内容：为网关 `POST /v1/messages` 与对应流式入口新增安全摘要日志，记录 Anthropic 原始请求与归一化后 OpenAI 请求的消息数、每条消息的 `tool_calls` / `tool_use` 数量、content block 数量、工具定义数量与工具选择方式，用于排查 Claude Code 等客户端出现的 `tool_calls` 数量越界问题，同时避免输出请求正文与密钥。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayService.java`、`CHANGELOG.md`。
- 验证情况：待执行后端编译与网关测试，确认新增日志不影响现有 Messages / Streaming 兼容行为。
- 运维动作：本地联调环境需重启后端开发服务以加载新的排障日志逻辑；线上发布后可直接通过应用日志按 `gateway.anthropic.debug` 与 `gateway.anthropic.debug.near_limit` 检索。
- 线上数据影响：无；仅新增运行日志，不修改数据库结构、租户配置、余额、账单或请求结果。
- 风险控制：日志只记录结构摘要与计数，不打印用户消息正文、工具参数正文、AppKey 或上游密钥，降低排障过程中的敏感信息泄露风险。

### 2026-04-23 12:15 升级为真实 chunk 透传低延迟流式网关

- 改动内容：将前一版“由完整响应合成 SSE 事件”的流式兼容升级为真实的上游 chunk 透传模式；网关现在会在保持现有鉴权、限流、预算、模型选路、计费与幂等缓存逻辑的前提下，直接消费上游 OpenAI / Anthropic SSE 并边收边转发，同时在结束后再落请求日志、用量记录与账单。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayService.java`、`backend-java/src/main/java/com/taas/gateway/GatewayController.java`、`backend-java/src/test/java/com/taas/gateway/GatewayServiceTest.java`、`backend-java/src/test/java/com/taas/gateway/GatewayControllerTest.java`、`CHANGELOG.md`。
- 验证情况：已通过 `mvn test -Dtest=GatewayServiceTest,GatewayControllerTest` 验证网关控制器与流式协议转换单测；同时通过 `mvn -q -DskipTests compile` 确认后端可完整编译。
- 运维动作：本地联调环境需重启后端开发服务以加载新的实时流式代理逻辑；线上发布时仅需正常部署后端，无需执行 SQL、迁移、缓存清理或额外配置变更。
- 线上数据影响：无；本次仅升级网关流式传输实现，不修改数据库结构、租户配置、余额策略、密钥表或历史请求数据。
- 风险控制：对于 OpenAI / Anthropic 上游已实现真实流式透传；对于当前非 SSE 上游仍保留合成流作为兜底，避免因为单个提供商不支持流式而使整个网关能力退化。

### 2026-04-23 12:03 补齐 Messages 与 Chat Completions 流式兼容

- 改动内容：为网关补充 `stream: true` 的 SSE 响应能力，覆盖 `POST /v1/chat/completions` 与 `POST /v1/messages` 两条入口；对外分别输出 OpenAI 与 Anthropic 兼容的流式事件序列，支持文本回复、工具调用、工具结果相关结构在流式场景下继续保持协议一致。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayController.java`、`backend-java/src/main/java/com/taas/gateway/GatewayService.java`、`backend-java/src/test/java/com/taas/gateway/GatewayServiceTest.java`、`backend-java/src/test/java/com/taas/gateway/GatewayControllerTest.java`、`CHANGELOG.md`。
- 验证情况：已通过 `mvn test -Dtest=GatewayServiceTest,GatewayControllerTest` 验证控制器与网关兼容层；新增覆盖 OpenAI SSE 事件输出、Anthropic `message_start/content_block_delta/message_stop` 生命周期输出，以及控制器返回类型适配。
- 运维动作：本地联调环境需重启后端开发服务以加载最新网关逻辑；线上发布时仅需正常发布后端，无需执行 SQL、迁移或缓存清理。
- 线上数据影响：无；本次仅新增流式响应协议兼容逻辑与测试，不修改数据库结构、租户配置、余额、密钥或历史调用数据。
- 风险控制：流式分支复用现有非流式鉴权、限流、预算、模型路由、计费与兼容转换逻辑，避免为流式单独复制一套网关主流程，从而降低行为偏差和回归风险。

### 2026-04-23 11:58 增强 Anthropic Messages 协议兼容层

- 改动内容：增强网关 `POST /v1/messages` 的 Anthropic 兼容处理，补齐 `tools`、`tool_choice`、`tool_use`、`tool_result` 等关键结构在 Anthropic 与 OpenAI/Anthropic 上游之间的双向转换；同时让 Anthropic 上游返回的 `tool_use` 能正确回映为兼容响应，避免工具调用在网关内被静默降级为普通文本。
- 影响范围：`backend-java/src/main/java/com/taas/gateway/GatewayService.java`、`backend-java/src/test/java/com/taas/gateway/GatewayServiceTest.java`、`CHANGELOG.md`。
- 验证情况：已通过 `mvn test -Dtest=GatewayServiceTest` 与 `mvn -q -DskipTests compile` 验证后端编译和新增协议转换单测；新增覆盖 Anthropic 工具请求转 OpenAI `tool_calls` 以及 OpenAI `tool_calls` 回转 Anthropic `tool_use` 的场景。
- 运维动作：本地联调环境需重启后端开发服务以加载最新网关逻辑；线上发布时仅需正常部署后端，无需执行 SQL、迁移或缓存清理。
- 线上数据影响：无；本次仅调整网关协议转换逻辑与测试，不改动数据库表结构、租户配置、余额、密钥或历史账单数据。
- 风险控制：本次保持现有 `/v1/chat/completions` 路径不变，仅增强 `/v1/messages` 兼容转换；同时保留原有基础文本消息行为，降低对已可用 Anthropic/OpenAI 兼容调用的回归风险。

### 2026-04-23 11:05 SDK 文档中心修正 Base URL 与协议口径

- 改动内容：修正 `SDK 文档中心` 中的接入口径，将 SDK `Base URL` 统一改为根域名 `https://www.itoken.group`，不再展示为 `http://www.itoken.group/v1`；同步将文档中心中的域名示例统一切换到 HTTPS，并更新 OpenAI / Anthropic SDK 代码示例、FAQ、能力边界说明、请求规范与环境变量示例，确保文档中心内所有相关说明一致。
- 影响范围：`client/src/pages/IntegrationDocs.tsx`、`CHANGELOG.md`。
- 验证情况：待执行前端构建与最近改动文件 linter 检查，确认页面展示、复制按钮与代码示例均使用新的 HTTPS Base URL。
- 运维动作：仅需发布前端静态资源；根据项目本地规则，开发联调环境会在修改后重启前后端服务。线上无需执行 SQL、迁移、清缓存或重启后端。
- 线上数据影响：无；仅调整前端文档展示与复制内容，不修改任何业务表、配置表或历史调用记录。
- 风险控制：本次仅修正文档中心口径，不改动网关后端路由实现与模型广场数据结构，避免引入接口兼容性回归；原生 HTTP 直连接口说明继续保留 `.../gateway/v1/...` 路径，减少用户混淆。

### 2026-04-23 10:45 API 密钥列表隐藏允许模型与最近来源列

- 改动内容：精简租户侧 `API 密钥` 列表展示，移除“允许模型”和“最近来源”两列，仅保留创建时间、预算、状态、启停与删除等高频管理信息；同步调整空状态表格的列跨度，避免表格布局错位。
- 影响范围：`client/src/pages/ApiKeys.tsx`、`CHANGELOG.md`。
- 验证情况：待执行前端构建与最近改动文件 linter 检查，确认列表表头、空状态和行数据列数一致。
- 运维动作：仅需发布前端静态资源；根据项目本地规则，开发联调环境会在修改后重启前后端服务。线上无需执行 SQL、迁移、清缓存或重启后端。
- 线上数据影响：无；仅调整前端展示，不修改任何 `app_keys`、`api_request_logs`、`usage_records` 或其他业务表数据。
- 风险控制：只移除列表展示列，不改动后端接口返回结构，避免影响其他页面或后续扩展；保留现有创建、启停、删除与网关试用功能不变。

### 2026-04-23 10:30 SSL 文档示例替换为真实域名

- 改动内容：将 `SSL / HTTPS` 部署文档中的通用占位示例替换为当前实际站点信息，统一改为 `www.itoken.group`，证书路径改为 `/etc/nginx/ssl/www.itoken.group.pem`，并在文档中补充“私钥默认示例为 `/etc/nginx/ssl/www.itoken.group.key`，如实际文件名不同仅替换该行”的说明。
- 影响范围：`docs/SSL_HTTPS_DEPLOYMENT.md`、`CHANGELOG.md`。
- 验证情况：已检查 `nslookup`、`curl`、`openssl`、`certbot`、`Nginx server_name` 等命令示例均已替换为统一域名，文档内部示例口径一致。
- 运维动作：无直接系统变更；仅更新部署文档示例，实际执行时仍需运维按服务器上的真实私钥文件路径调整 `ssl_certificate_key`。
- 线上数据影响：无；本次仅更新文档示例，不修改数据库、缓存、环境变量或运行时代码。
- 风险控制：文档仍保留私钥路径可替换说明，避免因示例路径与服务器实际文件名不一致导致 `nginx -t` 失败。

### 2026-04-23 10:20 SSL 文档补充阿里云下载链接用法

- 改动内容：补充 `SSL / HTTPS` 部署文档，新增“使用阿里云证书临时下载链接直接在服务器拉取证书包”的操作步骤，包含 `curl` 下载、`unzip` 解压、查找 `.pem` / `.key`、复制到 `/etc/nginx/ssl/` 的过程；同时明确不应把带签名和临时 token 的原始下载链接写入仓库或长期文档。
- 影响范围：`docs/SSL_HTTPS_DEPLOYMENT.md`、`CHANGELOG.md`。
- 验证情况：已校正文档中证书目录命令的小笔误，并确认新增步骤与现有 Nginx 证书路径和 Linux 运维流程一致。
- 运维动作：无直接系统变更；实际执行时由运维在服务器终端临时使用下载链接拉取证书，然后按文档继续完成 Nginx 配置与 reload。
- 线上数据影响：无；本次仅更新运维文档，不修改数据库、缓存、环境变量或运行时代码。
- 风险控制：文档明确要求不要把带签名和 `security-token` 的下载链接提交进 Git，避免凭证泄露和链接过期失效；同时保留手动上传证书文件的原始方案，便于回退。

### 2026-04-23 10:10 新增 SSL / HTTPS 部署文档

- 改动内容：新增一份独立的 `SSL / HTTPS` 部署文档，面向当前 `TaaS` 项目的阿里云 Linux + Nginx 部署结构，补充了证书签发前置条件、域名解析、证书上传、Nginx HTTPS 配置、`80 -> 443` 跳转、验证方法、常见问题排查以及 `Certbot` 备选方案。
- 影响范围：`docs/SSL_HTTPS_DEPLOYMENT.md`、`CHANGELOG.md`。
- 验证情况：已对照现有 `docs/ALIBABA_CLOUD_LINUX_DEPLOYMENT.md` 中的 Nginx 目录、前端静态目录与后端反向代理路径进行校对；文档命令与项目当前 `Nginx + /srv/taas/frontend/current + 127.0.0.1:3001` 部署结构保持一致。
- 运维动作：无直接系统变更；该文档为运维执行指南，实际上线 HTTPS 时仍需由运维在服务器上上传证书、修改 Nginx 配置并 reload 服务。
- 线上数据影响：无；本次仅新增文档，不修改任何数据库表、缓存、环境变量或运行时代码。
- 风险控制：文档明确提示“证书未签发完成前不要部署”，并要求先执行 `nginx -t` 再重载，降低因证书文件错误、域名不匹配或 Nginx 语法错误导致的服务中断风险。

### 2026-04-22 21:35 新增代码修改后自动重启前后端规则

- 改动内容：在项目规则中新增“代码修改后自动重启前后端开发服务”约束，要求 AI 在本次会话存在实际代码或运行配置变更时，结束前自动重启前后端；同时要求先检查现有终端、优先复用已有服务实例，避免重复启动。
- 影响范围：`.cursor/rules/auto-restart-dev-servers.mdc`、`CHANGELOG.md`。
- 验证情况：已检查规则文件格式与现有 `.cursor/rules/*.mdc` 一致；规则内容已写入明确的前端、后端优先启动命令与适用范围说明。
- 运维动作：无；该变更仅影响 Cursor 项目内 AI 助手的会话执行规则，不涉及线上服务、数据库、环境变量或部署脚本。
- 线上数据影响：无；不会修改任何业务表、缓存、消息队列或历史调用记录。
- 风险控制：规则中明确排除了纯文档、纯解释、仅改 `CHANGELOG.md` 或 `.cursor/rules/*` 的场景，避免无意义重启；同时要求重启前先检查现有终端，降低重复拉起多个开发服务实例的风险。

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
