import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const datasourceUrl =
  process.env.MIGRATION_DATABASE_URL?.trim() || env("DATABASE_URL");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: datasourceUrl,
  },
});
