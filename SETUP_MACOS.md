# macOS 上运行本 CRM（你当前是 Node v10、且无 Docker）

## 情况说明

- `npm run setup` / `npm run dev:server` **必须先有 Node 20+**，否则会提示版本不够。
- `npm run dev:stack` **不要求**本机 Node 版本，但 **必须先安装并启动 Docker Desktop**，否则会提示 `docker: command not found`。

---

## 方案 A：只装 Docker（推荐，不必升级本机 Node）

1. 安装 [Docker Desktop for Mac](https://www.docker.com/products/docker-desktop/)，安装后**打开 Docker**，等菜单栏鲸鱼图标就绪。
2. 在项目根目录执行：

```bash
cd /Users/redtea/Desktop/CURSOR-TaaS
npm run dev:stack
```

3. 浏览器打开 **http://localhost:5174**  
   登录名 **wangqiang**，密码 **123456**（首次启动容器内会自动 `migrate` + `seed`）。

---

## 方案 B：本机安装 Node 20 + 用 Docker 只跑数据库

1. 安装 Node 20（任选其一）  
   - Homebrew（Apple Silicon 常见）：

     ```bash
     brew install node@20
     echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
     source ~/.zshrc
     node -v
     ```

   - 或从 [Node.js 官网](https://nodejs.org/) 安装 20.x LTS。

2. 安装并启动 Docker Desktop（用于 PostgreSQL 容器）。

3. 在项目根目录：

```bash
cd /Users/redtea/Desktop/CURSOR-TaaS
npm run setup
npm run dev:server   # 终端 1
npm run dev:client   # 终端 2
```

---

## 方案 C：本机 Node 20 + 本机 PostgreSQL（不用 Docker）

1. 安装 Node 20（同方案 B）。  
2. 安装并启动 PostgreSQL（例如 `brew install postgresql@16` 并 `brew services start postgresql@16`），创建与 `server/.env.example` 中一致的用户/库，或修改 `server/.env` 里的 `DATABASE_URL`。  
3. 执行：

```bash
cd /Users/redtea/Desktop/CURSOR-TaaS
npm run setup:local
npm run dev:server
npm run dev:client
```

---

## 常见错误

| 现象 | 处理 |
|------|------|
| 需要 Node.js 20 | 按方案 A 用 Docker 跑全套，或按 B/C 安装 Node 20 |
| `docker: command not found` | 安装并打开 Docker Desktop，再执行 `npm run dev:stack` |
| 页面能开但接口失败 | 确认 API 已监听 **3001**，且前端通过 **http://localhost:5174** 访问（不要直接打开 `index.html` 文件） |
