# TaaS 在阿里云轻量服务器部署指南（Alibaba Cloud Linux）

适用场景：  
- 服务器类型：阿里云轻量应用服务器  
- 操作系统镜像：`AlibabaCloudLinux`  
- 部署目标：将当前 `TaaS` 项目部署到单台 Linux 服务器，对外提供控制台和 API 服务

本文档默认采用以下部署形态：

1. 单机部署
2. 前端静态文件由 `Nginx` 托管
3. 后端 `Spring Boot` 以 `systemd` 服务运行
4. `PostgreSQL 16` 和 `Redis 7` 使用 Docker 容器运行
5. 通过 Nginx 统一暴露 HTTP/HTTPS

这样做的原因是：

- 阿里云轻量服务器更适合单机一体化部署
- 当前仓库自带 `docker-compose.yml`，适合直接拉起 `PostgreSQL` / `Redis`
- 前后端分开部署后，升级、排障、回滚都更直观

## 0. 执行约定

本文档中的命令统一按“管理员/root 权限”执行。

推荐做法：

1. 先使用普通用户 SSH 登录服务器
2. 立即切换到 root shell
3. 后续全文命令都在 root shell 中执行

执行方式：

```bash
sudo -i
whoami
```

预期输出：

```text
root
```

说明：

- 如果你的服务器直接允许 `root` 登录，可以跳过 `sudo -i`
- 如果 `sudo -i` 执行失败，先不要继续部署，先确认当前账号是否有管理员权限
- 下文默认你已经进入 root shell，因此命令里不再逐条添加 `sudo`

## 1. 部署结构

推荐部署结构如下：

```text
/srv/taas/
  app/
    TaaS/             # Git 仓库根目录
  backend/
    current/          # 当前后端 jar
  frontend/
    current/          # 当前前端 dist
  logs/
  scripts/
```

最终流量路径：

```text
浏览器
  -> Nginx :80 / :443
    -> /            前端静态文件
    -> /api         Java 后端（重写去掉 /api 前缀）
    -> /v1          Java 后端
    -> /gateway     Java 后端
    -> /health      Java 后端
```

## 2. 服务器要求

建议最低配置：

- 2 vCPU
- 4 GB 内存
- 60 GB 系统盘

如果要接真实模型供应商并长期运行，建议：

- 4 vCPU
- 8 GB 内存

阿里云安全组至少开放：

- `22`：SSH
- `80`：HTTP
- `443`：HTTPS

不建议对公网开放：

- `3001`
- `5432`
- `6379`
- `5174`

## 3. 首次登录后的系统准备

先切换到 `root`，确认当前是管理员上下文：

```bash
sudo -i
whoami
```

确认输出为 `root` 后，再继续执行下面的命令：

```bash
dnf update -y
dnf install -y git nginx java-17-openjdk java-17-openjdk-devel maven docker
```

安装 Node.js 20：

```bash
curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
dnf install -y nodejs
```

校验版本：

```bash
java -version
mvn -version
node -v
npm -v
docker -v
```

如 `docker compose` 不可用，再补装 compose 插件：

```bash
dnf install -y docker-compose-plugin
docker compose version
```

启用系统服务：

```bash
systemctl enable --now docker
systemctl enable --now nginx
```

## 4. 创建部署目录

```bash
mkdir -p /srv/taas/{app,backend/current,frontend/current,logs,scripts}
```

克隆项目：

```bash
cd /srv/taas/app
git clone <你的仓库地址> TaaS
cd /srv/taas/app/TaaS
```

## 5. 准备环境变量

在项目根目录生成 `.env`：

```bash
cd /srv/taas/app/TaaS
cp .env.example .env
```

编辑 `.env`，至少补齐以下内容：

```bash
POSTGRES_USER=crm
POSTGRES_DB=crm
POSTGRES_PASSWORD=请替换为强密码
POSTGRES_PORT=5432

POSTGRES_HOST=127.0.0.1
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

JWT_SECRET=请替换为至少32位随机字符串
PROVIDER_CONFIG_SECRET=请替换为至少32位随机字符串
APP_KEY_PEPPER=请替换为至少32位随机字符串

BOOTSTRAP_ADMIN_LOGIN=admin
BOOTSTRAP_ADMIN_PASSWORD=请替换为强密码

SALES_EMAIL=sales@example.com
SUPPORT_EMAIL=support@example.com
TRIAL_DAYS=14

OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=

PORT=3001
ALLOW_MOCK_PROVIDER=false
```

