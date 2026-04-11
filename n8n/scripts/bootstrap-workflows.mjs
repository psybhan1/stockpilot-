import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";

const workflowSpecs = [
  {
    id: "stockpilot-notification-dispatch",
    filename: "stockpilot-notification-dispatch.json",
    webhookNodeName: "Notification Webhook",
    webhookId: "stockpilot-notification-dispatch",
    webhookPath: "stockpilot-notification-dispatch",
    method: "POST",
  },
  {
    id: "stockpilot-website-order-prep",
    filename: "stockpilot-website-order-prep.json",
    webhookNodeName: "Website Order Webhook",
    webhookId: "stockpilot-website-order-prep",
    webhookPath: "stockpilot-website-order-prep",
    method: "POST",
  },
  {
    id: "stockpilot-bot-interpret",
    filename: "stockpilot-bot-interpret.json",
    webhookNodeName: "Bot Interpret Webhook",
    webhookId: "stockpilot-bot-interpret",
    webhookPath: "stockpilot-bot-interpret",
    method: "POST",
  },
  {
    id: "stockpilot-bot-reply",
    filename: "stockpilot-bot-reply.json",
    webhookNodeName: "Bot Reply Webhook",
    webhookId: "stockpilot-bot-reply",
    webhookPath: "stockpilot-bot-reply",
    method: "POST",
  },
];

function resolveDbPath() {
  const userFolder = process.env.N8N_USER_FOLDER
    ? path.resolve(process.env.N8N_USER_FOLDER)
    : path.resolve(process.cwd(), "runtime");
  const candidates = [
    path.join(userFolder, ".n8n", "database.sqlite"),
    path.join(userFolder, "database.sqlite"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find the n8n runtime database. Checked: ${candidates.join(", ")}`
  );
}

function readWorkflowDefinition(spec) {
  const workflowPath = path.resolve(process.cwd(), "workflows", spec.filename);
  const workflow = JSON.parse(fs.readFileSync(workflowPath, "utf8"));
  workflow.active = true;
  workflow.nodes = workflow.nodes.map((node) =>
    node.name === spec.webhookNodeName
      ? { ...node, webhookId: spec.webhookId }
      : node
  );
  return workflow;
}

function openDatabase(dbPath) {
  return new sqlite3.Database(dbPath);
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve(this);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows);
    });
  });
}

async function bootstrap() {
  const dbPath = resolveDbPath();
  const db = openDatabase(dbPath);

  try {
    const existing = await all(
      db,
      `SELECT id FROM workflow_entity WHERE id IN (${workflowSpecs
        .map(() => "?")
        .join(", ")})`,
      workflowSpecs.map((spec) => spec.id)
    );
    const existingIds = new Set(existing.map((row) => row.id));
    const missing = workflowSpecs.filter((spec) => !existingIds.has(spec.id));

    if (missing.length > 0) {
      throw new Error(
        `Missing imported workflows: ${missing.map((spec) => spec.id).join(", ")}. Run the import script first.`
      );
    }

    for (const spec of workflowSpecs) {
      const workflow = readWorkflowDefinition(spec);
      const versionId = crypto.randomUUID();
      const pathLength =
        workflow.nodes
          .find((node) => node.name === spec.webhookNodeName)
          ?.parameters?.path?.split("/")
          .filter(Boolean).length ?? 1;

      await run(
        db,
        `UPDATE workflow_entity
         SET name = ?,
             active = 1,
             nodes = ?,
             connections = ?,
             settings = ?,
             staticData = ?,
             pinData = ?,
             meta = ?,
             versionId = ?,
             activeVersionId = ?,
             description = ?,
             updatedAt = STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW')
         WHERE id = ?`,
        [
          workflow.name,
          JSON.stringify(workflow.nodes),
          JSON.stringify(workflow.connections ?? {}),
          JSON.stringify(workflow.settings ?? {}),
          workflow.staticData ? JSON.stringify(workflow.staticData) : null,
          workflow.pinData ? JSON.stringify(workflow.pinData) : null,
          workflow.meta ? JSON.stringify(workflow.meta) : null,
          versionId,
          versionId,
          workflow.description ?? null,
          spec.id,
        ]
      );

      await run(db, "DELETE FROM workflow_published_version WHERE workflowId = ?", [
        spec.id,
      ]);
      await run(
        db,
        `INSERT INTO workflow_published_version
          (workflowId, publishedVersionId, createdAt, updatedAt)
         VALUES (?, ?, STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'), STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'))`,
        [spec.id, versionId]
      );

      await run(db, "DELETE FROM workflow_history WHERE workflowId = ?", [spec.id]);
      await run(
        db,
        `INSERT INTO workflow_history
          (versionId, workflowId, authors, createdAt, updatedAt, nodes, connections, name, autosaved, description)
         VALUES (?, ?, ?, STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'), STRFTIME('%Y-%m-%d %H:%M:%f', 'NOW'), ?, ?, ?, false, ?)`,
        [
          versionId,
          spec.id,
          "stockpilot-bootstrap",
          JSON.stringify(workflow.nodes),
          JSON.stringify(workflow.connections ?? {}),
          workflow.name,
          workflow.description ?? null,
        ]
      );

      await run(db, "DELETE FROM webhook_entity WHERE workflowId = ?", [spec.id]);
      await run(
        db,
        `INSERT INTO webhook_entity
          (workflowId, webhookPath, method, node, webhookId, pathLength)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          spec.id,
          spec.webhookPath,
          spec.method,
          spec.webhookNodeName,
          spec.webhookId,
          pathLength,
        ]
      );
    }

    console.log(`Bootstrapped ${workflowSpecs.length} StockPilot workflow(s) in ${dbPath}`);
  } finally {
    db.close();
  }
}

bootstrap().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
