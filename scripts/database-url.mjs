import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export function readDatabaseUrl(root = process.cwd()) {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const envPaths = [".env.local", ".env"].map((file) => resolve(root, file));

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) {
      continue;
    }

    const match = readFileSync(envPath, "utf8").match(
      /^DATABASE_URL=(?:"([^"]+)"|([^\r\n]+))/m
    );

    if (match) {
      return match[1] ?? match[2];
    }
  }

  return "";
}

export function isPostgresUrl(databaseUrl) {
  return /^(postgres(ql)?|prisma\+postgres):/i.test(databaseUrl ?? "");
}

export function isSqliteUrl(databaseUrl) {
  return /^file:/i.test(databaseUrl ?? "");
}
