import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const runtimeRoot = path.resolve(process.env.N8N_USER_FOLDER || "/data");
const workflowDir = path.resolve(root, "workflows");
const markerPath = path.join(runtimeRoot, ".stockpilot-bootstrap.json");
const n8nBin = path.join(
  root,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "n8n.cmd" : "n8n"
);

process.env.N8N_USER_FOLDER = runtimeRoot;
process.env.N8N_HOST = process.env.N8N_HOST || "0.0.0.0";
process.env.N8N_PORT = process.env.N8N_PORT || process.env.PORT || "5678";
process.env.GENERIC_TIMEZONE = process.env.GENERIC_TIMEZONE || "America/Toronto";

if (!process.env.N8N_EDITOR_BASE_URL && process.env.WEBHOOK_URL) {
  process.env.N8N_EDITOR_BASE_URL = process.env.WEBHOOK_URL.replace(/\/$/, "");
}

if (!process.env.N8N_ENCRYPTION_KEY?.trim()) {
  console.error("Missing N8N_ENCRYPTION_KEY for hosted n8n startup.");
  process.exit(1);
}

if (!fs.existsSync(n8nBin)) {
  console.error(`Could not find the n8n binary at ${n8nBin}.`);
  process.exit(1);
}

fs.mkdirSync(runtimeRoot, { recursive: true });

const workflowHash = hashWorkflowBundle();
const marker = readBootstrapMarker();

if (!marker || marker.workflowHash !== workflowHash) {
  console.log("Bootstrapping StockPilot workflows into hosted n8n...");
  runCommand(n8nBin, ["import:workflow", "--separate", "--input=./workflows"]);
  runCommand(process.execPath, ["scripts/bootstrap-workflows.mjs"]);
  fs.writeFileSync(
    markerPath,
    JSON.stringify(
      {
        workflowHash,
        bootstrappedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
}

const startResult = spawnSync(n8nBin, ["start"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

if (startResult.error) {
  console.error(startResult.error.message);
  process.exit(1);
}

process.exit(startResult.status ?? 0);

function hashWorkflowBundle() {
  const hash = crypto.createHash("sha256");
  const filenames = fs
    .readdirSync(workflowDir)
    .filter((filename) => filename.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));

  for (const filename of filenames) {
    hash.update(filename);
    hash.update(fs.readFileSync(path.join(workflowDir, filename)));
  }

  hash.update(fs.readFileSync(path.resolve(root, "scripts", "bootstrap-workflows.mjs")));

  return hash.digest("hex");
}

function readBootstrapMarker() {
  if (!fs.existsSync(markerPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(markerPath, "utf8"));
  } catch {
    return null;
  }
}

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error || result.status !== 0) {
    console.error(result.error?.message ?? `${command} ${args.join(" ")} failed.`);
    process.exit(result.status ?? 1);
  }
}
