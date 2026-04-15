#!/usr/bin/env node
/**
 * One-shot n8n workflow importer.
 *
 * Usage:
 *   export N8N_URL=https://n8n-production-cc71.up.railway.app
 *   export N8N_API_KEY=<paste from n8n → Settings → n8n API → Create API Key>
 *   node n8n-workflows/import.mjs
 *
 * Imports every *.json in this directory (except package.json / import.*)
 * as a new workflow if a workflow with the same name doesn't exist yet.
 * If one does, it updates the existing workflow's nodes + connections.
 * Leaves credentials + active state alone so you can wire those in the
 * n8n UI after import.
 */

import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));

const N8N_URL = process.env.N8N_URL?.replace(/\/$/, "");
const N8N_API_KEY = process.env.N8N_API_KEY;

if (!N8N_URL || !N8N_API_KEY) {
  console.error("Missing N8N_URL or N8N_API_KEY env.");
  console.error("");
  console.error("  1. Open your n8n UI (e.g. https://n8n-production-cc71.up.railway.app)");
  console.error("  2. Go to Settings → n8n API → Create API Key → copy it");
  console.error("  3. Run:");
  console.error("     export N8N_URL=https://<your-n8n>");
  console.error("     export N8N_API_KEY=<paste>");
  console.error("     node n8n-workflows/import.mjs");
  process.exit(1);
}

const headers = {
  "X-N8N-API-KEY": N8N_API_KEY,
  "Content-Type": "application/json",
  Accept: "application/json",
};

async function listWorkflows() {
  const res = await fetch(`${N8N_URL}/api/v1/workflows?limit=250`, { headers });
  if (!res.ok) {
    throw new Error(`n8n API listWorkflows failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.data ?? [];
}

async function createWorkflow(payload) {
  const res = await fetch(`${N8N_URL}/api/v1/workflows`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`create failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function updateWorkflow(id, payload) {
  const res = await fetch(`${N8N_URL}/api/v1/workflows/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`update ${id} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

function sanitizeWorkflow(raw) {
  // n8n's PUT / POST accepts the shape it exports: name, nodes,
  // connections, settings, staticData. Strip out fields that are
  // only valid on the wire from the REST GET.
  const {
    name,
    nodes,
    connections,
    settings = {},
    staticData = null,
  } = raw;
  if (!name || !Array.isArray(nodes)) {
    throw new Error("Workflow file is missing name or nodes.");
  }
  return { name, nodes, connections: connections ?? {}, settings, staticData };
}

async function main() {
  const files = (await fs.readdir(here))
    .filter((f) => f.endsWith(".json") && !f.startsWith("package"))
    .sort();

  if (files.length === 0) {
    console.log("No workflow JSONs found in", here);
    return;
  }

  console.log(`Importing ${files.length} workflow file(s) into ${N8N_URL}…`);

  const existing = await listWorkflows();
  const byName = new Map(existing.map((w) => [w.name, w]));

  for (const file of files) {
    const full = path.join(here, file);
    const raw = JSON.parse(await fs.readFile(full, "utf8"));
    const sanitized = sanitizeWorkflow(raw);
    const match = byName.get(sanitized.name);

    try {
      if (match) {
        await updateWorkflow(match.id, sanitized);
        console.log(`  ✓ updated  ${sanitized.name}`);
      } else {
        await createWorkflow(sanitized);
        console.log(`  ✓ created  ${sanitized.name}`);
      }
    } catch (err) {
      console.error(`  ✗ ${file}: ${err.message ?? err}`);
    }
  }

  console.log("\nDone. Open n8n → Workflows to review + activate them.");
  console.log("Reminder: n8n also needs N8N_WEBHOOK_SECRET set to the same value");
  console.log("as StockPilot so the webhook nodes accept our calls.");
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
