import Link from "next/link";

import { PageHero } from "@/components/app/page-hero";
import { Role } from "@/lib/domain-enums";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { requireSession } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

/**
 * Integration activity log. Surfaces the most recent auditLog rows
 * that relate to integrations / channels / POS / email / purchase-
 * order dispatch so the admin can see, in one scroll, exactly
 * what's been firing. Silent misconfigurations (e.g., webhook
 * secret rotated but Zapier was never updated, so every subsequent
 * sale 401s but no audit row lands because we never accepted the
 * request) are visible as "no activity for 3 days" patterns.
 *
 * Filters down from the full auditLog table to integration-ish
 * prefixes — pos.*, integration.*, bot.*, recipe.ai_*,
 * connect*.*, inventoryItem.* so admins see both the plumbing
 * events and the downstream user-facing ones.
 */
const INTERESTING_PREFIXES = [
  "integration.",
  "pos.",
  "bot.",
  "recipe.ai_",
  "inventoryItem.",
  "purchaseOrder.",
  "channel.",
  "user.",
] as const;

export default async function IntegrationActivityPage() {
  const session = await requireSession(Role.MANAGER);

  const rows = await db.auditLog.findMany({
    where: {
      locationId: session.locationId,
      action: {
        startsWith: "integration.",
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Widen the net in a second query — Prisma doesn't support OR with
  // multiple startsWith gracefully, so we just pull a broader page
  // and filter in-process. 300 rows is a tiny table scan.
  const broad = await db.auditLog.findMany({
    where: { locationId: session.locationId },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const filtered = broad.filter((r) =>
    INTERESTING_PREFIXES.some((prefix) => r.action.startsWith(prefix))
  );

  const combined = [...rows, ...filtered]
    .filter(
      (row, idx, arr) => arr.findIndex((r) => r.id === row.id) === idx
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 120);

  return (
    <div className="space-y-8">
      <PageHero
        eyebrow="Settings · Activity"
        title={combined.length === 1 ? "1 event" : `${combined.length} events`}
        subtitle="integration log."
        description="Everything the integration plumbing did on your tenant — connects, tests, mapping saves, bot sends. 120 most-recent events. Silent-failure debugging lives here."
      />

      {combined.length === 0 ? (
        <section className="rounded-[28px] border border-dashed border-border/60 bg-card/50 p-8 text-center text-sm text-muted-foreground">
          No integration activity yet. Connect Square, pair Telegram, or
          bridge a POS via webhook, and events land here.
        </section>
      ) : (
        <section className="overflow-x-auto rounded-2xl border border-border/50 bg-card/60">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border/40 bg-muted/40 text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Event</th>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Details</th>
              </tr>
            </thead>
            <tbody>
              {combined.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border/20 align-top hover:bg-muted/20"
                >
                  <td className="px-4 py-2 font-mono text-[11px] text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className="px-4 py-2 font-mono text-[11px]">
                    {row.action}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {row.entityType}
                    {row.entityId ? (
                      <span className="ml-1 font-mono text-[10px]">
                        ({row.entityId.slice(0, 10)}…)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    {row.details ? (
                      <pre className="max-w-md overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 font-mono text-[10px] leading-4 text-muted-foreground">
                        {JSON.stringify(row.details, null, 0)}
                      </pre>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        —
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Link
        href="/settings"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        ← Back to Settings
      </Link>
    </div>
  );
}
