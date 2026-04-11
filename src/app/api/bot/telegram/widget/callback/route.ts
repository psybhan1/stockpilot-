import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import {
  connectManagerTelegramLoginChannel,
  verifyTelegramWidgetAuth,
} from "@/modules/operator-bot/connect";
import { sendManagerBotWelcomeMessages } from "@/modules/operator-bot/welcome";

function redirectToSettings(params: Record<string, string>) {
  const url = new URL("/settings", env.APP_URL);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const connectToken = requestUrl.searchParams.get("connectToken")?.trim();
  const authPayload = Object.fromEntries(requestUrl.searchParams.entries());

  if (!connectToken) {
    return redirectToSettings({
      chatConnect: "error",
      chatChannel: "telegram",
      chatDetail: "Telegram connect token is missing. Start again from Settings.",
    });
  }

  if (!verifyTelegramWidgetAuth(authPayload)) {
    return redirectToSettings({
      chatConnect: "error",
      chatChannel: "telegram",
      chatDetail: "Telegram login could not be verified. Try again from Settings.",
    });
  }

  const telegramUserId = authPayload.id?.trim();

  if (!telegramUserId) {
    return redirectToSettings({
      chatConnect: "error",
      chatChannel: "telegram",
      chatDetail: "Telegram login did not include a usable account id.",
    });
  }

  const senderDisplayName = [authPayload.first_name, authPayload.last_name]
    .filter((value) => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .trim();

  const connection = await connectManagerTelegramLoginChannel({
    token: connectToken,
    telegramUserId,
    telegramUsername: authPayload.username ?? null,
    senderDisplayName: senderDisplayName || authPayload.username || telegramUserId,
  });

  if (!connection.ok) {
    return redirectToSettings({
      chatConnect: "error",
      chatChannel: "telegram",
      chatDetail: connection.reply,
    });
  }

  const welcome = await sendManagerBotWelcomeMessages({
    userName: senderDisplayName || authPayload.username || "Manager",
    telegramChatId: telegramUserId,
  });

  return redirectToSettings({
    chatConnect: "connected",
    chatChannel: "telegram",
    chatDetail:
      welcome.telegram.status === "sent"
        ? "Telegram connected successfully and the bot sent a welcome message."
        : "Telegram connected successfully.",
  });
}

