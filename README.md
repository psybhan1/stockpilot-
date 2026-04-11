# StockPilot

StockPilot is a production-minded MVP for AI-assisted inventory operations in physical businesses, starting with cafes, bakeries, and small restaurants.

The app is built around a deterministic stock movement ledger, approved recipe/BOM mappings, Square-first catalog and sales sync, explainable reorder recommendations, and approval-first supplier workflows.

## Stack

- Next.js 16 App Router
- TypeScript
- PostgreSQL-first runtime with URL-based configuration
- SQLite fallback for the zero-setup local demo profile
- Prisma 6
- Tailwind CSS v4
- shadcn/ui
- Vitest
- Playwright

## Core MVP flows

- Built-in auth with seeded manager, supervisor, and staff accounts
- Square integration foundation with fake Square demo mode, token-backed real Square mode, OAuth callback handling, webhook signature verification, and webhook-triggered sync job ingestion
- Inventory ledger with receiving, POS depletion, and manual count adjustment support
- Recipe approval flow for menu-variant-to-inventory depletion mapping
- Forecast snapshots with days-left and projected stockout timing
- Reorder recommendations with MOQ and pack-size rounding plus approve, defer, reject, and quantity override review
- Email PO flow, queued manager email notifications, website-ordering agent task foundation, and PO lifecycle controls for sent, acknowledged, delivered, and cancelled states
- Website-order prep can stay fully inside StockPilot or optionally dispatch to an n8n-compatible webhook while keeping final supplier checkout approval-first
- Receiving workflow that posts auditable `RECEIVING` ledger movements when purchase orders are delivered
- Missing-count, high-usage, and sync-failure alerting with a dedicated notifications workspace
- Multi-channel notification queue with email plus optional native Expo push and Twilio WhatsApp delivery, with n8n/webhook fallback for external orchestration
- Manager bot ordering via Twilio WhatsApp or Telegram webhook: a manager can text the bot a count like `Whole milk 2 left, order more`, StockPilot records the count, fills back to par, and dispatches the order using the supplier's configured ordering mode
- Swipe/card count mode with confirm, edit quantity, low, out, waste, and skip actions
- In-app assistant panel with mock-by-default AI, optional OpenAI-backed responses, and quick manager actions for alerts, reorder approvals, and reviewable tasks

## Local setup

### Windows fastest path

1. Run `Install-StockPilot.cmd`.
2. When setup finishes, run `Launch-StockPilot.cmd`.
3. The launcher starts both the Next.js dev server and a watch-mode background worker, opens the browser, and keeps auto-refresh on in the app shell.

### Manual local setup

1. Install dependencies:

```bash
npm install
```

2. Prepare local env files and reset the demo database path:

```bash
npm run setup:local -- --seed
```

3. Bootstrap the database schema:

```bash
npm run db:push
```

4. Seed the demo cafe:

```bash
npm run db:seed
```

5. Start the app:

```bash
npm run launch
```

6. Optional: run the lightweight job worker in a second terminal if you did not use the launcher:

```bash
npm run worker
```

For a single worker pass instead of watch mode:

```bash
npm run worker:once
```

### PostgreSQL URL setup

If you want the app to run against a real hosted or local PostgreSQL database, set `DATABASE_URL` in `.env.local` to a normal Postgres connection string before running setup:

```bash
DATABASE_URL="postgresql://user:password@host:5432/stockpilot?schema=public"
```

After that, the same commands work:

```bash
npm run db:generate
npm run db:push
npm run db:seed
npm run launch
```

If `DATABASE_URL` points at PostgreSQL, StockPilot now uses the Postgres Prisma client automatically. If you leave it unset, `npm run setup:local` will keep the zero-setup SQLite demo path.

### Optional real-provider configuration

If you want to use a real Square sandbox or production account instead of fake mode, set:

```bash
DEFAULT_POS_PROVIDER="square"
SQUARE_ENVIRONMENT="sandbox"
SQUARE_CLIENT_ID="..."
SQUARE_CLIENT_SECRET="..."
```

You can also bypass OAuth for backend-only testing by setting:

```bash
SQUARE_ACCESS_TOKEN="..."
SQUARE_LOCATION_ID="..."
```

