var major = parseInt(process.versions.node.split(".")[0], 10) || 0;
if (major < 20) {
  console.error("");
  console.error(
    "[crm] 当前 Node 为 " +
      process.version +
      "，本项目需要 Node.js 20 或更高版本才能在本机执行 npm install / npm run dev。"
  );
  console.error("");
  console.error("—— 可选方案 ——");
  console.error("");
  console.error(
    "1) 不升级本机 Node：安装 Docker Desktop（https://www.docker.com/products/docker-desktop/ ），"
  );
  console.error(
    "   安装后打开 Docker 等待启动完成，在项目根目录执行：npm run dev:stack"
  );
  console.error(
    "   浏览器访问 http://localhost:5174 。管理员账号需通过 .env 中的 BOOTSTRAP_ADMIN_LOGIN / BOOTSTRAP_ADMIN_PASSWORD 初始化"
  );
  console.error("");
  console.error("2) 在本机开发（需要 Node 20）：");
  console.error("   Apple Silicon（M 系列）常见：");
  console.error(
    '   brew install node@20 && echo \'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"\' >> ~/.zshrc && source ~/.zshrc'
  );
  console.error("   Intel Mac 常见：");
  console.error(
    '   brew install node@20 && echo \'export PATH="/usr/local/opt/node@20/bin:$PATH"\' >> ~/.zshrc && source ~/.zshrc'
  );
  console.error("   或从 https://nodejs.org/ 安装 LTS（20.x）。");
  console.error("");
  console.error(
    "   装好 Node 20 后：若已用 Docker 跑数据库，执行 npm run setup；"
  );
  console.error(
    "   若不用 Docker，请先本机安装并启动 PostgreSQL，再执行 npm run setup:local"
  );
  console.error("");
  process.exit(1);
}
