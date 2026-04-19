"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Send, Check, X, MessageCircle } from "lucide-react";

import {
  commitDraftedRecipeAction,
  createInventoryItemForDraftAction,
  draftRecipeAction,
  editDraftChatAction,
} from "@/app/actions/ai-recipe";
import type {
  ChatTurn,
  DraftComponent,
  DraftState,
} from "@/modules/recipes/ai-draft";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

/**
 * AI recipe draft + chat editor. Client-only because the draft lives
 * in React state during the edit loop and only gets persisted on
 * commit — no half-baked Recipe rows.
 */
export function RecipeDraftChat({
  mappingId,
  menuItemName,
  variationName,
}: {
  mappingId: string;
  menuItemName: string;
  variationName: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [committedRecipeId, setCommittedRecipeId] = useState<string | null>(
    null
  );
  const [isPending, startTransition] = useTransition();

  // ── Auto-save + restore draft (Build #2) ──────────────────────────
  // Stores the current draft + chat history under a per-mapping key
  // so a tab close / refresh doesn't nuke in-flight work. Lives purely
  // in the browser — zero server cost, no half-baked rows in the DB.
  // Cleared on approve, or when the user hits Redraft (empty draft).
  const storageKey = `stockpilot:recipe-draft:${mappingId}`;

  // Restore once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        draft: DraftState | null;
        history: ChatTurn[];
      };
      if (parsed.draft) setDraft(parsed.draft);
      if (Array.isArray(parsed.history)) setHistory(parsed.history);
    } catch {
      // Corrupt storage — ignore and start fresh.
    }
    // We intentionally run only on initial mount — once we've decided
    // to restore (or not), subsequent changes come from server actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save on every draft/history change.
  useEffect(() => {
    try {
      if (!draft) {
        window.localStorage.removeItem(storageKey);
        return;
      }
      window.localStorage.setItem(
        storageKey,
        JSON.stringify({ draft, history })
      );
    } catch {
      // Quota exceeded / private mode — silently fall through.
    }
  }, [storageKey, draft, history]);

  const handleDraft = useCallback(() => {
    setErrorMessage(null);
    startTransition(async () => {
      const result = await draftRecipeAction(mappingId);
      if (!result.ok) {
        setErrorMessage(result.reason);
        return;
      }
      setDraft(result.draft);
      setHistory([
        {
          role: "assistant",
          content: result.draft.components.length
            ? `Drafted a recipe with ${result.draft.components.length} component(s). Tell me what to tweak — swap an ingredient, change a quantity, add packaging…`
            : "Your inventory catalogue looks empty or no match was found. Add items in Stock first, then I can draft.",
        },
      ]);
    });
  }, [mappingId]);

  const handleSendChat = useCallback(() => {
    const msg = chatInput.trim();
    if (!msg || !draft) return;
    setErrorMessage(null);
    setChatInput("");

    const nextHistory: ChatTurn[] = [
      ...history,
      { role: "user", content: msg },
    ];
    setHistory(nextHistory);

    startTransition(async () => {
      const result = await editDraftChatAction({
        mappingId,
        draft,
        userMessage: msg,
        history: nextHistory,
      });
      if (!result.ok) {
        setErrorMessage(result.reason);
        setHistory([
          ...nextHistory,
          { role: "assistant", content: "That failed — try again?" },
        ]);
        return;
      }
      setDraft(result.draft);
      setHistory([
        ...nextHistory,
        { role: "assistant", content: result.reply },
      ]);
    });
  }, [chatInput, draft, history, mappingId]);

  const handleCommit = useCallback(() => {
    if (!draft) return;
    setErrorMessage(null);
    startTransition(async () => {
      const result = await commitDraftedRecipeAction({ mappingId, draft });
      if (!result.ok) {
        setErrorMessage(result.reason);
        return;
      }
      setCommittedRecipeId(result.recipeId);
      try {
        window.localStorage.removeItem(storageKey);
      } catch {
        // ignore — storage may be unavailable
      }
      router.refresh();
    });
  }, [draft, mappingId, router, storageKey]);

  const handleRemoveComponent = useCallback(
    (idx: number) => {
      if (!draft) return;
      setDraft({
        ...draft,
        components: draft.components.filter((_, i) => i !== idx),
      });
    },
    [draft]
  );

  const handleUpdateComponent = useCallback(
    (idx: number, patch: Partial<DraftComponent>) => {
      if (!draft) return;
      setDraft({
        ...draft,
        components: draft.components.map((c, i) =>
          i === idx ? { ...c, ...patch } : c
        ),
      });
    },
    [draft]
  );

  const handleCreateProposedItem = useCallback(
    (proposalKey: string) => {
      if (!draft) return;
      setErrorMessage(null);
      startTransition(async () => {
        const result = await createInventoryItemForDraftAction({
          mappingId,
          draft,
          proposalKey,
        });
        if (!result.ok) {
          setErrorMessage(result.reason);
          return;
        }
        setDraft(result.draft);
        setHistory((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Created ${result.createdItemName} in your inventory and added it to the recipe.`,
          },
        ]);
      });
    },
    [draft, mappingId]
  );

  // ── Post-commit success view ─────────────────────────────────────
  if (committedRecipeId) {
    return (
      <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 text-center">
        <Check className="mx-auto size-8 text-emerald-500" />
        <p className="mt-3 text-lg font-semibold">Recipe approved & live</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The next {variationName} sale on the POS will auto-deplete
          inventory.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/pos-mapping/${mappingId}`)}
          >
            Back to mapping
          </Button>
          <Button type="button" onClick={() => router.push("/dashboard")}>
            Dashboard
          </Button>
        </div>
      </div>
    );
  }

  // ── Empty state: no draft yet ───────────────────────────────────
  if (!draft) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-8 text-center">
        <Sparkles className="mx-auto size-8 text-amber-500" />
        <p className="mt-3 text-lg font-semibold">
          Ready to draft {variationName}
        </p>
        <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
          StockBuddy will look at your inventory catalogue and pick the
          most likely components. Takes 2-5 seconds.
        </p>
        <Button
          type="button"
          onClick={handleDraft}
          disabled={isPending}
          className="mt-5 gap-2"
        >
          <Sparkles className="size-4" />
          {isPending ? "Drafting…" : "Draft with AI"}
        </Button>
        {errorMessage ? (
          <p className="mt-3 text-xs text-red-500">{errorMessage}</p>
        ) : null}
      </div>
    );
  }

  // ── Draft + chat layout ─────────────────────────────────────────
  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      {/* Left: draft card (editable) */}
      <section className="notif-card p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Drafted recipe · {variationName}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {draft.summary}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleDraft}
            disabled={isPending}
          >
            Redraft
          </Button>
        </div>

        {draft.components.length === 0 ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            No components yet. Tell the bot what this drink is made of, or
            redraft.
          </p>
        ) : (
          <ul className="space-y-2">
            {draft.components.map((c, idx) => (
              <li
                key={`${c.inventoryItemId}-${idx}`}
                className="flex items-center gap-3 rounded-xl border border-border/50 bg-background/40 px-3 py-2"
              >
                <ConfidenceDot score={c.confidenceScore} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {c.inventoryItemName}
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {c.componentType}
                      {c.optional ? " · optional" : ""}
                      {c.conditionServiceMode
                        ? ` · ${c.conditionServiceMode}`
                        : ""}
                    </span>
                    {c.modifierKey ? (
                      <span
                        className="ml-2 inline-flex items-center rounded-full bg-violet-500/15 px-2 py-[1px] font-mono text-[10px] font-semibold text-violet-700 dark:text-violet-300"
                        title="Only depletes when this POS modifier is selected"
                      >
                        if {c.modifierKey}
                      </span>
                    ) : null}
                  </p>
                  {c.notes ? (
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {c.notes}
                    </p>
                  ) : null}
                </div>
                <input
                  type="number"
                  min="1"
                  value={c.quantityBase}
                  onChange={(e) =>
                    handleUpdateComponent(idx, {
                      quantityBase: Math.max(1, Number(e.target.value) || 1),
                    })
                  }
                  className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-right text-sm"
                />
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground min-w-[3rem]">
                  {c.displayUnit}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveComponent(idx)}
                  className="text-muted-foreground hover:text-red-500"
                  aria-label="Remove"
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Proposed new items — StockBuddy wants to create these
            inventory items to satisfy the last chat instruction.
            One click = row in InventoryItem + component added to
            the current draft. */}
        {draft.proposedNewItems.length > 0 ? (
          <div className="space-y-2 rounded-xl border border-dashed border-violet-500/50 bg-violet-500/5 p-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">
              StockBuddy wants to create {draft.proposedNewItems.length} new
              inventory item{draft.proposedNewItems.length === 1 ? "" : "s"}
            </p>
            {draft.proposedNewItems.map((p) => (
              <div
                key={p.proposalKey}
                className="flex items-start justify-between gap-3 rounded-lg border border-violet-500/30 bg-background/40 p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {p.name}
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {p.category} · {p.baseUnit}
                    </span>
                    {p.modifierKey ? (
                      <span className="ml-2 inline-flex items-center rounded-full bg-violet-500/15 px-2 py-[1px] font-mono text-[10px] font-semibold text-violet-700 dark:text-violet-300">
                        if {p.modifierKey}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {p.reason} · recipe uses {p.quantityBase} {p.displayUnit.toLowerCase()}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => handleCreateProposedItem(p.proposalKey)}
                  disabled={isPending}
                  className="h-7 gap-1 bg-violet-500 text-white hover:bg-violet-500/90 text-[11px]"
                >
                  <Plus className="size-3" />
                  Create
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3">
          <p className="text-[11px] text-muted-foreground">
            {draft.components.length} component
            {draft.components.length === 1 ? "" : "s"} · avg confidence{" "}
            {Math.round(
              (draft.components.reduce(
                (acc, c) => acc + c.confidenceScore,
                0
              ) /
                Math.max(1, draft.components.length)) *
                100
            )}
            %
          </p>
          <Button
            type="button"
            onClick={handleCommit}
            disabled={isPending || draft.components.length === 0}
            className="gap-2 bg-emerald-500 text-white hover:bg-emerald-500/90"
          >
            <Check className="size-4" />
            {isPending ? "Saving…" : "Approve & activate"}
          </Button>
        </div>
      </section>

      {/* Right: chat sidebar */}
      <section className="notif-card p-5 sm:p-6 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-amber-500" />
          <p className="text-sm font-semibold">Tweak with StockBuddy</p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto max-h-[400px] pr-1">
          {history.map((turn, i) => (
            <div
              key={i}
              className={
                turn.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-foreground text-background px-3 py-2 text-sm"
                  : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-border/60 bg-background/60 px-3 py-2 text-sm"
              }
            >
              {turn.content}
            </div>
          ))}
          {isPending ? (
            <div className="mr-auto max-w-[85%] rounded-2xl rounded-bl-sm border border-border/60 bg-background/60 px-3 py-2 text-sm text-muted-foreground italic">
              thinking…
            </div>
          ) : null}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendChat();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="use oat milk by default…"
            disabled={isPending}
            className="h-10 flex-1 rounded-xl border border-input bg-transparent px-3 text-sm outline-none focus:border-foreground/40"
          />
          <Button
            type="submit"
            size="icon-sm"
            disabled={isPending || !chatInput.trim()}
          >
            <Send className="size-4" />
          </Button>
        </form>
        <p className="text-[10px] text-muted-foreground">
          Try: &ldquo;use oat milk as default&rdquo; · &ldquo;bump coffee
          to 20g&rdquo; · &ldquo;when iced, swap hot cup for cold cup and
          add ice&rdquo; · &ldquo;if oat milk is selected, use oat
          instead of whole&rdquo; · &ldquo;extra shot adds 18g
          espresso&rdquo;
        </p>
      </section>

      {errorMessage ? (
        <p className="col-span-full text-xs text-red-500">{errorMessage}</p>
      ) : null}
    </div>
  );
}

function ConfidenceDot({ score }: { score: number }) {
  const color =
    score >= 0.8
      ? "bg-emerald-500"
      : score >= 0.6
        ? "bg-amber-500"
        : "bg-red-500";
  return (
    <span
      className={`inline-block size-2.5 shrink-0 rounded-full ${color}`}
      title={`${Math.round(score * 100)}% confidence`}
    />
  );
}