If you want real outbound email delivery instead of console logging, set:

```bash
DEFAULT_EMAIL_PROVIDER="resend"
RESEND_API_KEY="..."
RESEND_FROM_EMAIL="StockPilot <onboarding@resend.dev>"
```

If you want live Expo push tests from the Notifications workspace, set an Expo token only if your Expo project uses enhanced push security. You can also prefill the Notifications screen with a real test device token:

```bash
EXPO_ACCESS_TOKEN="optional-for-enhanced-security-projects"
EXPO_TEST_PUSH_TOKEN="ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
```

If you want live Twilio WhatsApp delivery, set:

```bash
TWILIO_ACCOUNT_SID="..."
TWILIO_AUTH_TOKEN="..."
TWILIO_WHATSAPP_FROM="whatsapp:+14155238886"
TWILIO_TEST_WHATSAPP_TO="+14155550123"
```

If you want the manager ordering bot over WhatsApp or Telegram, also set:

```bash
TELEGRAM_BOT_TOKEN=""
TELEGRAM_LOGIN_CLIENT_ID=""
TELEGRAM_LOGIN_CLIENT_SECRET=""
TELEGRAM_WEBHOOK_SECRET=""
TELEGRAM_BOT_API_BASE_URL="https://api.telegram.org"
```

Then link the manager identity in `Settings`:

- `Connect WhatsApp` and `Connect Telegram` are the primary production flow
- WhatsApp opens a prefilled `connect ...` message
- Telegram can use true web-based one-tap connect when `TELEGRAM_LOGIN_CLIENT_ID` and `TELEGRAM_LOGIN_CLIENT_SECRET` are configured
- Otherwise Telegram falls back to the secure bot start-link flow
- StockPilot links the chat automatically after the manager sends the message or taps `Start`
- `Advanced fallback` manual fields still exist, but they are not the normal customer flow

Bot webhooks:

- WhatsApp: `${APP_URL}/api/bot/whatsapp`
- Telegram: `${APP_URL}/api/bot/telegram`

Example manager command:

```text
Whole milk 2 left, order more.
```

What happens:

1. StockPilot matches the manager from the linked WhatsApp number or Telegram chat id.
2. It records the reported count as an auditable stock correction.
3. It computes the shortage against `parLevelBase`.
4. It rounds to supplier pack size and MOQ.
5. It creates a purchase order and dispatches it by supplier mode:
   - `EMAIL`: sends the supplier email immediately
   - `WEBSITE`: queues the website-order prep workflow
   - `MANUAL`: creates a manual supplier draft inside StockPilot

Important:

- Live WhatsApp and Telegram bot connections require a public HTTPS `APP_URL`; `localhost` is only for developer testing.
- Telegram one-tap web login also requires linking your public domain to the bot in `@BotFather` via `/setdomain`.
- The Settings page still exposes a clearly labeled local relay path for engineering, but it is not the primary product path.
- Twilio's WhatsApp quickstart uses the sandbox as the sender before full sender registration, so the manager may need to join the sandbox first if you are still in Twilio sandbox mode.

If you want website-order prep tasks plus push/WhatsApp-style notification delivery to dispatch into an external automation tool such as n8n, set:

```bash
DEFAULT_AUTOMATION_PROVIDER="n8n"
N8N_AUTOMATION_WEBHOOK_URL="http://127.0.0.1:5678/webhook/stockpilot-website-order-prep"
N8N_NOTIFICATION_WEBHOOK_URL="http://127.0.0.1:5678/webhook/stockpilot-notification-dispatch"
N8N_WEBHOOK_SECRET="optional-shared-secret"
```

`N8N_WEBHOOK_URL` is still supported as a legacy fallback, but dedicated notification and automation URLs are preferred so each StockPilot handoff hits the right workflow.

If you want the Telegram and WhatsApp manager bot to use the smarter n8n language path, also set:

```bash
N8N_BASE_URL="http://127.0.0.1:5678"
N8N_BOT_INTERPRET_WEBHOOK_URL="http://127.0.0.1:5678/webhook/stockpilot-bot-interpret"
N8N_BOT_REPLY_WEBHOOK_URL="http://127.0.0.1:5678/webhook/stockpilot-bot-reply"
N8N_WEBHOOK_SECRET="same-value-as-n8n-STOCKPILOT_WEBHOOK_SECRET"
```

