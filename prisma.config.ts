import { defineConfig, env } from "prisma/config";
import { loadEnvironment } from "./scripts/load-env.mjs";

loadEnvironment();

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
