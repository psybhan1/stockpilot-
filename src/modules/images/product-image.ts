/**
 * Product-image cascade — the chain that gives every inventory item a
 * photo with as little user work as possible.
 *
 * Lookup order when resolving an image URL:
 *   1. InventoryItem.imageBytes (manually uploaded OR AI-generated,
 *      served via /api/inventory/[id]/image)
 *   2. Linked PosCatalogItem.imageUrl (copied from Square/Clover/
 *      Shopify catalog during sync)
 *   3. Linked MenuItem.imageUrl (if user set one manually there)
 *   4. placeholder
 *
 * Generation triggers (Phase 3c) populate imageBytes via
 * Cloudflare Workers AI using the Business.brandIdentity prompt
 * template. Brand identity is derived automatically from Brave
 * Search + Google Places + Groq Vision — the user never types the
 * prompt themselves.
 */

import { db } from "@/lib/db";

const CF_WORKERS_AI_IMAGE_MODEL = "@cf/black-forest-labs/flux-1-schnell";

export type BrandIdentity = {
  vibe: "rustic" | "minimal" | "moody" | "bright" | "pop" | "unknown";
  palette:
    | "warm-earth"
    | "cool-greys"
    | "bold"
    | "pastel"
    | "monochrome"
    | "unknown";
  plating: "styled" | "casual" | "overhead-flat" | "unknown";
  logoImageUrl?: string;
  customPromptSuffix?: string;
};

const DEFAULT_BRAND_IDENTITY: BrandIdentity = {
  vibe: "minimal",
  palette: "warm-earth",
  plating: "overhead-flat",
};

export function buildImagePrompt(input: {
  productName: string;
  category: string;
  brand: BrandIdentity;
}): string {
  const { productName, category, brand } = input;
  const vibeWord = brand.vibe === "unknown" ? "minimal" : brand.vibe;
  const paletteWord =
    brand.palette === "unknown" ? "warm earth" : brand.palette.replace("-", " ");
  const platingWord =
    brand.plating === "unknown" ? "overhead flat-lay" : brand.plating.replace("-", " ");

  const base = `${vibeWord} cafe product photography of a ${productName}, ${platingWord} styling, ${paletteWord} color palette, natural daylight, square format, no text, no watermark, no humans`;

  if (category === "BAKERY_INGREDIENT" || /muffin|cookie|cake|pastry|bread|croissant/i.test(productName)) {
    return `${base}, on a rustic ceramic plate${brand.customPromptSuffix ? ", " + brand.customPromptSuffix : ""}`;
  }
  if (category === "DAIRY" || category === "ALT_DAIRY" || /latte|cappuccino|mocha|coffee|americano|espresso|matcha/i.test(productName)) {
    return `${base}, in a ceramic mug or glass with subtle steam${brand.customPromptSuffix ? ", " + brand.customPromptSuffix : ""}`;
  }
  return `${base}${brand.customPromptSuffix ? ", " + brand.customPromptSuffix : ""}`;
}

export async function getBrandIdentity(
  businessId: string
): Promise<BrandIdentity> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { brandIdentity: true },
  });
  const raw = business?.brandIdentity;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    return {
      vibe: coerceEnum(
        o.vibe,
        ["rustic", "minimal", "moody", "bright", "pop", "unknown"] as const,
        "unknown"
      ),
      palette: coerceEnum(
        o.palette,
        [
          "warm-earth",
          "cool-greys",
          "bold",
          "pastel",
          "monochrome",
          "unknown",
        ] as const,
        "unknown"
      ),
      plating: coerceEnum(
        o.plating,
        ["styled", "casual", "overhead-flat", "unknown"] as const,
        "unknown"
      ),
      logoImageUrl:
        typeof o.logoImageUrl === "string" ? o.logoImageUrl : undefined,
      customPromptSuffix:
        typeof o.customPromptSuffix === "string"
          ? o.customPromptSuffix
          : undefined,
    };
  }
  return DEFAULT_BRAND_IDENTITY;
}

/**
 * Generate an image via Cloudflare Workers AI. Free tier gives 10k
 * neurons/day which comfortably covers hundreds of images/day at our
 * scale. Returns raw bytes + contentType for storing on InventoryItem.
 *
 * Gracefully returns null when credentials are missing so other code
 * paths can fall back (placeholder/upload prompt) without throwing.
 */
export async function generateProductImage(input: {
  productName: string;
  category: string;
  brand: BrandIdentity;
}): Promise<{ bytes: Buffer; contentType: string } | null> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) {
    // Cloudflare not configured — callers fall back to placeholder.
    return null;
  }

  const prompt = buildImagePrompt(input);

  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${CF_WORKERS_AI_IMAGE_MODEL}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        // Flux Schnell tuning: 4 steps is the sweet spot (it's a
        // distilled model designed for few steps).
        num_steps: 4,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.warn(
        `[product-image] CF Workers AI returned ${response.status}: ${errText.slice(0, 200)}`
      );
      return null;
    }

    // Flux on CF returns JSON with base64 image data or raw bytes
    // depending on model. The current contract for flux-schnell:
    //   { "result": { "image": "<base64 jpeg>" }, "success": true }
    const payload = (await response.json().catch(() => null)) as
      | { result?: { image?: string }; success?: boolean }
      | null;

    const base64 = payload?.result?.image;
    if (!base64) {
      // eslint-disable-next-line no-console
      console.warn("[product-image] CF Workers AI returned no image data");
      return null;
    }

    return {
      bytes: Buffer.from(base64, "base64"),
      contentType: "image/jpeg",
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[product-image] generation error:", err);
    return null;
  }
}

export async function resolveImageUrlForInventoryItem(input: {
  inventoryItemId: string;
  inventoryImageUrl?: string | null;
  imageBytes?: Buffer | null;
}): Promise<string | null> {
  // Bytes served via API route wins — it's the user's own upload or
  // the generated one.
  if (input.imageBytes && input.imageBytes.length > 0) {
    return `/api/inventory/${input.inventoryItemId}/image`;
  }
  if (input.inventoryImageUrl) return input.inventoryImageUrl;
  return null;
}

function coerceEnum<T extends readonly string[]>(
  raw: unknown,
  valid: T,
  fallback: T[number]
): T[number] {
  if (typeof raw === "string" && (valid as readonly string[]).includes(raw)) {
    return raw as T[number];
  }
  return fallback;
}