说明：

- `BOOTSTRAP_ADMIN_LOGIN` / `BOOTSTRAP_ADMIN_PASSWORD` 用于首次部署初始化管理员
- 首次登录验证完成后，建议删除 `BOOTSTRAP_ADMIN_PASSWORD`
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` 可以先留空，后续再从后台配置真实供应商

限制权限：

```bash
chmod 600 /srv/taas/app/TaaS/.env
```

## 6. 启动 PostgreSQL 和 Redis

本文档采用仓库自带 `docker-compose.yml`，但只启动 `postgres` 和 `redis`：

```bash
cd /srv/taas/app/TaaS
docker compose up -d postgres redis
```

查看状态：

```bash
docker compose ps
```

确认数据库可用：

```bash
docker exec -it $(docker compose ps -q postgres) psql -U crm -d crm -c '\l'
```

确认 Redis 可用：

```bash
docker exec -it $(docker compose ps -q redis) redis-cli ping
```

预期返回：

```text
PONG
```

## 7. 构建后端

在项目根目录执行：

```bash
cd /srv/taas/app/TaaS
set -a
source ./.env
set +a
mvn -f backend-java/pom.xml -DskipTests package
```

打包完成后，将 jar 复制到固定目录：

```bash
cp backend-java/target/backend-java-0.0.1-SNAPSHOT.jar /srv/taas/backend/current/app.jar
```

## 8. 创建后端 systemd 服务

新建文件：

```bash
vi /etc/systemd/system/taas-backend.service
```

填入以下内容：

```ini
[Unit]
Description=TaaS Backend (Spring Boot)
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
WorkingDirectory=/srv/taas/app/TaaS
EnvironmentFile=/srv/taas/app/TaaS/.env
ExecStart=/usr/bin/java -jar /srv/taas/backend/current/app.jar
Restart=always
RestartSec=5
StandardOutput=append:/srv/taas/logs/backend.out.log
StandardError=append:/srv/taas/logs/backend.err.log

