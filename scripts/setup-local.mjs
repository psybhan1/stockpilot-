import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isPostgresUrl, isSqliteUrl, readDatabaseUrl } from "./database-url.mjs";

const root = process.cwd();
const envPath = join(root, ".env");
const envExamplePath = join(root, ".env.example");
const envLocalPath = join(root, ".env.local");
const prismaDir = join(root, "prisma");
const databasePath = join(prismaDir, "dev.db");
const placeholderPostgresRawUrl =
  "postgresql://user:password@localhost:5432/stockpilot?schema=public";
const placeholderPostgresUrl = `DATABASE_URL="${placeholderPostgresRawUrl}"`;
const localDatabaseUrl = `DATABASE_URL="file:${databasePath.replaceAll("\\", "/")}"`;
const shouldForceSeed = process.argv.includes("--seed");

function normalizeEnvContents(contents) {
  const existingMatch = contents.match(/^DATABASE_URL=(?:"([^"]+)"|([^\r\n]+))/m);
  const existingUrl = existingMatch ? existingMatch[1] ?? existingMatch[2] : process.env.DATABASE_URL ?? "";

  if (isPostgresUrl(existingUrl) && existingUrl !== placeholderPostgresRawUrl) {
    return contents;
  }

  if (/^DATABASE_URL=/m.test(contents)) {
    return contents.replace(/^DATABASE_URL=.*$/m, localDatabaseUrl);
  }

  return `${localDatabaseUrl}\n${contents.replace(placeholderPostgresUrl, "").trimStart()}`;
}

function ensureLocalEnv() {
  const sourceContents = existsSync(envLocalPath)
    ? readFileSync(envLocalPath, "utf8")
    : readFileSync(envExamplePath, "utf8");
  const normalized = normalizeEnvContents(sourceContents);

  writeFileSync(envLocalPath, normalized);
  writeFileSync(envPath, normalized);
}

mkdirSync(prismaDir, { recursive: true });
ensureLocalEnv();
const resolvedDatabaseUrl = readDatabaseUrl(root);

const isFirstRun = !existsSync(databasePath);

if (shouldForceSeed && existsSync(databasePath) && isSqliteUrl(localDatabaseUrl)) {
  rmSync(databasePath, { force: true });
}

console.info(
  isPostgresUrl(resolvedDatabaseUrl)
    ? "[stockpilot] env prepared for an external PostgreSQL database URL."
    : isFirstRun || shouldForceSeed
    ? "[stockpilot] local env prepared for a fresh demo database."
    : "[stockpilot] local env prepared. Existing demo database will be reused."
);
