---
title: TaaS SSL / HTTPS 部署指南
---

# TaaS SSL / HTTPS 部署指南

适用场景：

- 你已经在阿里云或其他证书平台申请了域名证书
- 当前项目按现有方案部署在 Linux 服务器上
- 前端由 `Nginx` 托管静态文件
- 后端 `Spring Boot` 监听 `127.0.0.1:3001`
- 目标是让域名通过 `HTTPS` 正常访问控制台和 API

本文默认使用当前项目的部署结构：

- 前端目录：`/srv/taas/frontend/current`
- 后端地址：`http://127.0.0.1:3001`
- Nginx 配置文件：`/etc/nginx/conf.d/taas.conf`

## 1. 先决条件

开始前请先确认以下条件全部满足：

1. 域名已经解析到当前服务器公网 IP
2. 安全组 / 防火墙已经放行 `80` 和 `443`
3. `nginx` 已安装并可正常运行
4. 证书状态已经是“已签发 / 可下载”

重要说明：

- 如果证书控制台还显示“申请中”“待审核”“待签发”之类状态，先不要部署
- 只有拿到正式证书文件后，Nginx 才能正确启用 HTTPS
- 你发来的截图里证书目前仍像是申请中状态，建议先等证书签发完成，再继续下面步骤

## 2. 你需要准备的文件

Nginx 通常需要这两类文件：

1. 证书文件：一般是 `.pem` / `.crt`
2. 私钥文件：一般是 `.key`

如果证书平台支持“下载 Nginx 证书”，优先直接下载 Nginx 版本。

推荐最终放到服务器上的命名：

```text
/etc/nginx/ssl/www.itoken.group.pem
/etc/nginx/ssl/www.itoken.group.key
```

说明：

- `www.itoken.group.pem` 应尽量包含服务器证书和中间证书链
- 如果你下载到的是 `fullchain.pem`，也可以直接使用
- 如果你拿到的是 `Apache`、`IIS`、`JKS`、`PFX` 包，不建议直接拿来配 Nginx，最好重新下载 Nginx 版本

## 3. 域名解析检查

在本地电脑执行：

```bash
nslookup www.itoken.group
```

或：s

```bash
dig www.itoken.group +short
```

确认返回的是你当前服务器公网 IP。

如果还没解析，请在 DNS 控制台添加：

- 记录类型：`A`
- 主机记录：`@` 或 `www`
- 记录值：你的服务器公网 IP

## 4. 上传证书到服务器

先登录服务器：

```bash
ssh root@你的服务器IP
```

创建证书目录：

```bash
mkdir -p /etc/nginx/ssl
chmod 700 /etc/nginx/ssl
```

把证书文件和私钥上传到服务器。常见方式有两种。

### 4.1 用 `scp` 上传

在你本地电脑执行：

```bash
scp /本地路径/www.itoken.group.pem root@你的服务器IP:/etc/nginx/ssl/
scp /本地路径/www.itoken.group.key root@你的服务器IP:/etc/nginx/ssl/
```

### 4.2 用 SFTP / 宝塔 / FinalShell 上传

如果你习惯图形化工具，也可以直接上传到：

```text
/etc/nginx/ssl/
```

上传后设置权限：

```bash
chmod 600 /etc/nginx/ssl/www.itoken.group.pem
chmod 600 /etc/nginx/ssl/www.itoken.group.key
```

### 4.3 用阿里云证书下载链接直接拉取

如果你手里拿到的是阿里云证书服务生成的临时下载链接，通常可以直接在服务器上下载证书包。

重要说明：

- 这种链接通常带签名、过期时间和临时 `security-token`
- 不要把完整下载链接写进仓库、脚本或长期保存的文档
- 最安全的做法是在服务器当前会话里临时使用，下载完就删除历史记录或关闭终端

推荐操作步骤：

```bash
mkdir -p /root/ssl-tmp
cd /root/ssl-tmp
```

