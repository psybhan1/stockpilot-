/**
 * Magical brand auto-research — no questions asked.
 *
 * Flow (runs in background on signup or first image-gen call):
 *   1. Brave Search: "{businessName} {streetAddress} {postalCode}"
 *   2. Walk top results, prefer the business's own website over
 *      aggregators (Google / Yelp / Tripadvisor).
 *   3. Fetch the HTML + extract up to 5 hero images + the About-Us
 *      text via Cheerio.
 *   4. Send images + text to Groq Llama Vision (free) — ask it to
 *      classify vibe / palette / plating into our BrandIdentity shape.
 *   5. Persist to Business.brandIdentity JSON.
 *
 * Fallbacks in order when something fails:
 *   a. Brave returns nothing useful → Google Places API by exact
 *      address lookup (always returns photos for any brick-and-mortar)
 *   b. Still nothing → DEFAULT_BRAND_IDENTITY (minimal-warm)
 *
 * All external calls are "best effort" — the function NEVER throws.
 * Returns the brand identity it derived (or the default).
 */

import * as cheerio from "cheerio";

import { db } from "@/lib/db";
import type { BrandIdentity } from "@/modules/images/product-image";

const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const GOOGLE_PLACES_URL = "https://places.googleapis.com/v1/places:searchText";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_VISION_MODEL =
  process.env.GROQ_VISION_MODEL ?? "meta-llama/llama-4-scout-17b-16e-instruct";

const DEFAULT_BRAND_IDENTITY: BrandIdentity = {
  vibe: "minimal",
  palette: "warm-earth",
  plating: "overhead-flat",
};

type ResearchInput = {
  businessId: string;
  businessName: string;
  streetAddress: string | null;
  postalCode: string | null;
};

export async function researchBusinessBrand(
  input: ResearchInput
): Promise<BrandIdentity> {
  const query = [input.businessName, input.streetAddress, input.postalCode]
    .filter((x) => x && x.trim().length > 0)
    .join(" ");

  if (!query) {
    return persistAndReturn(input.businessId, DEFAULT_BRAND_IDENTITY);
  }

  // Try Brave → website scrape → vision
  const brandFromWeb = await tryWebResearch(query).catch(() => null);
  if (brandFromWeb) {
    return persistAndReturn(input.businessId, brandFromWeb);
  }

  // Fallback: Google Places photos
  const brandFromPlaces = await tryGooglePlaces(query).catch(() => null);
  if (brandFromPlaces) {
    return persistAndReturn(input.businessId, brandFromPlaces);
  }

  return persistAndReturn(input.businessId, DEFAULT_BRAND_IDENTITY);
}

async function tryWebResearch(query: string): Promise<BrandIdentity | null> {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!braveKey) return null;

  const response = await fetch(
    `${BRAVE_SEARCH_URL}?q=${encodeURIComponent(query)}&count=5`,
    {
      headers: {
        "X-Subscription-Token": braveKey,
        Accept: "application/json",
      },
    }
  );
  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as {
    web?: { results?: Array<{ url: string; title?: string }> };
  } | null;
  const results = body?.web?.results ?? [];

  // Pick the first non-aggregator result.
  const aggregators = new Set([
    "google.com",
    "google.ca",
    "yelp.com",
    "tripadvisor.com",
    "tripadvisor.ca",
    "foursquare.com",
    "facebook.com",
    "instagram.com",
    "maps.google.com",
  ]);
  const target = results.find((r) => {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "");
      return !aggregators.has(host) && !host.includes("google.");
    } catch {
      return false;
    }
  });
  if (!target) return null;

  const site = await fetchAndExtract(target.url).catch(() => null);
  if (!site) return null;

  return askVisionForBrandIdentity({
    imageUrls: site.imageUrls.slice(0, 4),
    aboutText: site.aboutText,
  });
}

type ExtractedSite = {
  imageUrls: string[];
  aboutText: string;
};

