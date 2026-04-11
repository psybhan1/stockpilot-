import { spawnSync } from "node:child_process";

import { isPostgresUrl, readDatabaseUrl } from "./database-url.mjs";

const root = process.cwd();
const databaseUrl = readDatabaseUrl(root);

if (isPostgresUrl(databaseUrl)) {
  const result =
    process.platform === "win32"
      ? spawnSync(
          "cmd.exe",
          ["/d", "/s", "/c", "npx prisma db push --schema prisma/schema.prisma"],
          {
            cwd: root,
            stdio: "inherit",
            env: process.env,
          }
        )
      : spawnSync(
          "npx",
          ["prisma", "db", "push", "--schema", "prisma/schema.prisma"],
          {
            cwd: root,
            stdio: "inherit",
            env: process.env,
          }
        );

  if (result.error) {
    console.error(result.error);
  }

  process.exit(result.status ?? 1);
}

const sqliteResult = spawnSync(
  process.execPath,
  ["scripts/bootstrap-sqlite.mjs"],
  {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  }
);

process.exit(sqliteResult.status ?? 1);
