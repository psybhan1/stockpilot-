import { env } from "@/lib/env";
import { runPendingJobs } from "@/modules/jobs/dispatcher";
import { pollInboundBotChannels } from "@/modules/operator-bot/polling";

const ONCE_FLAG = "--once";
function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function runOnce(batchSize: number) {
  const processed = await runPendingJobs(batchSize);
  await pollInboundBotChannels();
  console.info(`[stockpilot-worker] processed ${processed} queued jobs`);
  return processed;
}

async function main() {
  const batchSize = parseNumber(process.env.WORKER_BATCH_SIZE, env.WORKER_BATCH_SIZE);
  const pollMs = parseNumber(process.env.WORKER_POLL_MS, env.WORKER_POLL_MS);
  const once = process.argv.includes(ONCE_FLAG);

  if (once) {
    await runOnce(batchSize);
    return;
  }

  let keepRunning = true;
  const stopWorker = () => {
    keepRunning = false;
  };

  process.on("SIGINT", stopWorker);
  process.on("SIGTERM", stopWorker);

  console.info(
    `[stockpilot-worker] watching queue every ${pollMs}ms with batch size ${batchSize}`
  );

  while (keepRunning) {
    try {
      await runOnce(batchSize);
    } catch (error) {
      console.error("[stockpilot-worker] cycle failed", error);
    }

    if (!keepRunning) {
      break;
    }

    await sleep(pollMs);
  }

  console.info("[stockpilot-worker] stopped");
}

main().catch((error) => {
  console.error("[stockpilot-worker] failed", error);
  process.exitCode = 1;
});