async function fetchAndExtract(pageUrl: string): Promise<ExtractedSite | null> {
  const response = await fetch(pageUrl, {
    headers: {
      // Many café sites block the default fetch UA. Pretend to be a
      // mainstream browser for the homepage scrape.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) return null;
  const html = await response.text();

  const $ = cheerio.load(html);
  const origin = new URL(pageUrl).origin;

  // Pull every large image. Prioritise og:image, then <img>s above
  // 200×200 (skip 1x1 trackers).
  const imageUrls = new Set<string>();
  const og = $('meta[property="og:image"]').attr("content");
  if (og) imageUrls.add(absolutify(og, origin));
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    const width = Number($(el).attr("width") ?? 0);
    if (width > 0 && width < 200) return;
    imageUrls.add(absolutify(src, origin));
  });

  // Extract About-Us text — any paragraph containing "about" "our"
  // "story" "serve" "cafe".
  const paragraphs: string[] = [];
  $("p, h1, h2, h3").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 40 && t.length < 400) paragraphs.push(t);
  });
  const aboutText = paragraphs.slice(0, 8).join("\n\n").slice(0, 2000);

  return {
    imageUrls: [...imageUrls].slice(0, 8),
    aboutText,
  };
}

function absolutify(src: string, origin: string): string {
  try {
    return new URL(src, origin).toString();
  } catch {
    return src;
  }
}

async function askVisionForBrandIdentity(input: {
  imageUrls: string[];
  aboutText: string;
}): Promise<BrandIdentity | null> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return null;

  const systemPrompt = `You classify a café's visual brand identity based on their hero images + About text. Return JSON only.

Valid values:
  vibe: "rustic" | "minimal" | "moody" | "bright" | "pop"
  palette: "warm-earth" | "cool-greys" | "bold" | "pastel" | "monochrome"
  plating: "styled" | "casual" | "overhead-flat"

Output schema:
{
  "vibe": <...>,
  "palette": <...>,
  "plating": <...>,
  "customPromptSuffix": "<2-5 word descriptor of anything distinctive about this café, or empty string>"
}`;

  const userContent: Array<
    { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }
  > = [
    {
      type: "text",
      text: `About / homepage text:\n${input.aboutText || "(not available)"}`,
    },
  ];
  for (const url of input.imageUrls) {
    userContent.push({ type: "image_url", image_url: { url } });
  }

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });
  if (!response.ok) return null;

  const body = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: string } }>;
  } | null;
  const raw = body?.choices?.[0]?.message?.content;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      vibe: coerce(
        parsed.vibe,
        ["rustic", "minimal", "moody", "bright", "pop"],
        "minimal"
      ) as BrandIdentity["vibe"],
      palette: coerce(
        parsed.palette,
        ["warm-earth", "cool-greys", "bold", "pastel", "monochrome"],
        "warm-earth"
      ) as BrandIdentity["palette"],
      plating: coerce(
        parsed.plating,
        ["styled", "casual", "overhead-flat"],
        "overhead-flat"
      ) as BrandIdentity["plating"],
      customPromptSuffix:
        typeof parsed.customPromptSuffix === "string" &&
        parsed.customPromptSuffix.trim().length > 0
          ? parsed.customPromptSuffix.trim().slice(0, 80)
          : undefined,
    };
  } catch {
    return null;
  }
}

async function tryGooglePlaces(query: string): Promise<BrandIdentity | null> {
  const placesKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesKey) return null;

  const response = await fetch(GOOGLE_PLACES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": placesKey,
      "X-Goog-FieldMask": "places.photos,places.displayName",
    },
    body: JSON.stringify({ textQuery: query }),
  });
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as {
    places?: Array<{ photos?: Array<{ name?: string }> }>;
  } | null;
  const photos = body?.places?.[0]?.photos ?? [];
  if (photos.length === 0) return null;

  // Construct image URLs from photo resource names.
  const imageUrls = photos.slice(0, 4).map(
    (p) =>
      `https://places.googleapis.com/v1/${p.name}/media?key=${placesKey}&maxWidthPx=800`
  );
  return askVisionForBrandIdentity({ imageUrls, aboutText: "" });
}

async function persistAndReturn(
  businessId: string,
  identity: BrandIdentity
): Promise<BrandIdentity> {
  await db.business.update({
    where: { id: businessId },
    data: {
      brandIdentity: JSON.parse(JSON.stringify(identity)),
      brandIdentityAt: new Date(),
    },
  });
  return identity;
}

function coerce<T extends readonly string[]>(
  raw: unknown,
  valid: T,
  fallback: T[number]
): T[number] {
  if (typeof raw === "string" && (valid as readonly string[]).includes(raw)) {
    return raw as T[number];
  }
  return fallback;
}