[Install]
WantedBy=multi-user.target
```

加载并启动：

```bash
systemctl daemon-reload
systemctl enable --now taas-backend
systemctl status taas-backend
```

查看日志：

```bash
journalctl -u taas-backend -f
```

健康检查：

```bash
curl http://127.0.0.1:3001/health/live
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/actuator/health
```

## 9. 构建前端

```bash
cd /srv/taas/app/TaaS
npm install --prefix client
npm run build --prefix client
```

复制前端产物：

```bash
rm -rf /srv/taas/frontend/current/*
cp -r client/dist/* /srv/taas/frontend/current/
```

## 10. 配置 Nginx

新建站点配置：

```bash
vi /etc/nginx/conf.d/taas.conf
```

填入以下内容：

```nginx
server {
    listen 80;
    server_name 8.219.108.49;

    root /srv/taas/frontend/current;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        rewrite ^/api/?(.*)$ /$1 break;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /v1/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /gateway/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /health {
        proxy_pass http://127.0.0.1:3001;
    }

    location /actuator/ {
        proxy_pass http://127.0.0.1:3001;
    }
}
```

校验并重载：

```bash
nginx -t
systemctl reload nginx
```

## 11. 绑定域名和 HTTPS（可选但强烈建议）

如果已经有域名并解析到这台轻量服务器：

1. 当前如果直接通过公网 IP 访问，可保留：

```nginx
server_name 8.219.108.49;
```

2. 如果后续绑定正式域名，再改成你的正式域名，例如：

```nginx
server_name taas.example.com;
```

3. 安装 Certbot：

```bash
dnf install -y certbot python3-certbot-nginx
```

4. 申请证书：

```bash
certbot --nginx -d taas.example.com
```

5. 开启自动续期：

```bash
systemctl enable --now certbot-renew.timer
systemctl list-timers | grep certbot
```

## 12. 首次上线后的初始化

### 12.1 登录平台管理员

访问：

- `http://8.219.108.49`
- 或 `https://你的域名`

使用以下账号登录：

- `BOOTSTRAP_ADMIN_LOGIN`
- `BOOTSTRAP_ADMIN_PASSWORD`

确认管理员登录成功后，建议：

1. 修改管理员密码
2. 从 `/srv/taas/app/TaaS/.env` 中移除 `BOOTSTRAP_ADMIN_PASSWORD`
3. 重启后端服务

```bash
systemctl restart taas-backend
```

### 12.2 配置真实供应商

登录后台后，进入供应商管理页面，配置：

1. `Base URL`
2. `API Key`
3. 模型目录
4. 优先级
5. 超时
6. 健康状态

说明：

- 当前系统不会自动写入固定上游地址
- 如果不配置真实供应商，`/v1/chat/completions` 会返回真实的未配置错误

## 13. 上线后验收

### 13.1 服务验收

```bash
curl http://127.0.0.1:3001/health/live
curl http://127.0.0.1:3001/health
curl http://127.0.0.1:3001/actuator/health
curl -I http://8.219.108.49
```

### 13.2 页面验收

至少检查：

1. 登录页可访问
2. 管理员可登录
3. `Dashboard` 正常显示
4. `API Keys` 页面可打开
5. `Usage` / `Routing` / `Ops` 页面可打开
6. `POST /v1/chat/completions` 可正常调用

### 13.3 数据验收

检查：

1. Flyway 迁移已执行
2. 基础套餐已自动写入
3. Provider 目录已生成
4. Redis 可正常连接

## 14. 日常运维命令

### 14.1 查看后端状态

```bash
systemctl status taas-backend
journalctl -u taas-backend -f
```

### 14.2 查看容器状态

```bash
cd /srv/taas/app/TaaS
docker compose ps
docker compose logs -f postgres redis
```

### 14.3 重启服务

```bash
systemctl restart taas-backend
systemctl reload nginx
```

### 14.4 停止 / 启动数据库与 Redis

```bash
cd /srv/taas/app/TaaS
docker compose stop postgres redis
docker compose start postgres redis
```

## 15. 升级发布流程

当你已经把最新代码推到 Git 仓库后，线上机器更新版本请按下面顺序执行。

这一节适用于：

- 已经完成首次部署
- 后端服务名为 `taas-backend`
- 项目源码目录为 `/srv/taas/app/TaaS`
- 后端运行文件为 `/srv/taas/backend/current/app.jar`
- 前端静态目录为 `/srv/taas/frontend/current`

说明：

- 以下命令同样默认在 root shell 中执行
- 如果你当前不是 root，请先重新执行 `sudo -i`
- `npm install --prefix client` 和 `npm run build --prefix client` 必须在 `/srv/taas/app/TaaS` 目录执行
- 不要在 `/srv/taas/backend/current` 目录执行前端命令；那个目录只有后端 jar，没有 `client/package.json`

### 15.1 一次标准更新

按下面顺序逐行执行：

```bash
cd /srv/taas/app/TaaS
pwd
git pull origin prod

docker compose up -d postgres redis

set -a
source ./.env
set +a

mvn -f backend-java/pom.xml -DskipTests package
cp backend-java/target/backend-java-0.0.1-SNAPSHOT.jar /srv/taas/backend/current/app.jar
systemctl restart taas-backend

curl http://127.0.0.1:3001/health/live
curl http://127.0.0.1:3001/health

npm install --prefix client
npm run build --prefix client
rm -rf /srv/taas/frontend/current/*
cp -r client/dist/* /srv/taas/frontend/current/

nginx -t
systemctl reload nginx

curl -I http://8.219.108.49
```

### 15.2 使用一键更新脚本

仓库内已经提供一键更新脚本：

- 路径：`scripts/deploy-prod.sh`
- 默认分支：`prod`
- 默认源码目录：`/srv/taas/app/TaaS`
- 默认后端服务：`taas-backend`

脚本会自动执行以下动作：

1. `git fetch` + `git pull --ff-only origin prod`
2. 启动 `postgres` / `redis`
3. 加载项目根目录 `.env`
4. 构建后端 jar
5. 备份旧版 `app.jar` 并发布新包
6. 重启 `taas-backend`
7. 检查 `/health/live` 与 `/health`
8. 安装前端依赖并执行 `vite build`
9. 发布前端静态资源到 `/srv/taas/frontend/current`
10. 执行 `nginx -t` 并 reload `nginx`
11. 验证公网入口

首次在服务器上使用：

```bash
cd /srv/taas/app/TaaS
chmod +x scripts/deploy-prod.sh
```

执行一键更新：

```bash
cd /srv/taas/app/TaaS
bash scripts/deploy-prod.sh
```

如果你以后要切换分支，也可以显式指定：

```bash
cd /srv/taas/app/TaaS
bash scripts/deploy-prod.sh prod
```

如果你想覆盖默认参数，可以临时传环境变量：

```bash
cd /srv/taas/app/TaaS
APP_DIR=/srv/taas/app/TaaS \
BACKEND_SERVICE=taas-backend \
PUBLIC_CHECK_URL=http://8.219.108.49 \
bash scripts/deploy-prod.sh
```

脚本要求：

- 必须在 `root shell` 下执行
- 机器上已安装 `git` / `docker` / `mvn` / `npm` / `curl` / `nginx`
- 已完成首次部署，且目录结构与本手册保持一致

如果脚本执行失败，优先看：

```bash
systemctl status taas-backend --no-pager
journalctl -u taas-backend -n 200 --no-pager
nginx -t
```

### 15.3 建议检查点

完成更新后，建议至少检查以下内容：

```bash
pwd
systemctl status taas-backend --no-pager
curl http://127.0.0.1:3001/health
curl -I http://8.219.108.49
```

如果后端启动失败，优先看：

```bash
journalctl -u taas-backend -n 200 --no-pager
tail -n 200 /srv/taas/logs/backend.out.log
tail -n 200 /srv/taas/logs/backend.err.log
```

如果前端页面返回 `403` 或空白页，优先检查：

```bash
cd /srv/taas/app/TaaS
ls client/dist
ls /srv/taas/frontend/current
```

### 15.4 常见更新误区

不要这样做：

1. 在 `/srv/taas/backend/current` 目录执行 `npm install --prefix client`
2. 先清空 `/srv/taas/frontend/current/*`，但没有成功执行前端 build
3. 修改了 `.env` 但忘了 `systemctl restart taas-backend`
4. 后端未通过健康检查，就直接继续重载 Nginx 或验证登录

## 16. 回滚建议

如果升级失败，建议按以下顺序处理：

1. 回滚前端静态资源
2. 回滚后端 `app.jar`
3. 重启 `taas-backend`
4. 必要时再处理数据库

注意：

- 如果 Flyway migration 已执行，回滚前必须确认 schema 是否允许回退
- 不要直接手工删表或改字段

## 17. 常见问题

### 17.1 页面能打开，但接口报 502

通常原因：

1. `taas-backend` 没启动
2. Nginx 代理没配好
3. `/api` 没做 rewrite

排查：

```bash
systemctl status taas-backend
curl http://127.0.0.1:3001/health
nginx -t
```

### 17.2 后端启动失败

优先检查：

1. `.env` 是否缺少 `JWT_SECRET` / `PROVIDER_CONFIG_SECRET` / `APP_KEY_PEPPER`
2. PostgreSQL 是否可连接
3. Redis 是否可连接

日志查看：

```bash
journalctl -u taas-backend -n 200 --no-pager
```

### 17.3 前端白屏

优先检查：

1. 是否重新执行了 `npm run build --prefix client`
2. `dist` 是否复制到 `/srv/taas/frontend/current`
3. Nginx `try_files` 是否指向 `/index.html`

### 17.4 登录成功后没有数据

优先检查：

1. 管理员是否已初始化成功
2. Flyway 是否执行成功
3. 是否已配置真实供应商

## 18. 推荐交付物

正式交付给运维或客户时，建议同时提供：

1. 本文档
2. `docs/OPS_DEPLOYMENT_RUNBOOK.md`
3. `.env` 变量清单（不要把真实密码提交到仓库）
4. 域名、证书、服务器信息
5. 管理员初始化策略
6. 上游供应商配置表

如果后续你希望把这份文档继续升级成“可直接复制执行”的版本，建议下一步再补两样：

1. `systemd` 服务文件模板落到仓库 `scripts/`
2. `Nginx` 配置模板落到仓库 `docs/examples/` 或 `deploy/`
