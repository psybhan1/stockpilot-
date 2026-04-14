/**
 * Resolves a representative image URL for an inventory item.
 *
 * Strategy (zero-infra, no key required):
 *   - Pollinations.ai generates a product-style image from a prompt and
 *     returns a deterministic, cacheable URL. The image is generated on
 *     first browser fetch, so adding an item is instant on our side.
 *   - When a brand is provided we include it in the prompt so the result
 *     looks like that specific brand's packaging. When no brand is given
 *     we generate a generic photoreal product shot.
 *
 * Future: swap in a Google Images / SerpAPI lookup for the branded case
 * to get real product photos instead of AI-generated ones.
 */

export type ResolveImageInput = {
  name: string;
  brand?: string | null;
  category?: string | null;
};

const POLLINATIONS_BASE = "https://image.pollinations.ai/prompt";

export function buildInventoryImageUrl(input: ResolveImageInput): string {
  const prompt = buildPrompt(input);
  const params = new URLSearchParams({
    width: "640",
    height: "640",
    nologo: "true",
    model: "flux",
    enhance: "true",
    seed: String(hashSeed(prompt)),
  });
  return `${POLLINATIONS_BASE}/${encodeURIComponent(prompt)}?${params.toString()}`;
}

function buildPrompt({ name, brand, category }: ResolveImageInput): string {
  const cleanName = name.trim();
  if (brand && brand.trim()) {
    const cleanBrand = brand.trim();
    return [
      `professional product photography of ${cleanBrand} ${cleanName}`,
      "the brand name is clearly visible on the packaging",
      "isolated on pure white background",
      "soft studio lighting, commercial packshot",
      "sharp focus, high detail, photorealistic",
    ].join(", ");
  }

  const categoryHint = category
    ? ` (${category.toLowerCase().replace(/_/g, " ")})`
    : "";
  return [
    `professional product photography of ${cleanName}${categoryHint}`,
    "isolated on pure white background",
    "soft studio lighting, commercial packshot",
    "sharp focus, high detail, photorealistic",
  ].join(", ");
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 100000;
}
