/**
 * 若无根目录 .env，则从 .env.example 复制一份，便于 docker compose 读取变量。
 * 不在仓库中写入真实密码；请在本机编辑 .env 设置 POSTGRES_PASSWORD 等。
 */
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var envPath = path.join(root, ".env");
var exPath = path.join(root, ".env.example");

if (!fs.existsSync(envPath) && fs.existsSync(exPath)) {
  fs.copyFileSync(exPath, envPath);
  console.log(
    "[docker] 已从 .env.example 创建根目录 .env。请编辑 .env 设置 POSTGRES_PASSWORD，并填写 JWT_SECRET / PROVIDER_CONFIG_SECRET / APP_KEY_PEPPER；如需初始化管理员，再填写 BOOTSTRAP_ADMIN_LOGIN / BOOTSTRAP_ADMIN_PASSWORD。"
  );
}
