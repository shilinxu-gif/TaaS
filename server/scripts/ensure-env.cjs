var fs = require("fs");
var path = require("path");

var serverRoot = path.join(__dirname, "..");
var envPath = path.join(serverRoot, ".env");
var examplePath = path.join(serverRoot, ".env.example");
var rootEnvPath = path.join(serverRoot, "..", ".env");

function parseEnvFile(p) {
  /** @type {Record<string, string>} */
  var o = {};
  if (!fs.existsSync(p)) return o;
  var raw = fs.readFileSync(p, "utf8");
  raw.split("\n").forEach(function (line) {
    var m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) return;
    var v = m[2].trim();
    if (
      (v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') ||
      (v.charAt(0) === "'" && v.charAt(v.length - 1) === "'")
    ) {
      v = v.slice(1, -1);
    }
    o[m[1]] = v;
  });
  return o;
}

function needsDbUrlMerge(text) {
  if (!text) return true;
  if (!/DATABASE_URL\s*=/.test(text)) return true;
  return (
    /CHANGE_USER|CHANGE_PASSWORD|CHANGE_DB/.test(text) ||
    /DATABASE_URL\s*=\s*["']?\s*["']?$/.test(text)
  );
}

function upsertDatabaseUrl(content, databaseUrl) {
  var escaped = databaseUrl.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  var lines = content.split("\n");
  var found = false;
  var out = lines.map(function (line) {
    if (/^\s*DATABASE_URL\s*=/.test(line)) {
      found = true;
      return 'DATABASE_URL="' + escaped + '"';
    }
    return line;
  });
  if (!found) {
    out.push('DATABASE_URL="' + escaped + '"');
  }
  return out.join("\n");
}

if (!fs.existsSync(envPath) && fs.existsSync(examplePath)) {
  fs.copyFileSync(examplePath, envPath);
  console.log("[gateway] 已从 .env.example 创建 server/.env（请检查 JWT_SECRET / DATABASE_URL）");
} else if (!fs.existsSync(envPath)) {
  console.error("[gateway] 缺少 server/.env，且未找到 .env.example");
  process.exit(1);
}

var rootEnv = parseEnvFile(rootEnvPath);
var serverEnvText = fs.readFileSync(envPath, "utf8");
var hasRootPg =
  rootEnv.POSTGRES_USER !== undefined ||
  rootEnv.POSTGRES_DB !== undefined ||
  rootEnv.POSTGRES_PASSWORD !== undefined;

if (hasRootPg && needsDbUrlMerge(serverEnvText)) {
  var user = rootEnv.POSTGRES_USER || "crm";
  var pass =
    rootEnv.POSTGRES_PASSWORD !== undefined && rootEnv.POSTGRES_PASSWORD !== ""
      ? rootEnv.POSTGRES_PASSWORD
      : "crm";
  var db = rootEnv.POSTGRES_DB || "crm";
  var port = rootEnv.POSTGRES_PORT || "5432";
  var dbUrl =
    "postgresql://" +
    encodeURIComponent(user) +
    ":" +
    encodeURIComponent(pass) +
    "@localhost:" +
    port +
    "/" +
    encodeURIComponent(db) +
    "?schema=public";
  var merged = upsertDatabaseUrl(serverEnvText, dbUrl);
  fs.writeFileSync(envPath, merged);
  console.log(
    "[gateway] 已根据根目录 .env 写入 server/.env 中的 DATABASE_URL（本机连 Docker Postgres）"
  );
}
