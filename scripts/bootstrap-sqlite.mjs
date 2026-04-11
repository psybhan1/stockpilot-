import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Prisma } from "../src/generated/prisma-sqlite/index.js";
import { isSqliteUrl } from "./database-url.mjs";

const root = process.cwd();
const prismaDir = resolve(root, "prisma");
const envPaths = [".env.local", ".env"].map((file) => resolve(root, file));
const fallbackDatabaseUrl = "file:./dev.db";
const sqliteNowExpression =
  "(CAST(strftime('%s','now') AS INTEGER) * 1000)";

function readDatabaseUrl() {
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

  return fallbackDatabaseUrl;
}

function resolveDatabasePath(databaseUrl) {
  if (!isSqliteUrl(databaseUrl)) {
    throw new Error(
      `StockPilot local bootstrap only supports SQLite file URLs. Received: ${databaseUrl}`
    );
  }

  const filePath = databaseUrl.slice("file:".length);

  if (/^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith("/")) {
    return resolve(filePath);
  }

  return resolve(prismaDir, filePath);
}

function toSqlLiteral(value) {
  if (typeof value === "number") {
    return `${value}`;
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function getColumnType(field) {
  if (field.kind === "enum") {
    return "TEXT";
  }

  switch (field.type) {
    case "Int":
    case "BigInt":
      return "INTEGER";
    case "Boolean":
      return "BOOLEAN";
    case "Float":
      return "REAL";
    case "Decimal":
      return "DECIMAL";
    case "Bytes":
      return "BLOB";
    case "Json":
      return "JSONB";
    case "DateTime":
      return "NUMERIC";
    default:
      return "TEXT";
  }
}

function getDefaultClause(field) {
  if (field.isUpdatedAt) {
    return ` DEFAULT ${sqliteNowExpression}`;
  }

  if (!field.hasDefaultValue) {
    return "";
  }

  if (typeof field.default === "object" && field.default?.name === "now") {
    return ` DEFAULT ${sqliteNowExpression}`;
  }

  if (
    typeof field.default === "object" &&
    ["cuid", "uuid", "autoincrement", "auto"].includes(field.default?.name ?? "")
  ) {
    return "";
  }

  return ` DEFAULT ${toSqlLiteral(field.default)}`;
}

function getColumnSql(field) {
  const parts = [`"${field.name}"`, getColumnType(field)];

  if (field.isId) {
    parts.push("PRIMARY KEY");
  } else if (field.isRequired) {
    parts.push("NOT NULL");
  }

  const defaultClause = getDefaultClause(field);
  if (defaultClause) {
    parts.push(defaultClause.trim());
  }

  return parts.join(" ");
}

function buildCreateTableSql(model) {
  const columns = model.fields
    .filter((field) => field.kind !== "object")
    .map(getColumnSql)
    .join(",\n  ");

  return `CREATE TABLE IF NOT EXISTS "${model.name}" (\n  ${columns}\n);`;
}

function buildUniqueIndexes(model) {
  const statements = [];
  const singleFieldUniques = model.fields.filter(
    (field) => field.kind !== "object" && field.isUnique && !field.isId
  );

  for (const field of singleFieldUniques) {
    statements.push(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_${model.name}_${field.name}_unique" ON "${model.name}" ("${field.name}");`
    );
  }

  for (const uniqueIndex of model.uniqueIndexes ?? []) {
    const indexName =
      uniqueIndex.name ??
      `idx_${model.name}_${uniqueIndex.fields.join("_")}_unique`;
    const columns = uniqueIndex.fields.map((field) => `"${field}"`).join(", ");

    statements.push(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${indexName}" ON "${model.name}" (${columns});`
    );
  }

  return statements;
}

const databaseUrl = readDatabaseUrl();
const databasePath = resolveDatabasePath(databaseUrl);
mkdirSync(dirname(databasePath), { recursive: true });

const db = new Database(databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");

try {
  db.exec("BEGIN");

  for (const model of Prisma.dmmf.datamodel.models) {
    db.exec(buildCreateTableSql(model));

    for (const statement of buildUniqueIndexes(model)) {
      db.exec(statement);
    }
  }

  db.exec("COMMIT");
  console.info(
    `[stockpilot] initialized SQLite demo schema (${Prisma.dmmf.datamodel.models.length} tables) at ${databasePath}`
  );
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
} finally {
  db.close();
}
