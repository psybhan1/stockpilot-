# StockPilot × n8n Automation

StockPilot keeps the decision-making in-app (the operator bot, the
approval buttons in Telegram, the ledger of stock moves) and pushes
the **timing + fan-out + retry** concerns out to n8n. This directory
holds the workflow blueprints that wire the two together.

---

## What each workflow does

| File | Purpose | Trigger |
|------|---------|---------|
| `01-order-approval.json` | When a PO is drafted, ping the manager on Telegram with Approve / Cancel buttons. Wait up to 24h. Dispatch or cancel accordingly. | Webhook `/webhook/order-approval` |
| `02-daily-stock-report.json` | Every morning, pull low-stock items from StockPilot and send a summary to the manager's Telegram/WhatsApp. | Cron (daily, 08:00 local) |
| `03-supplier-email.json` | When a PO is approved, compose + send a supplier email with line items, then ping the manager that it went out. | Webhook `/webhook/order-approval` (continuation) |
| `04-pos-sale-depletion.json` | When Square fires a sale webhook, call StockPilot to deduct the sold quantities from stock. | Webhook `/webhook/pos-sale` |

Plus the system workflows (already referenced by the app at `N8N_*_WEBHOOK_URL`):

| File | Purpose |
|------|---------|
| `../n8n/workflows/stockpilot-bot-interpret.json` | LLM intent + entity extraction for the bot (fallback path) |
| `../n8n/workflows/stockpilot-bot-reply.json` | Polishes bot replies with a second-pass LLM |
| `../n8n/workflows/stockpilot-notification-dispatch.json` | Dispatches alerts to email / push / Telegram / WhatsApp |
| `../n8n/workflows/stockpilot-website-order-prep.json` | Drafts a website-order task (headless browser) for suppliers with no email |

---

## Setup

### 1. Deploy n8n somewhere StockPilot can reach

The recommended shape is a small Railway service using the official
`n8nio/n8n` image. You don't need to pay for n8n Cloud.

Minimum env on the n8n service:

```
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=<strong-password>
N8N_HOST=0.0.0.0
N8N_PORT=5678
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://<your-n8n>.up.railway.app
WEBHOOK_URL=https://<your-n8n>.up.railway.app
N8N_ENCRYPTION_KEY=<random-32-char>
DB_TYPE=sqlite
GENERIC_TIMEZONE=Europe/London
```

### 2. Add the shared secret on both sides

Generate a random 32+ char secret. Add it to **both** the n8n container
and the StockPilot app:

```
# StockPilot
N8N_WEBHOOK_SECRET=<random-secret>

# n8n
N8N_WEBHOOK_SECRET=<same-random-secret>
```

### 3. Import the workflows

From the n8n UI: **Workflows → Import from File** — upload each JSON
in this directory. Save & activate.

Alternatively use the CLI helper at `import.js` (requires n8n API
key + env vars set):

```
node n8n-workflows/import.js
```

### 4. Tell StockPilot the n8n URLs

Add to StockPilot's env:

```
N8N_BASE_URL=https://<your-n8n>.up.railway.app
# The specific webhook URLs below are derived from N8N_BASE_URL if you
# use the default workflow paths — override individually if you renamed
# any of them.
N8N_ORDER_APPROVAL_WEBHOOK_URL=$N8N_BASE_URL/webhook/order-approval
N8N_POS_SALE_WEBHOOK_URL=$N8N_BASE_URL/webhook/pos-sale
N8N_NOTIFICATION_WEBHOOK_URL=$N8N_BASE_URL/webhook/stockpilot-notification-dispatch
N8N_AUTOMATION_WEBHOOK_URL=$N8N_BASE_URL/webhook/stockpilot-website-order-prep
```

---

## Authentication model

Requests **from n8n → StockPilot** carry one of two headers, both
derived from `N8N_WEBHOOK_SECRET`:

### Simple (existing routes)

```
x-stockpilot-webhook-secret: <N8N_WEBHOOK_SECRET>
```

### HMAC-signed (preferred for new routes)

```
x-stockpilot-signature: <hex-hmac-sha256(body, N8N_WEBHOOK_SECRET)>
```

