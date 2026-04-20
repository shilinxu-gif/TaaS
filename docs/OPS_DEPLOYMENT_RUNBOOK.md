# TaaS 运维部署流程

适用范围：当前仓库 `TaaS` 的 Java 后端 + React 前端部署。  
目标读者：运维、实施、交付、平台管理员。

## 1. 部署目标

当前项目包含以下核心组件：

- 前端控制台：React + Vite
- 后端服务：Java 17 / Spring Boot
- 数据库：PostgreSQL 16
- 缓存：Redis 7

推荐生产部署形态：

1. `PostgreSQL` 独立实例
2. `Redis` 独立实例
3. `backend-java` 作为独立 Java 服务运行
4. 前端使用 `vite build` 产物，由 `Nginx` 或静态文件服务托管
5. 反向代理统一暴露 HTTPS 域名

说明：

- 仓库里的 `docker-compose.yml` 更适合本地联调或测试环境，不建议直接原样作为正式生产方案。
- 当前系统不会自动写入固定上游地址；上游 `Base URL`、`API Key` 需要部署后由管理员手动配置。

## 2. 你需要提供的内容

上线前，需要你或业务侧提供以下信息。

### 2.1 基础设施信息

- 部署环境类型：测试 / 预发 / 生产
- 服务器清单：
  - 前端服务器或静态站点承载方式
  - 后端服务器
  - PostgreSQL 地址、端口、库名、账号
  - Redis 地址、端口
- 对外访问域名：
  - 前端域名
  - 后端 API 域名（若与前端同域，也请明确）
- HTTPS 证书方案：
  - 证书文件
  - 或由运维统一托管

### 2.2 必填环境变量

以下变量必须由你提供，系统不会再使用开发默认值：

- `JWT_SECRET`
- `PROVIDER_CONFIG_SECRET`
- `APP_KEY_PEPPER`

要求建议：

- 长度至少 32 位
- 使用随机高强度字符串
- 生产、预发、测试环境分别隔离

### 2.3 管理员初始化信息

如需系统在首次启动时自动创建平台管理员，请提供：

- `BOOTSTRAP_ADMIN_LOGIN`
- `BOOTSTRAP_ADMIN_PASSWORD`

注意：

- 这两个变量是“一次性初始化/重置”用途
- 如果服务启动时它们仍然存在，系统会按该值维护平台管理员账号
- 建议首次部署成功并确认可登录后，将这两个变量从长期运行环境中移除，避免后续重启再次重置密码

### 2.4 上游供应商信息

需要你提供每个真实上游的：

- 供应商名称
- `Base URL`
- `API Key`
- 支持的模型列表
- 超时时间建议
- 优先级建议
- 是否启用流式输出

如有多家供应商，还需明确：

- 主供应商
- 备用供应商
- 是否需要按模型拆分不同供应商

### 2.5 业务配置

建议同时确认：

- 销售邮箱：`SALES_EMAIL`
- 支持邮箱：`SUPPORT_EMAIL`
- 试用天数：`TRIAL_DAYS`

财务模块若要正式启用，还需要你提供：

- 对公收款主体名称
- 银行名称
- 银行账号
- 发票流程要求

当前仓库中的财务流程仍是“生产占位版”，如需真实支付/开票对接，需要另行实施。

## 3. 部署前检查

运维在开始部署前应确认：

1. Java 17+ 可用，建议 Java 21
2. Maven 3.9+ 可用
3. Node.js 20+ 可用（用于前端构建）
4. PostgreSQL 已创建数据库与账号
5. Redis 服务可连接
6. 环境变量已准备完毕
7. 防火墙与反向代理规则已明确

## 4. 建议目录结构

建议部署目录如下：

```text
/srv/taas/
  backend/
  frontend/
  logs/
  scripts/
  env/
```

其中：

- `backend/`：后端代码或构建产物
- `frontend/`：前端 `dist/`
- `logs/`：运行日志
- `env/`：环境变量文件（仅运维可读）

## 5. 部署流程

### 5.1 准备环境变量文件

示例：

```bash
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5432
POSTGRES_DB=crm
POSTGRES_USER=crm
POSTGRES_PASSWORD=your-db-password

REDIS_HOST=127.0.0.1
REDIS_PORT=6379

JWT_SECRET=replace-with-strong-secret
PROVIDER_CONFIG_SECRET=replace-with-strong-secret
APP_KEY_PEPPER=replace-with-strong-secret

BOOTSTRAP_ADMIN_LOGIN=admin
BOOTSTRAP_ADMIN_PASSWORD=replace-with-strong-password

SALES_EMAIL=sales@example.com
SUPPORT_EMAIL=support@example.com
TRIAL_DAYS=14

PORT=3001
```

建议文件名：

- `/srv/taas/env/prod.env`

权限建议：

- `chmod 600 /srv/taas/env/prod.env`

### 5.2 部署数据库

1. 创建 PostgreSQL 数据库
2. 创建业务账号并授权
3. 确认后端机器可连接数据库

建议提前验证：

