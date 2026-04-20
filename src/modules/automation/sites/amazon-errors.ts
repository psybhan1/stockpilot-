/**
 * Pure Amazon error-page detection. Extracted from sites/amazon.ts
 * (which imports puppeteer-core) so it can be unit-tested without a
 * browser runtime.
 *
 * Heuristic: did we land on Amazon's "sorry, we couldn't find that
 * page" error? The telltale signs are the signature "dogs of Amazon"
 * image, specific error-page URLs, or the error copy in English or
 * French (amazon.ca often returns FR for en-US visitors). Covers the
 * user-reported failure where a product URL was region-locked on .ca
 * and dumped them on the dog page.
 */
export function detectAmazonErrorFromState(input: {
  url: string;
  title: string;
  bodyText: string;
}): boolean {
  const { url, title, bodyText } = input;
  // URL signatures first (fast-path).
  if (/\/(?:errors|404|gp\/aw\/errors|gp\/error)/i.test(url)) return true;
  if (/\/b\?node=/i.test(url) && /lookup/i.test(url)) return true;
  // Title signatures.
  if (/page not found|couldn'?t find that page|sorry!? something/i.test(title)) {
    return true;
  }
  if (/désolés|nous sommes désolés/i.test(title)) return true;
  // Body-text signatures — English + French copies of the error page.
  const body = bodyText.slice(0, 2000); // just the top of the body is enough
  if (
    /we (?:couldn'?t find|were unable to find) that page/i.test(body) ||
    /page you (?:were|are) looking for/i.test(body) ||
    /nous sommes désolés.*erreur.*s'est produite/i.test(body) ||
    /page d'accueil d'amazon/i.test(body) ||
    /dogs of amazon/i.test(body)
  ) {
    return true;
  }
  return false;
}
