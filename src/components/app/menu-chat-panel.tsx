"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowRight, GitMerge, MessageCircle, Send, Sparkles, X } from "lucide-react";

import { menuChatAction } from "@/app/actions/recipe-chat";
import type { MenuChatAction } from "@/modules/recipes/chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Turn = {
  role: "user" | "assistant";
  content: string;
  actions?: MenuChatAction[];
};

const EXAMPLES = [
  "Find drinks I should merge",
  "Which drink makes me the most profit?",
  "Which recipes are missing supplier prices?",
];

export function MenuChatPanel() {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();

  function send(message: string) {
    const m = message.trim();
    if (!m || isPending) return;
    const next: Turn[] = [...history, { role: "user", content: m }];
    setHistory(next);
    setInput("");
    startTransition(async () => {
      const result = await menuChatAction({
        userMessage: m,
        history: history.map((t) => ({ role: t.role, content: t.content })),
      });
      if (!result.ok) {
        setHistory([
          ...next,
          { role: "assistant", content: `⚠ ${result.reason}` },
        ]);
        return;
      }
      setHistory([
        ...next,
        {
          role: "assistant",
          content: result.reply,
          actions: result.suggestedActions,
        },
      ]);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full bg-violet-500 px-4 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:-translate-y-0.5 hover:bg-violet-500/90 hover:shadow-xl"
      >
        <Sparkles className="size-4" />
        Ask StockBuddy
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex h-[32rem] w-[22rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-violet-500/30 bg-card shadow-2xl">
      <header className="flex items-center justify-between border-b border-border/60 bg-violet-500/[0.06] px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="size-4 text-violet-600 dark:text-violet-300" />
          <p className="text-sm font-semibold">StockBuddy · Menu</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {history.length === 0 ? (
          <>
            <p className="text-xs text-muted-foreground">
              Ask me about your menu, or just tell me what to fix.
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => send(e)}
                  disabled={isPending}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-left text-xs hover:bg-accent"
                >
                  {e}
                </button>
              ))}
            </div>
          </>
        ) : (
          history.map((t, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div
                className={
                  t.role === "user"
                    ? "ml-6 rounded-xl bg-violet-500 px-3 py-2 text-sm text-white"
                    : "mr-6 rounded-xl bg-muted px-3 py-2 text-sm"
                }
              >
                {t.content}
              </div>
              {t.actions && t.actions.length > 0 ? (
                <div className="mr-6 flex flex-wrap gap-1.5">
                  {t.actions.map((a, ai) => {
                    if (a.type === "open_recipe") {
                      return (
                        <Link
                          key={ai}
                          href={`/recipes/${a.recipeId}`}
                          className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-violet-700 shadow-sm hover:bg-violet-50 dark:bg-stone-800 dark:text-violet-300 dark:hover:bg-stone-700"
                        >
                          {a.label}
                          <ArrowRight className="size-3" />
                        </Link>
                      );
                    }
                    return (
                      <Link
                        key={ai}
                        href={`/recipes/consolidate?ids=${a.recipeIds.join(",")}`}
                        className="inline-flex items-center gap-1 rounded-full bg-violet-500 px-3 py-1 text-[11px] font-semibold text-white shadow-sm hover:bg-violet-500/90"
                      >
                        <GitMerge className="size-3" />
                        {a.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))
        )}
        {isPending ? (
          <div className="mr-6 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
            Thinking…
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex gap-2 border-t border-border/60 px-3 py-3"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your menu…"
          disabled={isPending}
          className="h-9 flex-1 rounded-xl text-sm"
        />
        <Button
          type="submit"
          disabled={isPending || !input.trim()}
          className="h-9 rounded-xl bg-violet-500 hover:bg-violet-500/90"
        >
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
