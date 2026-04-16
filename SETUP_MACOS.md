# macOS 上运行本 TaaS（默认 Java 后端）

## 情况说明

- `npm run dev:server` 默认启动的是 `backend-java/`，需要 **Java 17+ / Maven 3.9+**。
- `npm run dev:client` 仍需要 **Node 20+**。
- `npm run dev:stack` 主要依赖 Docker Desktop；前端容器内会自行安装 Node 依赖。

---

## 方案 A：Docker Compose 启动整套（推荐）

1. 安装 [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/)，安装后**打开 Docker**，等菜单栏鲸鱼图标就绪。
2. 在项目根目录执行：

```bash
cd /Users/asher/Projects/TaaS
npm run dev:stack
```

3. 浏览器打开 **http://localhost:5174**  
   登录名 **wangqiang**，密码 **123456**（Java 后端启动时会自动补齐基础 seed）。

---

## 方案 B：本机 Java + Maven + Node，数据库用 Docker

1. 安装 Java 17+ 与 Maven 3.9+。  
2. 安装 Node 20（前端用）。  
3. 安装并启动 Docker Desktop（用于 PostgreSQL 容器）。

4. 在项目根目录：

   ```bash
   cd /Users/asher/Projects/TaaS
   npm run setup
   npm run dev:server   # 终端 1，Java 后端
   npm run dev:client   # 终端 2，Vite 前端
   ```

---

## 方案 C：本机 Java + Node + 本机 PostgreSQL（不用 Docker）

1. 安装 Java 17+ / Maven 3.9+ / Node 20。  
2. 安装并启动 PostgreSQL（例如 `brew install postgresql@16` 并 `brew services start postgresql@16`），创建与根目录 `.env` 一致的用户/库，默认本地端口是 `5433`。  
3. 执行：

```bash
cd /Users/asher/Projects/TaaS
npm run setup:local
npm run dev:server
npm run dev:client
```

---

## 常见错误

| 现象 | 处理 |
|------|------|
| 需要 Java / Maven | 安装 Java 17+ 与 Maven 3.9+，`npm run dev:server` 默认启动 Java 后端 |
| 需要 Node.js 20 | 前端开发仍需要 Node 20 |
| `docker: command not found` | 安装并打开 Docker Desktop，再执行 `npm run dev:stack` |
| 页面能开但接口失败 | 确认 Java API 已监听 **3001**，且前端通过 **http://localhost:5174** 访问 |
