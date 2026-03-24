import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Prefer DIRECT_DATABASE_URL for CLI operations (migrations, introspection).
    // Neon's pooled URL uses pgBouncer which cannot run DDL statements.
    url: process.env["DIRECT_DATABASE_URL"] ?? process.env["DATABASE_URL"],
    // Required for `prisma migrate diff --from-migrations` (replays migrations into a throwaway DB).
    // CI sets SHADOW_DATABASE_URL; optional locally.
    ...(process.env["SHADOW_DATABASE_URL"]
      ? { shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"] }
      : {}),
  },
});
