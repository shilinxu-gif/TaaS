import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { prisma } from "./db.js";
import { registerRoutes } from "./routes.js";

const port = Number(process.env.PORT ?? 3001);

if (!process.env.DATABASE_URL?.trim()) {
  console.error(
    "[gateway] 未设置 DATABASE_URL。请在 server 目录执行：cp .env.example .env（或运行 npm run dev 会自动复制）"
  );
  process.exit(1);
}

try {
  await prisma.$connect();
} catch (err) {
  console.error(
    "[gateway] 无法连接 PostgreSQL。请先启动数据库：在项目根目录执行 npm run db:up，然后执行 npx prisma migrate deploy（在 server 目录）"
  );
  console.error(err);
  process.exit(1);
}

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  credentials: true,
});

app.setErrorHandler((err, request, reply) => {
  request.log.error(err);
  const code =
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    typeof (err as { statusCode: unknown }).statusCode === "number"
      ? (err as { statusCode: number }).statusCode
      : 500;
  const message =
    err instanceof Error ? err.message : "Unexpected server error";
  void reply.status(code).send({ error: message });
});

await registerRoutes(app);

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
