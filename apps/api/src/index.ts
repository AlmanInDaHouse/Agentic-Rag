import { env } from "./config/env.js";
import { pool } from "./db/pool.js";
import { buildApp } from "./app.js";

const app = await buildApp();

const shutdown = async () => {
  await app.close();
  await pool.end();
};

process.on("SIGINT", () => {
  shutdown().finally(() => process.exit(0));
});

process.on("SIGTERM", () => {
  shutdown().finally(() => process.exit(0));
});

await app.listen({
  host: env.HOST,
  port: env.PORT
});