`N8N_BASE_URL` is the simplest production setting. When it is present, StockPilot derives the dedicated notification, website-order, bot-interpret, and bot-reply webhook URLs automatically. You can still override any individual webhook URL if you need a split deployment.

The bundled local n8n workspace under `n8n/` now contains real workflows that validate the inbound StockPilot payload, interpret manager messages and rewrite replies with a hosted or local LLM, build the callback payload, and then respond to the original webhook.

For a free hosted bot model path, add these variables in the main app `.env.local`:

```bash
BOT_LLM_PROVIDER="cloudflare"
CLOUDFLARE_BOT_ACCOUNT_ID="..."
CLOUDFLARE_BOT_API_TOKEN="..."
CLOUDFLARE_BOT_MODEL="@cf/meta/llama-3.1-8b-instruct-fast"
```

When those are present, StockPilot passes the hosted bot model config into n8n and the bot-language workflows use Cloudflare Workers AI over the web instead of your local machine.

If you leave those empty, the bot-language workflow falls back to local Ollama:

```bash
BOT_LLM_PROVIDER="ollama"
BOT_LLM_BASE_URL="http://127.0.0.1:11434"
BOT_LLM_MODEL="qwen2.5:3b"
```

That means the bot can run in two real modes:

- Cloudflare Workers AI for a free hosted web LLM
- Ollama as the local fallback when cloud credentials are not configured

If those are not configured, StockPilot keeps website-order prep inside the app and no n8n instance is required.

### Always-on hosted bot and automation

If you want the Telegram and WhatsApp bot to stay up without your PC running, you need both:

1. a hosted StockPilot app
2. a hosted n8n instance

This repo now includes a Render-ready production path:

- [render.yaml](/C:/Users/sobha/Desktop/codex/stockpilot/render.yaml) defines:
  - `stockpilot-app` as a hosted Next.js service
  - `stockpilot-n8n` as a hosted Dockerized n8n service with a persistent disk
- [n8n/Dockerfile](/C:/Users/sobha/Desktop/codex/stockpilot/n8n/Dockerfile) builds the automation service
- [n8n/scripts/hosted-start.mjs](/C:/Users/sobha/Desktop/codex/stockpilot/n8n/scripts/hosted-start.mjs) auto-imports and bootstraps the StockPilot workflows on first boot and whenever the workflow bundle changes

Hosted rollout shape:

1. Deploy the Render blueprint from [render.yaml](/C:/Users/sobha/Desktop/codex/stockpilot/render.yaml).
2. Set the required app secrets:
   - `DATABASE_URL`
   - `APP_URL`
   - Telegram and/or Twilio credentials
   - Cloudflare Workers AI credentials if you want the hosted LLM path
3. Set the required n8n secrets:
   - `WEBHOOK_URL`
   - `N8N_EDITOR_BASE_URL`
   - `N8N_BASIC_AUTH_USER`
   - `N8N_BASIC_AUTH_PASSWORD`
4. Run `npm run db:push` and `npm run db:seed` once on the hosted app service.
5. Point Telegram and Twilio to the hosted StockPilot webhook URLs, not localhost.

This is the real always-on path. A hosted n8n instance alone is not enough, because the Telegram and WhatsApp webhooks still terminate at the StockPilot app.

If you want the assistant and drafting layer to use OpenAI instead of the mock provider, set:

```bash
DEFAULT_AI_PROVIDER="openai"
OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-5-mini"
```

### Manual reset

If you want a fresh demo database, delete `prisma/dev.db` and then run:

```bash
npm run setup:local -- --seed
npm run db:push
npm run db:seed
```

## Demo users

- Manager: `manager@stockpilot.dev` / `demo1234`
- Supervisor: `supervisor@stockpilot.dev` / `demo1234`
- Staff: `staff@stockpilot.dev` / `demo1234`

## Demo scenario included in seed data