The HMAC form proves both knowledge of the secret **and** that the
body wasn't modified in transit. The shared module at
`src/modules/automation/n8n-auth.ts` accepts both.

Requests **from StockPilot → n8n** are authenticated by n8n's own
webhook token (n8n adds `N8N_WEBHOOK_SECRET` as an HTTP header on
each call; the Webhook node in the workflow checks it).

---

## Endpoints that n8n calls (StockPilot side)

| Route | Purpose | Body |
|-------|---------|------|
| `GET  /api/n8n/low-stock-report` | Returns items below par for the active location, formatted for a Telegram digest | — |
| `GET  /api/n8n/purchase-order/:id` | Returns a PO with lines + supplier for email composition | — |
| `POST /api/n8n/send-approved-order` | Tells StockPilot to dispatch an approved PO (email the supplier etc.) | `{ purchaseOrderId }` |
| `POST /api/n8n/record-sale` | Tells StockPilot to deduct stock for a POS sale event | `{ saleEventId }` |
| `POST /api/n8n/bot-interpret` | LLM intent + entity extraction (used by the fallback language provider) | `{ channel, text, inventoryChoices }` |
| `POST /api/n8n/bot-reply` | Polishes a bot reply with a second-pass LLM | `{ managerText, scenario, fallbackReply, facts }` |
| `POST /api/automation/n8n/callback` | Reports back to StockPilot when a website-order automation task completes | `{ taskId, status, output }` |
| `POST /api/notifications/n8n/callback` | Reports back to StockPilot when a notification has been delivered | `{ notificationId, status }` |

All routes enforce `N8N_WEBHOOK_SECRET` when it's set.

---

## End-to-end flow: a reorder through n8n

```
User (Telegram):      "oat milk 2 left, order more"
                               │
                               ▼
StockPilot bot agent: creates PO (AWAITING_APPROVAL), posts summary
                      to Telegram with [✖ Cancel order] inline button.
                               │
                               ▼
StockPilot → n8n:     POST /webhook/order-approval { poId, locationId }
                               │
                               ▼
n8n workflow 01:      Pings manager: "Approve order #PO-2026-0412?"
                      with [✅ Approve] [✖ Cancel] buttons.
                      Waits up to 24h for the manager.
                               │
          ┌────────────────────┴────────────────────┐
          ▼                                         ▼
  user taps ✅                              timeout / ✖
          │                                         │
          ▼                                         ▼
  POST /api/n8n/send-                       POST /api/n8n/cancel-po
  approved-order { poId }                   { poId, reason }
          │                                         │
          ▼                                         ▼
  Workflow 03 composes                      PO → CANCELLED
  + sends email to supplier
          │
          ▼
  Workflow pings manager
  "✉ Sent to FreshCo"
```

---

## Health-checking the integration

From StockPilot: **Settings → Integrations → n8n → Ping** — this
POSTs a harmless ping to each configured webhook URL and reports
the response. Do this right after changing any env.

From n8n: **Executions** panel — shows every workflow run, with
the inbound + outbound payloads and any retries.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| n8n rejects the incoming call with `401` | Secret mismatch | Confirm `N8N_WEBHOOK_SECRET` is identical on both sides, no trailing whitespace. |
| StockPilot logs `HMAC signature mismatch` | n8n sending a different body than what was signed (e.g. re-serialised JSON) | Use the simple `x-stockpilot-webhook-secret` header from n8n, not HMAC. |
| No Telegram message after approval | `N8N_ORDER_APPROVAL_WEBHOOK_URL` is wrong, or the Telegram credentials in n8n are not linked to the right chat | Ping the URL manually with curl; check n8n execution log. |
| Bot responds via Telegram but n8n doesn't fire | The bot agent path succeeded locally and never hit n8n (by design — n8n is only for async / fan-out). | Check the app's audit log — `bot.outbound_replied` shows the path taken. |

---

Questions welcome. Most of the tricky bits are about keeping the
secret identical in three places (StockPilot env, n8n env, n8n's
Webhook node). When in doubt, rotate it.