使用 `curl` 下载证书包：

```bash
curl -L "<你的阿里云证书下载链接>" -o ssl-package.zip
```

如果服务器没有 `unzip`，先安装：

```bash
dnf install -y unzip
```

解压证书包：

```bash
unzip -o ssl-package.zip -d ssl-package
cd ssl-package
```

查找证书文件：

```bash
find . -type f \( -name "*.pem" -o -name "*.key" -o -name "*.crt" \)
```

常见情况：

1. 解压后会有 `Nginx` 目录
2. 里面通常会包含 `.pem` 和 `.key`
3. 有时文件名会直接带域名

例如你可以这样复制到正式目录：

```bash
cp /root/ssl-tmp/ssl-package/你的证书目录/www.itoken.group.pem /etc/nginx/ssl/www.itoken.group.pem
cp /root/ssl-tmp/ssl-package/你的证书目录/www.itoken.group.key /etc/nginx/ssl/www.itoken.group.key
chmod 600 /etc/nginx/ssl/www.itoken.group.pem
chmod 600 /etc/nginx/ssl/www.itoken.group.key
```

如果下载后发现拿到的不是 zip，而是直接就是证书文件，也可以直接改成：

```bash
curl -L "<你的证书文件链接>" -o /etc/nginx/ssl/www.itoken.group.pem
curl -L "<你的私钥文件链接>" -o /etc/nginx/ssl/www.itoken.group.key
chmod 600 /etc/nginx/ssl/www.itoken.group.pem
chmod 600 /etc/nginx/ssl/www.itoken.group.key
```

建议：

- 下载和解压完成后，删除临时目录中的压缩包和多余文件
- 不要把完整下载链接回填到 `docs/`、`.env`、脚本或 Git 提交里
- 如果链接已经过期，就回证书控制台重新生成新的下载链接

## 5. 备份现有 Nginx 配置

修改前先备份：

```bash
cp /etc/nginx/conf.d/taas.conf /etc/nginx/conf.d/taas.conf.bak-$(date +%F-%H%M%S)
```

## 6. 配置 Nginx HTTPS

编辑配置文件：

```bash
vi /etc/nginx/conf.d/taas.conf
```

将配置调整为下面这种结构。

当前示例按你的实际站点填写：

- 域名：`www.itoken.group`
- 证书：`/etc/nginx/ssl/www.itoken.group.pem`
- 私钥：默认示例使用 `/etc/nginx/ssl/www.itoken.group.key`

如果你线上私钥文件名不是这个值，只需要替换 `ssl_certificate_key` 那一行即可。

```nginx
server {
    listen 80;
    server_name www.itoken.group;

    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name www.itoken.group;

    root /srv/taas/frontend/current;
    index index.html;

    ssl_certificate /etc/nginx/ssl/www.itoken.group.pem;
    ssl_certificate_key /etc/nginx/ssl/www.itoken.group.key;

    ssl_session_timeout 10m;
    ssl_session_cache shared:SSL:10m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers off;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header X-XSS-Protection "1; mode=block";

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

## 7. 检查并加载 Nginx

先检查配置：

```bash
nginx -t
```

如果输出类似下面内容，说明配置正确：

```text
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

然后重载：

```bash
systemctl reload nginx
```

如果是首次启动或当前未运行，也可以执行：

```bash
systemctl restart nginx
systemctl status nginx --no-pager
```

## 8. 验证 HTTPS 是否生效

### 8.1 浏览器验证

直接访问：

```text
https://www.itoken.group
```

检查：

1. 浏览器地址栏是否显示安全锁
2. 访问 `http://www.itoken.group` 是否自动跳转到 `https://www.itoken.group`
3. 登录页、控制台页面、接口请求是否都正常

### 8.2 命令行验证

在服务器或本地执行：

```bash
curl -I https://www.itoken.group
```

如果需要看证书链：

