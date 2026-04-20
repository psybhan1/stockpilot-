/**
 * A static, styled faux-Telegram chat that shows up in the hero.
 * Demonstrates the real product flow: manager types a restock
 * message, bot drafts a PO, supplier is out of stock, bot offers
 * one-tap rescue, manager taps, confirmed.
 */

export function TelegramPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="pointer-events-none absolute -inset-8 -z-10 rounded-[40px] bg-[radial-gradient(ellipse_at_center,rgba(120,113,108,0.12),transparent_70%)]" />
      <div className="overflow-hidden rounded-[32px] border border-border/60 bg-card shadow-2xl shadow-stone-900/10">
        {/* phone-like header */}
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
            SP
          </div>
          <div>
            <div className="text-sm font-semibold">StockPilot</div>
            <div className="text-[11px] text-muted-foreground">bot · online</div>
          </div>
          <div className="ml-auto text-muted-foreground">
            <svg
              viewBox="0 0 24 24"
              width={18}
              height={18}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        {/* messages */}
        <div className="space-y-3 bg-[#eef0dc] px-3 py-4">
          <Bubble side="right">Only 2 bags of ground coffee left, order 5</Bubble>

          <Bubble side="left">
            <div className="font-medium">📋 Drafted PO-2026-0412</div>
            <div className="mt-1 text-[13px]">
              5 bags of Ground Coffee from FreshCo. Tap Approve to send.
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniBtn tone="accent">✅ Approve &amp; send</MiniBtn>
              <MiniBtn>✖ Cancel</MiniBtn>
            </div>
          </Bubble>

          <Bubble side="right">approve</Bubble>

          <Bubble side="left">
            <div className="font-medium text-emerald-700">✅ PO-2026-0412 sent to FreshCo from your Gmail.</div>
          </Bubble>

          <Bubble side="left">
            <div className="font-medium text-red-700">⚠️ FreshCo out of stock on PO-2026-0412.</div>
            <div className="mt-1 text-[13px]">
              Backup supplier available: <b>BeanCo</b>. Tap to auto-reorder the same items — no more thinking needed.
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MiniBtn tone="accent">↻ Reorder from BeanCo</MiniBtn>
              <MiniBtn>✖ Skip</MiniBtn>
            </div>
          </Bubble>

          <Bubble side="left">
            <div className="font-medium text-emerald-700">✅ Rescue order PO-2026-0413 sent to BeanCo.</div>
            <div className="mt-1 text-[13px]">
              You&apos;ll get a ping when they respond — same pipeline as any other order.
            </div>
          </Bubble>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  children,
  side,
}: {
  children: React.ReactNode;
  side: "left" | "right";
}) {
  const common = "max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-snug shadow-sm";
  if (side === "right") {
    return (
      <div className="flex justify-end">
        <div className={`${common} bg-[#d8f2b2] text-stone-900`}>{children}</div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className={`${common} bg-white text-stone-900`}>{children}</div>
    </div>
  );
}

function MiniBtn({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "accent";
}) {
  const cls =
    tone === "accent"
      ? "rounded-lg bg-stone-900 px-3 py-1.5 text-[12px] font-semibold text-white"
      : "rounded-lg bg-white px-3 py-1.5 text-[12px] font-semibold text-stone-700 border border-stone-200";
  return <div className={`${cls} text-center`}>{children}</div>;
}
