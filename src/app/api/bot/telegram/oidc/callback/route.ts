import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { connectManagerTelegramLoginChannel } from "@/modules/operator-bot/connect";
import {
  exchangeTelegramOidcCode,
  getTelegramOidcCookieName,
  readTelegramOidcSession,
  verifyTelegramOidcIdToken,
} from "@/modules/operator-bot/telegram-oidc";
import { sendManagerBotWelcomeMessages } from "@/modules/operator-bot/welcome";

function buildSettingsRedirect(input: {
  status: "connected" | "error";
  channel: "telegram";
  detail: string;
}) {
  const url = new URL("/settings", env.APP_URL);
  url.searchParams.set("chatChannel", input.channel);
  url.searchParams.set("chatDetail", input.detail);
  url.searchParams.set("chatConnect", input.status);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error = requestUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(getTelegramOidcCookieName())?.value;

  cookieStore.delete(getTelegramOidcCookieName());

  if (error) {
    return buildSettingsRedirect({
      status: "error",
      channel: "telegram",
      detail: "Telegram login was cancelled or denied.",
    });
  }

  const oidcSession = readTelegramOidcSession(sessionCookie);

  if (!code || !state || !oidcSession || oidcSession.state !== state) {
    return buildSettingsRedirect({
      status: "error",
      channel: "telegram",
      detail: "Telegram connect session could not be verified. Try again from Settings.",
    });
  }

  try {
    const tokens = await exchangeTelegramOidcCode({
      code,
      codeVerifier: oidcSession.codeVerifier,
    });
    const telegramUser = await verifyTelegramOidcIdToken(tokens.idToken);
    const connection = await connectManagerTelegramLoginChannel({
      token: state,
      telegramUserId: telegramUser.id,
      telegramUsername: telegramUser.username,
      senderDisplayName: telegramUser.name,
    });

    if (!connection.ok) {
      return buildSettingsRedirect({
        status: "error",
        channel: "telegram",
        detail: connection.reply,
      });
    }

    const welcome = await sendManagerBotWelcomeMessages({
      userName: telegramUser.name ?? "Manager",
      telegramChatId: telegramUser.id,
    });

    return buildSettingsRedirect({
      status: "connected",
      channel: "telegram",
      detail:
        welcome.telegram.status === "sent"
          ? "Telegram connected successfully and the bot sent a welcome message."
          : "Telegram connected successfully.",
    });
  } catch (error) {
    return buildSettingsRedirect({
      status: "error",
      channel: "telegram",
      detail:
        error instanceof Error
          ? error.message
          : "Telegram login could not be completed.",
    });
  }
}

