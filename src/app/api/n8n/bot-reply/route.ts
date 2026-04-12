import { NextRequest, NextResponse } from "next/server";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";

// Scenarios where Groq should generate a fresh, intelligent reply
// rather than just polishing a scripted fallback
const CONVERSATIONAL_SCENARIOS = new Set(["greeting", "help", "unknown", "default"]);

export async function POST(request: NextRequest) {
  try {
    // Validate webhook secret
    const secret = process.env.N8N_WEBHOOK_SECRET;
    if (secret) {
      const incoming = request.headers.get("X-StockPilot-Webhook-Secret");
      if (incoming !== secret) {
        return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
      }
    }

    const body = await request.json();
    const req = body.request ?? body;

    const fallbackReply = String(req.fallbackReply ?? "").trim();
    const channel = String(req.channel ?? "UNKNOWN").trim().toUpperCase();
    const scenario = String(req.scenario ?? "default").trim().toLowerCase();
    const managerText = String(req.managerText ?? "").trim();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conversationHistory: Array<{ role: string; text: string }> = Array.isArray(
      req.conversationHistory
    )
      ? req.conversationHistory
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((t: any) => t && typeof t.role === "string" && typeof t.text === "string")
          .slice(-8)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((t: any) => ({ role: String(t.role), text: String(t.text).slice(0, 500) }))
      : [];

    if (!fallbackReply) {
      return NextResponse.json({ message: "Missing fallbackReply." }, { status: 400 });
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return NextResponse.json({ message: "GROQ_API_KEY not configured" }, { status: 500 });
    }

    let historySection = "";
    if (conversationHistory.length > 0) {
      const lines = conversationHistory
        .map((t) => `[${t.role === "manager" ? "Manager" : "StockBuddy"}]: ${t.text}`)
        .join("\n");
      historySection = `\nConversation history:\n${lines}\n`;
    }

    let system: string;
    let user: string;

    if (CONVERSATIONAL_SCENARIOS.has(scenario)) {
      // For greetings, unknown, and general chat: generate a real intelligent reply
      system = [
        "You are StockBuddy, a smart and friendly AI inventory assistant for cafe and restaurant managers.",
        "You help managers track stock levels, create restock orders, and manage inventory.",
        "For greetings: respond warmly and naturally, introduce yourself briefly.",
        "For general questions (math, general knowledge, chitchat): answer the question directly and naturally, then offer to help with inventory if relevant.",
        "If asked your name: say you are StockBuddy, an AI inventory assistant.",
        "If asked something completely unrelated to inventory: answer it helpfully, keep it brief.",
        "Never be robotic or use generic filler phrases like 'I am here to help with stock'.",
        "Be natural, smart, and conversational — like a helpful colleague on WhatsApp.",
        "Keep replies concise (under 80 words).",
        "CRITICAL: NEVER claim to have added items, updated stock, placed orders, added suppliers, or performed ANY database action. You are only replying to a greeting or general message — you have NOT done anything to the inventory.",
        "Return JSON with one field: reply.",
      ].join(" ");

      user = `Channel: ${channel}${historySection}\nManager message: ${managerText || "(no message)"}\n\nReturn valid JSON only.`;
    } else {
      // For operational scenarios (restock, stock-check, clarification):
      // enhance the fallback which contains the correct facts
      const factsJson = JSON.stringify(req.facts ?? {}, null, 2);

      system = [
        "You are StockBuddy, a trustworthy inventory bot for cafe managers.",
        "Rewrite the fallback reply to sound natural and confident in WhatsApp or Telegram.",
        "CRITICAL: Keep ALL numbers, quantities, item names, supplier names, and operational facts exactly as given — do not change or invent any.",
        "Do not add actions or promises that did not happen.",
        "Be direct, concise, and human. No filler phrases.",
        "Return JSON with one field: reply.",
      ].join(" ");

      user = `Channel: ${channel}\nScenario: ${scenario}\nManager message: ${managerText || "(none)"}${historySection}\nFacts:\n${factsJson}\n\nFallback reply to enhance:\n${fallbackReply}\n\nReturn valid JSON only.`;
    }

    const messages = [
      { role: "system", content: system },
      { role: "user", content: user },
    ];

    // Call Groq
    const llmResponse = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        temperature: CONVERSATIONAL_SCENARIOS.has(scenario) ? 0.7 : 0.2,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(90000),
    });

    const llmData = (await llmResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const rawText = llmData?.choices?.[0]?.message?.content?.trim() ?? "";

    if (!rawText) {
      throw new Error("LLM returned no content");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(`LLM returned invalid JSON: ${rawText}`);
    }

    const reply =
      typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim() : null;

    if (!reply) {
      throw new Error("LLM reply payload did not include a usable reply string.");
    }

    return NextResponse.json({
      accepted: true,
      provider: "groq",
      reply,
      metadata: { rawLlmText: rawText },
    });
  } catch (error) {
    console.error("[bot-reply] error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
