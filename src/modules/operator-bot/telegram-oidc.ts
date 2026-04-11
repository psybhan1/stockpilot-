import { createHash, randomBytes } from "node:crypto";

import { createRemoteJWKSet, jwtVerify } from "jose";

import { env } from "@/lib/env";

const TELEGRAM_OIDC_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_OIDC_COOKIE_NAME = "stockpilot_telegram_oidc";
const TELEGRAM_OIDC_SCOPES = "openid profile telegram:bot_access";
const TELEGRAM_OIDC_TTL_SECONDS = 15 * 60;

const telegramJwks = createRemoteJWKSet(
  new URL(`${TELEGRAM_OIDC_ISSUER}/.well-known/jwks.json`)
);

type TelegramOidcCookiePayload = {
  state: string;
  codeVerifier: string;
  issuedAt: number;
};

type TelegramIdTokenPayload = {
  id: string;
  username: string | null;
  name: string | null;
};

export function isTelegramOneTapReady() {
  return Boolean(
    env.TELEGRAM_LOGIN_CLIENT_ID &&
      env.TELEGRAM_LOGIN_CLIENT_SECRET &&
      env.TELEGRAM_BOT_TOKEN
  );
}

export function getTelegramOidcCookieName() {
  return TELEGRAM_OIDC_COOKIE_NAME;
}

export function getTelegramOidcRedirectUri() {
  return `${env.APP_URL.replace(/\/$/, "")}/api/bot/telegram/oidc/callback`;
}

export function createTelegramOidcSession(state: string) {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");

  return {
    codeVerifier,
    codeChallenge,
    cookieValue: JSON.stringify({
      state,
      codeVerifier,
      issuedAt: Date.now(),
    } satisfies TelegramOidcCookiePayload),
  };
}

export function readTelegramOidcSession(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as TelegramOidcCookiePayload;

    if (
      !parsed ||
      typeof parsed.state !== "string" ||
      typeof parsed.codeVerifier !== "string" ||
      typeof parsed.issuedAt !== "number"
    ) {
      return null;
    }

    if (Date.now() - parsed.issuedAt > TELEGRAM_OIDC_TTL_SECONDS * 1000) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function buildTelegramOidcAuthorizationUrl(input: {
  state: string;
  codeChallenge: string;
}) {
  if (!env.TELEGRAM_LOGIN_CLIENT_ID) {
    throw new Error("Missing TELEGRAM_LOGIN_CLIENT_ID.");
  }

  const url = new URL(`${TELEGRAM_OIDC_ISSUER}/auth`);
  url.searchParams.set("client_id", env.TELEGRAM_LOGIN_CLIENT_ID);
  url.searchParams.set("redirect_uri", getTelegramOidcRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", TELEGRAM_OIDC_SCOPES);
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

export async function exchangeTelegramOidcCode(input: {
  code: string;
  codeVerifier: string;
}) {
  if (!env.TELEGRAM_LOGIN_CLIENT_ID || !env.TELEGRAM_LOGIN_CLIENT_SECRET) {
    throw new Error("Missing Telegram login client credentials.");
  }

  const response = await fetch(`${TELEGRAM_OIDC_ISSUER}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${env.TELEGRAM_LOGIN_CLIENT_ID}:${env.TELEGRAM_LOGIN_CLIENT_SECRET}`
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: getTelegramOidcRedirectUri(),
      client_id: env.TELEGRAM_LOGIN_CLIENT_ID,
      code_verifier: input.codeVerifier,
    }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as
    | {
        id_token?: string;
        error?: string;
        error_description?: string;
      }
    | null;

  if (!response.ok || !payload?.id_token) {
    throw new Error(
      payload?.error_description ??
        payload?.error ??
        `Telegram token exchange failed with status ${response.status}`
    );
  }

  return {
    idToken: payload.id_token,
  };
}

export async function verifyTelegramOidcIdToken(idToken: string) {
  if (!env.TELEGRAM_LOGIN_CLIENT_ID) {
    throw new Error("Missing TELEGRAM_LOGIN_CLIENT_ID.");
  }

  const { payload } = await jwtVerify(idToken, telegramJwks, {
    issuer: TELEGRAM_OIDC_ISSUER,
    audience: env.TELEGRAM_LOGIN_CLIENT_ID,
  });

  const id = getTelegramUserIdFromPayload(payload);

  if (!id) {
    throw new Error("Telegram login payload did not include a user identifier.");
  }

  return {
    id,
    username:
      typeof payload.preferred_username === "string" ? payload.preferred_username : null,
    name: typeof payload.name === "string" ? payload.name : null,
  } satisfies TelegramIdTokenPayload;
}

function getTelegramUserIdFromPayload(payload: Record<string, unknown>) {
  if (typeof payload.id === "string" || typeof payload.id === "number") {
    return String(payload.id);
  }

  if (typeof payload.sub === "string" || typeof payload.sub === "number") {
    return String(payload.sub);
  }

  return null;
}

