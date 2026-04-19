"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Send, Sparkles } from "lucide-react";

import { recipeChatAction } from "@/app/actions/recipe-chat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Turn = { role: "user" | "assistant"; content: string };

const EXAMPLES = [
  "Make it 2× bigger",
  "Swap oat milk for almond",
  "Remove the vanilla",
  "Add 10g chocolate powder",
];

export function RecipeChatPanel({ recipeId }: { recipeId: string }) {
  const router = useRouter();
  const [history, setHistory] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();

  function send(message: string) {
    const m = message.trim();
    if (!m || isPending) return;
    const nextHistory: Turn[] = [...history, { role: "user", content: m }];
    setHistory(nextHistory);
    setInput("");
    startTransition(async () => {
      const result = await recipeChatAction({
        recipeId,
        userMessage: m,
        history,
      });
      if (!result.ok) {
        setHistory([
          ...nextHistory,
          { role: "assistant", content: `⚠ ${result.reason}` },
        ]);
        return;
      }
      setHistory([
        ...nextHistory,
        {
          role: "assistant",
          content:
            result.appliedCount > 0
              ? `${result.reply} (${result.appliedCount} change${result.appliedCount === 1 ? "" : "s"})`
              : result.reply,
        },
      ]);
      if (result.appliedCount > 0) router.refresh();
    });
  }

  return (
    <section className="rounded-2xl border border-violet-500/30 bg-violet-500/[0.04] p-5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-violet-600 dark:text-violet-300" />
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
          Ask StockBuddy to edit this recipe
        </p>
      </div>

      {history.length === 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => send(e)}
              disabled={isPending}
              className="rounded-full border border-violet-500/40 bg-white/40 px-3 py-1 text-[11px] text-violet-700 hover:bg-white dark:bg-stone-900/40 dark:text-violet-300 dark:hover:bg-stone-900/80"
            >
              {e}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-3 space-y-2 max-h-64 overflow-y-auto">
          {history.map((t, i) => (
            <div
              key={i}
              className={
                t.role === "user"
                  ? "ml-8 rounded-xl bg-violet-500 px-3 py-2 text-sm text-white"
                  : "mr-8 rounded-xl bg-white px-3 py-2 text-sm shadow-sm dark:bg-stone-800"
              }
            >
              {t.content}
            </div>
          ))}
          {isPending ? (
            <div className="mr-8 rounded-xl bg-white px-3 py-2 text-sm text-muted-foreground shadow-sm dark:bg-stone-800">
              Thinking…
            </div>
          ) : null}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex gap-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. add 20 ml vanilla syrup"
          disabled={isPending}
          className="h-10 flex-1 rounded-xl"
        />
        <Button
          type="submit"
          disabled={isPending || !input.trim()}
          className="h-10 rounded-xl bg-violet-500 hover:bg-violet-500/90"
        >
          <Send className="size-4" />
        </Button>
      </form>
    </section>
  );
}
