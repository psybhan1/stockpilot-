/**
 * Pure helpers for popup.js — no DOM, no chrome.* APIs touched.
 * Factored out so tests (scripts/test-extension-endpoints.mts) can
 * import them directly without mocking the extension environment.
 */

export function normaliseUrl(raw) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (!u.host) return null;
    // Protocol+host only — path, query, hash are dropped because
    // the extension only uses the base URL.
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * Supplier.website in the DB can be a bare domain, a URL with path,
 * or with a www. prefix. We want just the lowercase eTLD+1-ish host
 * so host-to-supplier matching works.
 */
export function hostFromSupplierWebsite(website) {
  if (!website || typeof website !== "string") return null;
  const trimmed = website.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return u.host.toLowerCase().replace(/^www\./, "");
  } catch {
    // String-munge fallback for inputs the URL parser rejected
    // (e.g. spaces in host). Trim trailing whitespace so we don't
    // return a string with a dangling space from the path strip.
    return trimmed
      .toLowerCase()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "")
      .trim();
  }
}

/**
 * Crude "last two parts of host" for eTLD+1. We don't ship a
 * full public-suffix-list because the supplier set is small and
 * all well-behaved domains (no co.uk-style twists on our list).
 */
export function etld1FromHost(host) {
  if (!host) return "";
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join(".");
}

export function isUsableTabUrl(url) {
  if (!url) return false;
  if (/^(chrome|edge|brave|about|chrome-extension|moz-extension|file):/i.test(url)) {
    return false;
  }
  if (/^https?:\/\/(newtab|new-tab-page)/i.test(url)) return false;
  return true;
}

/**
 * Build a manifest-style origin pattern for chrome.permissions.request
 * from a tab URL. Covers the bare host + all subdomains.
 */
export function originPatternForUrl(tabUrl) {
  try {
    const u = new URL(tabUrl);
    return `${u.protocol}//*.${u.hostname.replace(/^www\./, "")}/*`;
  } catch {
    return "*://*/*";
  }
}

export function hostFromUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Convert Chrome's cookie object into our serializable shape
 * (the same shape the server's supplier-credentials helper accepts).
 */
export function chromeToSerializable(raw) {
  const sameSite =
    raw.sameSite === "strict"
      ? "Strict"
      : raw.sameSite === "lax"
        ? "Lax"
        : undefined;
  const out = { name: raw.name, value: raw.value };
  if (raw.domain) out.domain = raw.domain;
  if (raw.path) out.path = raw.path;
  if (typeof raw.expirationDate === "number" && isFinite(raw.expirationDate)) {
    out.expires = Math.floor(raw.expirationDate);
  }
  if (typeof raw.httpOnly === "boolean") out.httpOnly = raw.httpOnly;
  if (typeof raw.secure === "boolean") out.secure = raw.secure;
  if (sameSite) out.sameSite = sameSite;
  return out;
}

/**
 * Given the user's supplier list and an active-tab host, pick the
 * best match. Returns the supplier id or null. Pure — tests can
 * drive it without DOM.
 */
export function pickMatchingSupplier(suppliers, tabHost) {
  if (!tabHost) return null;
  const tabEtld1 = etld1FromHost(tabHost);
  for (const s of suppliers) {
    if (!s.website) continue;
    const supplierHost = hostFromSupplierWebsite(s.website);
    if (!supplierHost) continue;
    if (
      tabHost === supplierHost ||
      tabHost.endsWith(`.${supplierHost}`) ||
      tabEtld1 === supplierHost
    ) {
      return s.id;
    }
  }
  return null;
}