```bash
openssl s_client -connect www.itoken.group:443 -servername www.itoken.group
```

### 8.3 API 验证

可继续检查项目接口：

```bash
curl https://www.itoken.group/health
curl https://www.itoken.group/health/live
curl -I https://www.itoken.group/api
```

## 9. TaaS 项目上线后要同步检查的点

切到 HTTPS 后，建议至少验证以下项目路径：

1. `https://www.itoken.group`
2. `https://www.itoken.group/login`
3. `https://www.itoken.group/api/...`
4. `https://www.itoken.group/v1/chat/completions`
5. `https://www.itoken.group/v1/messages`

说明：

- 前端页面通过 `Nginx` 直接提供
- `/api`、`/v1`、`/gateway`、`/health` 都会被反向代理到本机 `3001`
- 如果证书已生效但接口报错，优先排查 Nginx 反向代理和后端服务状态，而不是 SSL 本身

## 10. 常见问题排查

### 10.1 浏览器提示证书无效

常见原因：

1. 证书还没签发完成
2. 证书域名和访问域名不一致
3. 少传了中间证书链
4. 配置错了证书文件或私钥文件

排查建议：

```bash
openssl x509 -in /etc/nginx/ssl/www.itoken.group.pem -text -noout | less
```

重点看：

- `Subject`
- `DNS`
- 有效期

### 10.2 `nginx -t` 报私钥不匹配

报错通常类似：

```text
key values mismatch
```

说明证书和私钥不是一对，重新下载正确的 `.pem` 和 `.key` 后再替换。

### 10.3 配置成功但访问仍是 HTTP

优先检查：

1. `80` 和 `443` 是否放行
2. 域名是否解析到正确服务器
3. 是否忘了执行 `systemctl reload nginx`
4. 浏览器是否缓存了旧跳转

### 10.4 HTTPS 能打开，页面接口报 502

这通常不是证书问题，而是后端没起来。

检查：

```bash
systemctl status taas-backend --no-pager
curl http://127.0.0.1:3001/health
journalctl -u taas-backend -n 100 --no-pager
```

### 10.5 证书到期后怎么办

如果你使用的是“手动下载上传证书”方案：

1. 证书快到期前重新申请或续签
2. 重新下载新的 `.pem` 和 `.key`
3. 覆盖 `/etc/nginx/ssl/` 下原文件
4. 执行 `nginx -t`
5. 执行 `systemctl reload nginx`

## 11. 备选方案：用 Certbot 自动签发

如果你不想手动上传证书，也可以改用 `Let's Encrypt + Certbot`。

安装：

```bash
dnf install -y certbot python3-certbot-nginx
```

签发：

```bash
certbot --nginx -d www.itoken.group
```

启用自动续期：

```bash
systemctl enable --now certbot-renew.timer
systemctl list-timers | grep certbot
```

说明：

- 这个方案适合公网可直接验证域名所有权的场景
- 如果你已经在阿里云申请好了正式证书，优先按本文前面的“手动上传证书到 Nginx”方案部署即可

## 12. 推荐执行顺序

如果你现在就要上线 HTTPS，建议按这个顺序做：

1. 等证书状态变成已签发
2. 确认域名解析到服务器
3. 下载 Nginx 版本证书
4. 上传 `.pem` / `.key` 到 `/etc/nginx/ssl/`
5. 修改 `/etc/nginx/conf.d/taas.conf`
6. 执行 `nginx -t`
7. 执行 `systemctl reload nginx`
8. 打开 `https://www.itoken.group` 验证

## 13. 本项目建议

结合当前 `TaaS` 项目，建议你正式对外时统一只暴露：

- `443`：正式 HTTPS 入口
- `80`：仅用于跳转到 HTTPS

不建议继续暴露：

- `3001`
- `5432`
- `6379`

这样浏览器、控制台、网关接口都统一走域名 HTTPS，更符合正式生产部署方式。