```bash
psql "host=YOUR_HOST port=5432 dbname=crm user=crm password=***"
```

### 5.3 部署 Redis

1. 创建 Redis 实例
2. 放通应用访问权限
3. 如有密码认证，按实际情况在应用侧扩展配置

说明：当前仓库默认使用 host/port 方式接入 Redis。

### 5.4 构建前端

在项目根目录执行：

```bash
npm install --prefix client
npm run build --prefix client
```

构建完成后，产物位于：

```text
client/dist
```

将其部署到 Nginx 或静态文件服务器目录。

### 5.5 启动后端

方式一：源码目录直接运行

```bash
set -a
source /srv/taas/env/prod.env
set +a
mvn -f backend-java/pom.xml spring-boot:run
```

方式二：先打包再运行

```bash
set -a
source /srv/taas/env/prod.env
set +a
mvn -f backend-java/pom.xml -DskipTests package
java -jar backend-java/target/backend-java-0.0.1-SNAPSHOT.jar
```

说明：

- 首次启动时，Flyway 会自动执行数据库迁移
- 系统会自动补齐基础套餐和 provider 目录
- 不会自动写入真实上游地址和真实上游密钥

### 5.6 配置反向代理

建议反向代理规则：

- `/` -> 前端静态站点
- `/api` -> Java 后端
- `/v1` -> Java 后端

健康检查建议：

- 存活检查：`GET /health/live`
- 应用检查：`GET /health`
- Spring 管理检查：`GET /actuator/health`

## 6. 首次上线后的初始化步骤

### 6.1 验证管理员登录

若配置了：

- `BOOTSTRAP_ADMIN_LOGIN`
- `BOOTSTRAP_ADMIN_PASSWORD`

则使用该账号登录平台。

首次登录验证完成后，建议：

1. 记录管理员账号已可用
2. 移除运行环境中的 `BOOTSTRAP_ADMIN_PASSWORD`
3. 按需保留或移除 `BOOTSTRAP_ADMIN_LOGIN`

### 6.2 手动配置上游供应商

登录平台管理员后台后，逐个配置：

1. `Base URL`
2. `API Key`
3. 模型目录
4. 优先级
5. 超时
6. 健康状态

说明：

- 如果不配置 `Base URL` 和 `API Key`，对应模型不会真正可用
- AppKey 的可选模型列表会受供应商实际配置状态影响

### 6.3 验证核心功能

建议验证以下项目：

1. 管理员可登录
2. 供应商配置可保存
3. 可创建租户或注册用户
4. 可创建 AppKey
5. `POST /v1/chat/completions` 可正常调用
6. `Dashboard`、`Usage`、`Routing` 页面数据正常

## 7. 上线验收清单

上线完成后，至少检查以下内容：

### 7.1 服务检查

- `GET /health/live` 返回 `ok: true`
- `GET /health` 返回数据库正常
- `GET /actuator/health` 返回 `UP`

### 7.2 登录检查

- 平台管理员登录正常
- JWT 登录态正常
- 控制台页面可加载

### 7.3 数据检查

- Flyway 迁移已成功执行
- `plans` 表已有基础套餐
- `providers` 表已有 provider 目录
- 未写入错误的固定上游地址

### 7.4 网关检查

- 配置真实供应商后，模型调用成功
- 未配置供应商时，系统返回真实错误而非 mock 回复

## 8. 变更与回滚建议

### 8.1 上线前保留

- 前一版本前端静态包
- 前一版本后端 jar
- 当前数据库备份
- 当前环境变量备份

### 8.2 回滚顺序

如上线异常，建议按顺序处理：

1. 回滚前端静态资源
2. 回滚后端程序版本
3. 如有必要，回滚数据库
4. 恢复上一版环境变量

说明：

- 若数据库 migration 已执行，回滚前必须先评估是否允许回退 schema
- 生产环境不要直接手工删表或改字段

## 9. 推荐的运维交接清单

交接给运维或实施时，建议附带以下内容：

1. 本文档
2. 环境变量清单
3. 域名与证书信息
4. 数据库与 Redis 连接信息
5. 管理员初始化策略
6. 上游供应商配置表
7. 上线验收记录

## 10. 最终需要你提供的内容汇总

你至少需要提供：

1. 部署环境信息
   - 服务器 / 域名 / 证书
2. 数据存储信息
   - PostgreSQL 连接信息
   - Redis 连接信息
3. 必填安全变量
   - `JWT_SECRET`
   - `PROVIDER_CONFIG_SECRET`
   - `APP_KEY_PEPPER`
4. 管理员初始化信息
   - `BOOTSTRAP_ADMIN_LOGIN`
   - `BOOTSTRAP_ADMIN_PASSWORD`
5. 上游供应商信息
   - `Base URL`
   - `API Key`
   - 模型列表
   - 超时与优先级
6. 业务联络信息
   - `SALES_EMAIL`
   - `SUPPORT_EMAIL`

如果你把上面这些给到运维，基本就能按本文档完成一版标准部署。