- Seeded cafe inventory including beans, milk, oat milk, syrups, cups, lids, sleeves, matcha, chocolate sauce, pastry boxes, and cleaning supplies
- Seeded Square catalog for espresso, americano, cappuccino, medium latte, large iced vanilla latte, matcha latte, and mocha
- Approved recipes for most drinks and one draft mocha recipe that still needs manager approval
- Existing low-stock and imminent stockout alerts
- Existing reorder-approval alert plus a linked email notification record
- Pending reorder recommendations for oat milk and hot cups
- One supplier using email ordering and one using website-ordering prep
- One in-progress swipe count session for staff

## Recommended demo walkthrough

1. Sign in as the manager.
2. Open `Settings` and run `Connect / refresh Square`.
3. Run `Sync sample sale`.
4. Review `Dashboard` and `Alerts` to see forecast pressure.
5. Open `Recipes` and approve the draft mocha recipe.
6. Open `Purchase Orders` and approve, defer, or reject a recommendation.
7. Open a purchase order detail page and move it through sent, acknowledged, or delivered states. Delivered receipts automatically post inventory back into the ledger.
8. Open `Stock Count` or `Swipe count mode` and submit a count, waste log, or skip.
9. Review `Alerts`, `Notifications`, `Agent Tasks`, and `Settings` audit/job history.
10. Open `Notifications` and queue test email, push, or WhatsApp-compatible deliveries through the worker.
11. Open `Settings`, confirm the manager bot identity, then send `Whole milk 2 left, order more.` to the WhatsApp or Telegram webhook-connected bot.

## Scripts

- `npm run dev` starts the Next.js app
- `npm run worker` watches and processes queued jobs continuously in normal mode
- `npm run worker:dev` restarts the worker automatically when background-job code changes
- `npm run worker:once` processes one worker cycle and exits
- `npm run db:push` chooses PostgreSQL or SQLite automatically based on `DATABASE_URL`
- `npm run db:seed` loads the demo scenario
- `npm run setup:local` syncs `.env` / `.env.local` and prepares the local database path
- `npm run typecheck` runs TypeScript checks
- `npm run lint` runs ESLint
- `npm run test` runs Vitest with coverage
- `npm run test:e2e` runs Playwright
- `Launch-StockPilot-With-n8n.cmd` starts the main app plus the dedicated local n8n workspace together

## Architecture notes

- `src/modules` contains domain logic for auth, inventory, forecasting, purchasing, recipes, jobs, and data queries.
- `src/providers` contains provider/adaptor boundaries for POS, AI, email, notification channels, and supplier automation.
- `StockMovement` is the source of truth for inventory changes. `InventorySnapshot` is a cached read model for forecasts.
- `PosVariationMapping` decouples Square variation identities from internal menu items and recipes, and sale-line modifiers are now stored explicitly for modifier-aware depletion rules.
- `JobRun` is the common queue model for sync, forecast refresh, alerts, reorders, and automation preparation, with PostgreSQL `SKIP LOCKED` claiming when a Postgres `DATABASE_URL` is configured.
- `Notification` rows are queued for manager delivery and processed by the worker through the configured notification provider, with provider message IDs and metadata stored for traceability.

## Current limitations

- The app now supports a real PostgreSQL URL, but this machine still does not have a live Postgres instance or hosted connection string configured for end-to-end verification.
- SQLite is still kept as a local demo fallback because this Windows environment does not have Docker or PostgreSQL installed.
- On this Windows environment, Prisma's normal schema-push engine was not reliable for SQLite, so the local installer still bootstraps the SQLite demo schema directly from the Prisma data model.
- Local demo mode still defaults to the fake Square provider so setup stays credential-free.
- The assistant defaults to a mock AI provider, but an optional OpenAI-backed provider is available when credentials are configured.
- Website-ordering automation creates reviewable agent tasks with a Playwright-ready browser script template, but it still does not auto-submit supplier websites in v1.
- Multi-location support is modeled in the schema but intentionally limited to one active location in the product surface.
- The app shell refreshes automatically on an interval so new worker results appear without manual reload, but it is still polling rather than using websockets or real-time subscriptions.
- Real Square and Resend paths are implemented as optional providers, but they were not exercised end-to-end in this environment because no live credentials were available.
