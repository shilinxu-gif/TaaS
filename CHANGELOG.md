# CHANGELOG

## Unreleased

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
