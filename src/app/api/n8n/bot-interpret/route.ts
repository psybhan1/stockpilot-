import { NextRequest, NextResponse } from "next/server";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";

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

    const text = String(req.text ?? "").trim();
    const channel = String(req.channel ?? "UNKNOWN").trim().toUpperCase();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inventoryChoices: Array<{ id: string; name: string; sku: string | null }> =
      Array.isArray(req.inventoryChoices)
        ? req.inventoryChoices
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .filter((c: any) => c && typeof c.id === "string" && typeof c.name === "string")
            .slice(0, 120)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((c: any) => ({
              id: String(c.id),
              name: String(c.name),
              sku: typeof c.sku === "string" ? c.sku : null,
            }))
        : [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conversationHistory: Array<{ role: string; text: string }> = Array.isArray(
      req.conversationHistory
    )
      ? req.conversationHistory
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((t: any) => t && typeof t.role === "string" && typeof t.text === "string")
          .slice(-10)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((t: any) => ({ role: String(t.role), text: String(t.text).slice(0, 500) }))
      : [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawPending: any =
      req.pendingContext &&
      typeof req.pendingContext === "object" &&
      !Array.isArray(req.pendingContext)
        ? req.pendingContext
        : null;

    const pendingContext = rawPending
      ? {
          intent: typeof rawPending.intent === "string" ? rawPending.intent : "UNKNOWN",
          inventoryItemId:
            typeof rawPending.inventoryItemId === "string" ? rawPending.inventoryItemId : null,
          inventoryItemName:
            typeof rawPending.inventoryItemName === "string" ? rawPending.inventoryItemName : null,
          reportedOnHand:
            typeof rawPending.reportedOnHand === "number" ? rawPending.reportedOnHand : null,
          clarificationQuestion:
            typeof rawPending.clarificationQuestion === "string"
              ? rawPending.clarificationQuestion
              : "",
        }
      : null;

    if (!text) {
      return NextResponse.json({ message: "Missing bot text." }, { status: 400 });
    }
    if (!inventoryChoices.length) {
      return NextResponse.json({ message: "Missing inventory choices." }, { status: 400 });
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return NextResponse.json({ message: "GROQ_API_KEY not configured" }, { status: 500 });
    }

    // Build prompt (ported from n8n workflow)
    const inventoryList = inventoryChoices
      .map((c) => `- ${c.id}: ${c.name}${c.sku ? ` (SKU: ${c.sku})` : ""}`)
      .join("\n");

    const system = [
      "You interpret manager chat messages for StockBuddy, an inventory operating system for cafes and small restaurants.",
      "Return JSON only and never wrap it in markdown.",
      "Use only the inventory ids from the provided inventory list.",
      "Supported intents are: RESTOCK_TO_PAR, STOCK_STATUS, GREETING, HELP, UNKNOWN, ADD_INVENTORY_ITEM, ADD_SUPPLIER, ADD_RECIPE, UPDATE_ITEM, UPDATE_STOCK_COUNT.",
      "RESTOCK_TO_PAR means the manager wants you to reorder or top up an item because it is low or running out.",
      "STOCK_STATUS means the manager is asking what is left, how much there is, or what is low overall.",
      "If the message includes phrases like order more, reorder, restock, top up, or we are running out, prefer RESTOCK_TO_PAR over STOCK_STATUS.",
      'Use GREETING for casual social messages like hi, hello, yo, sup, how are you, how r u, or thanks, unless the same message clearly asks about inventory.',
      "HELP is for what the bot can do or how to use it.",
      "ADD_INVENTORY_ITEM means the manager wants to add a new ingredient, product, or supply to inventory. Phrases: 'we now have X', 'add X to inventory', 'new item: X', 'starting to stock X'. Extract the item name into newItemName.",
      "ADD_SUPPLIER means adding a new supplier. Phrases: 'add supplier X', 'our new supplier is X', 'new vendor X'. Extract supplier name into supplierName.",
      "ADD_RECIPE means defining what ingredients go into a dish or drink. Phrases: 'X uses Y and Z', 'recipe for X', 'banana smoothie uses 2 bananas'. Extract the dish name into dishName.",
      "UPDATE_ITEM means changing a field on an existing inventory item. Phrases: 'change banana par to 50', 'update oat milk supplier', 'set par level for coffee to 100'. Extract the inventory item into inventoryItemId/inventoryItemName.",
      "UPDATE_STOCK_COUNT means the manager is correcting the current stock count. Phrases: 'we actually have 30 bananas', 'correct stock for oat milk to 5'. Extract inventoryItemId and reportedOnHand.",
      "UNKNOWN is for everything else.",
      "If a reorder request is missing the count or item, set needsClarification true and ask a short operational clarification question.",
      "If a stock question clearly names one item, include that inventoryItemId. If it is a general question, leave inventoryItemId null.",
      "Do not invent numbers. Only use a reportedOnHand value if the manager explicitly gave one.",
      "If a pending clarification context is provided, the manager is answering a previous question. Use it along with the current message to complete the interpretation — do not ask for clarification again if you can resolve it.",
      'If conversation history is provided, use it to understand follow-up messages. A short reply like "cherry" or "3" makes sense only in context of the previous exchange.',
    ].join(" ");

    const examples = [
      'Example 1: "Whole milk 2 left, order more." -> RESTOCK_TO_PAR for Whole Milk with reportedOnHand 2.',
      'Example 2: "How much oat milk do we have?" -> STOCK_STATUS for Oat Milk.',
      'Example 3: "What are we low on right now?" -> STOCK_STATUS with no specific inventoryItemId.',
      'Example 4: "hi" -> GREETING.',
      'Example 5: "we now have bananas" -> ADD_INVENTORY_ITEM with newItemName "bananas".',
      'Example 6: "add supplier FreshCo" -> ADD_SUPPLIER with supplierName "FreshCo".',
      'Example 7: "banana smoothie uses 2 bananas and 200ml oat milk" -> ADD_RECIPE with dishName "banana smoothie".',
      'Example 8: "change banana par to 50" -> UPDATE_ITEM for banana, inventoryItemName "banana".',
      'Example 9: "we actually have 30 bananas" -> UPDATE_STOCK_COUNT for banana with reportedOnHand 30.',
      'Example 10 (with history): Bot asked "Which tomatoes — cherry or roma?", manager replies "cherry" -> RESTOCK_TO_PAR for Cherry Tomatoes using the count from the pending context.',
    ].join("\n");

    let historySection = "";
    if (conversationHistory.length > 0) {
      const lines = conversationHistory
        .map((t) => `[${t.role === "manager" ? "Manager" : "StockBuddy"}]: ${t.text}`)
        .join("\n");
      historySection = `\nConversation history (oldest first):\n${lines}\n`;
    }

    let pendingSection = "";
    if (pendingContext) {
      pendingSection = `\nPending clarification: StockBuddy previously asked: "${pendingContext.clarificationQuestion}"`;
      if (pendingContext.inventoryItemName) {
        pendingSection += ` about item "${pendingContext.inventoryItemName}" (id: ${pendingContext.inventoryItemId})`;
      }
      if (pendingContext.reportedOnHand !== null && pendingContext.reportedOnHand !== undefined) {
        pendingSection += ` with reported count ${pendingContext.reportedOnHand}`;
      }
      pendingSection += ". The current manager message is likely answering that question.\n";
    }

    const user = `Channel: ${channel}${historySection}${pendingSection}\nCurrent manager message: ${text}\n\nAvailable inventory choices:\n${inventoryList}\n\nExamples:\n${examples}\n\nReturn JSON with exactly these keys:\nintent, inventoryItemId, inventoryItemName, reportedOnHand, needsClarification, clarificationQuestion, confidence, summary, newItemName, supplierName, dishName`;

    const messages = [
      { role: "system", content: system },
      { role: "user", content: `${user}\n\nReturn valid JSON only.` },
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
        temperature: 0.15,
        max_tokens: 400,
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

    const confidence = Number(parsed.confidence);

    return NextResponse.json({
      accepted: true,
      provider: "groq",
      interpretation: {
        intent: typeof parsed.intent === "string" ? parsed.intent.toUpperCase() : "UNKNOWN",
        inventoryItemId:
          typeof parsed.inventoryItemId === "string" ? parsed.inventoryItemId : null,
        inventoryItemName:
          typeof parsed.inventoryItemName === "string" ? parsed.inventoryItemName : null,
        reportedOnHand: Number.isFinite(Number(parsed.reportedOnHand))
          ? Math.max(0, Math.round(Number(parsed.reportedOnHand)))
          : null,
        needsClarification: parsed.needsClarification === true,
        clarificationQuestion:
          typeof parsed.clarificationQuestion === "string" ? parsed.clarificationQuestion : null,
        confidence: Number.isFinite(confidence)
          ? Math.min(0.99, Math.max(0.05, confidence))
          : 0.55,
        summary: typeof parsed.summary === "string" ? parsed.summary : null,
        newItemName: typeof parsed.newItemName === "string" && parsed.newItemName.trim() ? parsed.newItemName.trim() : null,
        supplierName: typeof parsed.supplierName === "string" && parsed.supplierName.trim() ? parsed.supplierName.trim() : null,
        dishName: typeof parsed.dishName === "string" && parsed.dishName.trim() ? parsed.dishName.trim() : null,
        rawLlmText: rawText,
      },
    });
  } catch (error) {
    console.error("[bot-interpret] error:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Internal error" },
      { status: 500 }
    );
  }
}
