import type { ServerResponse } from "node:http";
import { defineConfig } from "vite";
import type { ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";

/**
 * `http://api:3001` 仅在 docker compose 的 `web` 服务所接入的网络上可解析。
 * 宿主机、Dev Container（也有 /.dockerenv）等场景应走 127.0.0.1。
 * Compose 的 web 服务需设置 VITE_DOCKER_COMPOSE_WEB=1（见 docker-compose.yml）。
 */
function resolveApiProxyTarget(): string {
  const fallback = "http://127.0.0.1:3001";
  const raw = process.env.API_PROXY_TARGET?.trim();
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    const useComposeDns =
      process.env.VITE_DOCKER_COMPOSE_WEB === "1" ||
      process.env.VITE_DOCKER_COMPOSE === "1";
    if (u.hostname === "api" && !useComposeDns) {
      const port = u.port || "3001";
      console.warn(
        `[vite] API_PROXY_TARGET=${raw} 仅在 compose web 容器内可用；已改用 http://127.0.0.1:${port}（若在 compose 中跑 web，请设置 VITE_DOCKER_COMPOSE_WEB=1）`
      );
      return `http://127.0.0.1:${port}`;
    }
    return raw;
  } catch {
    return raw;
  }
}

const apiTarget = resolveApiProxyTarget();

function sendProxy502(res: unknown): void {
  if (
    res &&
    typeof res === "object" &&
    "writeHead" in res &&
    typeof (res as ServerResponse).writeHead === "function" &&
    !(res as ServerResponse).headersSent
  ) {
    const r = res as ServerResponse;
    r.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    const inComposeWeb =
      process.env.VITE_DOCKER_COMPOSE_WEB === "1" ||
      process.env.VITE_DOCKER_COMPOSE === "1";
    const hint = inComposeWeb
      ? "（Docker Compose web）请确认已执行 docker compose up api web，且 api 容器健康、与 web 同属一组 compose 网络。"
      : "（本机 / Dev Container）请在 server 目录 npm run dev（默认 3001），根目录可先 npm run db:up；并执行 prisma migrate deploy / db seed。代理目标为 127.0.0.1 时勿依赖主机名 api。";
    r.end(
      JSON.stringify({
        error: `无法连接 API（${apiTarget}）。${hint}`,
      })
    );
  }
}

const proxyBase: ProxyOptions = {
  target: apiTarget,
  changeOrigin: true,
  configure(proxy) {
    proxy.on("error", (_err, _req, res) => {
      sendProxy502(res);
    });
  },
};

const apiProxy = {
  "/api": {
    ...proxyBase,
    rewrite: (path: string) => path.replace(/^\/api/, ""),
  },
  "/gateway": { ...proxyBase },
  "/v1": { ...proxyBase },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: apiProxy,
  },
  preview: {
    host: true,
    port: 4173,
    proxy: apiProxy,
  },
});
