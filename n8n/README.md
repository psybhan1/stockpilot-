# StockPilot n8n

This folder contains the dedicated n8n workspace for StockPilot.

It is intentionally separate from the main Next.js app so the app and automation runtime can evolve independently without mixing concerns.

## What lives here

- Importable n8n workflows for StockPilot automation handoff
- A dedicated local n8n package/runtime pinned to an embedded Node 22 Windows build
- Windows-friendly startup and import scripts

## Included workflows

- `stockpilot-notification-dispatch.json`
  Receives StockPilot notification webhooks, validates the payload, posts the delivery result back into StockPilot through the callback API, and then responds to the original webhook.

- `stockpilot-website-order-prep.json`
  Receives website-order preparation tasks from StockPilot, prepares structured review output, posts the result back into StockPilot through the callback API, and then responds to the original webhook.

- `stockpilot-bot-interpret.json`
  Receives inbound Telegram or WhatsApp manager text from StockPilot, runs an LLM interpretation pass in n8n against Cloudflare Workers AI or local Ollama, and returns structured intent plus clarification prompts.

- `stockpilot-bot-reply.json`
  Receives a structured bot-reply scenario from StockPilot, runs an LLM drafting pass in n8n against Cloudflare Workers AI or local Ollama, and returns a cleaner chat reply without changing the operational facts.

Each workflow now uses a real n8n node chain:

- Notification: `Notification Webhook` -> `Validate Notification Request` -> `Build Notification Callback` -> `Post Notification Callback` -> `Respond Success`
- Website ordering: `Website Order Webhook` -> `Validate Website Order Task` -> `Build Website Review Output` -> `Post Automation Callback` -> `Respond Success`
- Bot interpret: `Bot Interpret Webhook` -> `Validate Bot Interpret Request` -> `Prepare Interpretation Prompt (LLM)` -> `Interpret Manager Message (LLM)` -> `Normalize Interpretation` -> `Respond Success`
- Bot reply: `Bot Reply Webhook` -> `Validate Bot Reply Request` -> `Prepare Reply Prompt (LLM)` -> `Draft Bot Reply (LLM)` -> `Normalize Reply` -> `Respond Success`

## Local setup

1. Run `Import-StockPilot-n8n.cmd`.
2. Run `Start-StockPilot-n8n.cmd`.

The local n8n editor will be available at `http://127.0.0.1:5678`.

### What the scripts do

- install the dedicated n8n workspace dependencies with the embedded Node 22 runtime
- create a local runtime under `n8n/runtime`
- import the bundled StockPilot workflows
- publish and activate them for production webhook use
- register the production webhook paths StockPilot calls

You can still use the CLI manually if you prefer:

```bash
tools/node-v22.22.2-win-x64/npm.cmd install
tools/node-v22.22.2-win-x64/npm.cmd run import:workflows
tools/node-v22.22.2-win-x64/npm.cmd run bootstrap:workflows
tools/node-v22.22.2-win-x64/npm.cmd run start
```

The bootstrap step is important. It makes sure the imported workflows have stable production webhook IDs and are registered in the local runtime, so StockPilot can call the clean `/webhook/...` URLs directly.

## How StockPilot uses this

StockPilot does not require n8n to run.

If you set the following in the main app's `.env.local`, StockPilot will start handing work off here:

```bash
DEFAULT_AUTOMATION_PROVIDER="n8n"
N8N_AUTOMATION_WEBHOOK_URL="http://127.0.0.1:5678/webhook/stockpilot-website-order-prep"
N8N_NOTIFICATION_WEBHOOK_URL="http://127.0.0.1:5678/webhook/stockpilot-notification-dispatch"
N8N_BOT_INTERPRET_WEBHOOK_URL="http://127.0.0.1:5678/webhook/stockpilot-bot-interpret"
N8N_BOT_REPLY_WEBHOOK_URL="http://127.0.0.1:5678/webhook/stockpilot-bot-reply"
N8N_WEBHOOK_SECRET="change-me"
```

The workflows are intentionally separate, so StockPilot's notifications, website-order prep, and chat-language traffic do not get mixed together.

For the bot-language workflows, the preferred hosted setup uses Cloudflare Workers AI through the main StockPilot app config:

```bash
BOT_LLM_PROVIDER="cloudflare"
CLOUDFLARE_BOT_ACCOUNT_ID="..."
CLOUDFLARE_BOT_API_TOKEN="..."
CLOUDFLARE_BOT_MODEL="@cf/meta/llama-3.1-8b-instruct-fast"
```

StockPilot sends that provider config to the bot workflows in each webhook call, so the n8n workspace can stay stateless and does not need to own the Cloudflare secret itself.

If those are empty, the workflows fall back to local Ollama on this machine:

```bash
BOT_LLM_BASE_URL="http://127.0.0.1:11434"
BOT_LLM_MODEL="qwen2.5:3b"
```

That gives StockPilot a real web LLM path for production-style bot traffic without forcing every user to share one local machine.

## Hosted deployment

This n8n workspace is now packaged for a real always-on hosted deployment:

- [Dockerfile](/C:/Users/sobha/Desktop/codex/stockpilot/n8n/Dockerfile)
- [scripts/hosted-start.mjs](/C:/Users/sobha/Desktop/codex/stockpilot/n8n/scripts/hosted-start.mjs)

The hosted startup flow does three things automatically:

1. boots n8n with a persistent `N8N_USER_FOLDER`
2. imports the StockPilot workflow bundle on first boot
3. re-runs the bootstrap when the bundled workflow JSON changes

Recommended hosted env:

```bash
N8N_USER_FOLDER="/data"
N8N_HOST="0.0.0.0"
N8N_PORT="5678"
N8N_PROTOCOL="https"
WEBHOOK_URL="https://your-n8n-host.example.com"
N8N_EDITOR_BASE_URL="https://your-n8n-host.example.com"
N8N_ENCRYPTION_KEY="long-random-secret"
N8N_BASIC_AUTH_ACTIVE="true"
N8N_BASIC_AUTH_USER="..."
N8N_BASIC_AUTH_PASSWORD="..."
STOCKPILOT_WEBHOOK_SECRET="same-value-as-app-N8N_WEBHOOK_SECRET"
```

The repo root also includes a Render blueprint at [render.yaml](/C:/Users/sobha/Desktop/codex/stockpilot/render.yaml) that wires a hosted StockPilot app service together with a hosted StockPilot n8n service.

Important:

- Hosted n8n solves the automation uptime problem.
- It does not by itself make the Telegram or WhatsApp bot always available.
- The StockPilot app also needs to be hosted on a public URL, because the bot webhooks terminate at the app.

`STOCKPILOT_WEBHOOK_SECRET` protects the inbound StockPilot -> n8n webhooks for the bot-language workflows. Set the same value in the main app as `N8N_WEBHOOK_SECRET`.

## Validation and import

According to the n8n docs, workflows are stored as JSON and can be imported either in the UI or with:

```bash
n8n import:workflow --separate --input=./workflows
```

Source:
- [n8n npm install docs](https://docs.n8n.io/hosting/installation/npm/)
- [n8n import/export workflow docs](https://docs.n8n.io/workflows/export-import/)
- [n8n CLI import docs](https://docs.n8n.io/hosting/cli-commands/)
- [n8n metadata docs](https://docs.n8n.io/code/builtin/n8n-metadata/)
