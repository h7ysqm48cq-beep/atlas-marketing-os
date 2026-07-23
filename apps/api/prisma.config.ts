import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config({
  path: "apps/api/.env",
});

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL was not loaded from apps/api/.env",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
