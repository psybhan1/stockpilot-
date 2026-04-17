/**
 * StockPilot extension popup logic.
 *
 * Flow:
 *   1. First run  -> setup view asks for StockPilot URL.
 *   2. List fetch -> if 401 with { needsLink: true }, show the
 *      "link this browser" view with a button that opens the
 *      signin wizard (which auto-links on mount).
 *   3. Ready view -> current tab's host is auto-matched against the
 *      user's suppliers. Already-connected ones show a ✓ tag.
 *   4. Push       -> chrome.cookies.getAll scoped to the tab URL,
 *      POST to /api/suppliers/:id/credentials/from-extension.
 *      Retries once on 5xx. Requests host_permissions dynamically
 *      if the current tab's host isn't in the manifest allowlist.
 */

import {
  normaliseUrl,
  hostFromSupplierWebsite,
  etld1FromHost,
  isUsableTabUrl,
  originPatternForUrl,
  hostFromUrl,
  chromeToSerializable,
  pickMatchingSupplier,
} from "./popup-helpers.js";

const STORAGE_KEY_URL = "stockpilotUrl";

// ---------- View switching ----------

const views = {
  loading: document.getElementById("loading-view"),
  setup: document.getElementById("setup-view"),
  link: document.getElementById("link-view"),
  ready: document.getElementById("ready-view"),
  success: document.getElementById("success-view"),
  error: document.getElementById("error-view"),
};

function showView(name) {
  for (const key of Object.keys(views)) {
    if (views[key]) views[key].hidden = key !== name;
  }
}

// ---------- Storage / URL helpers ----------

function getStockpilotUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEY_URL], (result) => {
      resolve(result[STORAGE_KEY_URL] || null);
    });
  });
}

function setStockpilotUrl(url) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [STORAGE_KEY_URL]: url }, () => resolve());
  });
}

function clearStockpilotUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([STORAGE_KEY_URL], () => resolve());
  });
}

// ---------- Current tab ----------

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

// ---------- Permissions ----------

function hasHostPermission(tabUrl) {
  return new Promise((resolve) => {
    chrome.permissions.contains({ origins: [originPatternForUrl(tabUrl)] }, (ok) =>
      resolve(!!ok)
    );
  });
}

function requestHostPermission(tabUrl) {
  return new Promise((resolve) => {
    chrome.permissions.request({ origins: [originPatternForUrl(tabUrl)] }, (granted) =>
      resolve(!!granted)
    );
  });
}

// ---------- API calls ----------

/**
 * Wrap fetch with an AbortController timeout — a slow backend
 * would otherwise leave the popup stuck on "Pushing cookies…"
 * forever, and the popup closes on focus-loss (leaking the req).
 */
async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function networkErrorMessage(err, timeoutMs) {
  if (err && err.name === "AbortError") {
    return `StockPilot didn't respond within ${Math.round(timeoutMs / 1000)}s.`;
  }
  if (err && err.message) return err.message;
  return "Network error";
}

async function apiListSuppliers(baseUrl) {
  const timeoutMs = 10_000;
  let res;
  try {
    res = await fetchWithTimeout(
      `${baseUrl}/api/suppliers/extension/list`,
      {
        method: "GET",
        credentials: "include",
        cache: "no-store",
        headers: { accept: "application/json" },
      },
      timeoutMs
    );
  } catch (err) {
    return { ok: false, status: 0, message: networkErrorMessage(err, timeoutMs) };
  }
  if (res.status === 401) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    return { ok: false, status: 401, needsLink: body && body.needsLink };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, message: await safeMessage(res) };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, suppliers: Array.isArray(data.suppliers) ? data.suppliers : [] };
}

async function apiPushCookies(baseUrl, supplierId, cookies) {
  const url = `${baseUrl}/api/suppliers/${encodeURIComponent(supplierId)}/credentials/from-extension`;
  const body = JSON.stringify({ cookies });
  const timeoutMs = 15_000;

  // Retry once on network error or 5xx with a short delay —
  // covers flaky deploys, Railway cold-starts, etc.
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetchWithTimeout(
        url,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json", accept: "application/json" },
          body,
        },
        timeoutMs
      );
    } catch (err) {
      if (attempt === 0) {
        await sleep(500);
        continue;
      }
      return { ok: false, status: 0, message: networkErrorMessage(err, timeoutMs) };
    }
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: true, cookieCount: data.cookieCount || cookies.length };
    }
    if (res.status >= 500 && attempt === 0) {
      await sleep(500);
      continue;
    }
    return { ok: false, status: res.status, message: await safeMessage(res) };
  }
  return { ok: false, status: 0, message: "Unknown error" };
}

async function safeMessage(res) {
  try {
    const j = await res.json();
    if (j && typeof j.message === "string") return j.message;
  } catch {
    /* ignore */
  }
  return `HTTP ${res.status}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- Cookie capture ----------

/**
 * Query Chrome for every cookie attached to the tab URL's host +
 * subdomains. Using the `url` param would only match cookies that
 * the tab URL would ACTUALLY send — missing cookies set on a sibling
 * subdomain. We want everything under eTLD+1.
 */
function getAllCookiesForTab(tabUrl) {
  const etld1 = etld1FromHost(hostFromUrl(tabUrl));
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain: etld1 }, (cookies) => {
      resolve(Array.isArray(cookies) ? cookies : []);
    });
  });
}

// ---------- State ----------

let state = {
  baseUrl: null,
  suppliers: [],
  activeHost: null,
  activeUrl: null,
};

// ---------- Init / flow ----------

async function init() {
  showView("loading");
  const baseUrl = await getStockpilotUrl();
  if (!baseUrl) {
    showView("setup");
    document.getElementById("stockpilot-url").focus();
    return;
  }
  state.baseUrl = baseUrl;
  const urlDisplay = document.getElementById("current-url-display");
  if (urlDisplay) urlDisplay.textContent = baseUrl;
  const linkHint = document.getElementById("link-url-hint");
  if (linkHint) linkHint.textContent = baseUrl;

  const list = await apiListSuppliers(baseUrl).catch((e) => ({
    ok: false,
    status: 0,
    message: e && e.message ? e.message : "Network error",
  }));
  if (!list.ok && list.status === 401) {
    showView("link");
    return;
  }
  if (!list.ok) {
    const msg = friendlyErrorMessage(list, baseUrl);
    document.getElementById("error-message").textContent = msg;
    showView("error");
    return;
  }
  state.suppliers = list.suppliers;

  const tab = await getActiveTab();
  const url = tab && tab.url ? tab.url : "";
  state.activeUrl = url;
  state.activeHost = isUsableTabUrl(url) ? hostFromUrl(url) : "";
  document.getElementById("current-host").textContent =
    state.activeHost || "(no usable tab — open your supplier in another tab)";

  populateSupplierPicker();
  showView("ready");
}

function friendlyErrorMessage(list, baseUrl) {
  if (list.status === 0) {
    return `Couldn't reach StockPilot at ${baseUrl}. Check the URL is right and you're online.`;
  }
  if (list.status === 404) {
    return `StockPilot isn't responding at ${baseUrl}. Double-check the URL — maybe you meant a different subdomain?`;
  }
  if (list.message) return list.message;
  return `Couldn't reach StockPilot (HTTP ${list.status}).`;
}

function populateSupplierPicker() {
  const select = document.getElementById("supplier-select");
  const noMatch = document.getElementById("no-match-warning");
  const button = document.getElementById("send-cookies");
  select.innerHTML = "";

  if (state.suppliers.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = "(no suppliers on your StockPilot account)";
    opt.disabled = true;
    opt.selected = true;
    select.appendChild(opt);
    button.disabled = true;
    noMatch.hidden = true;
    return;
  }

  const tabHost = state.activeHost;
  for (const s of state.suppliers) {
    const opt = document.createElement("option");
    opt.value = s.id;
    const tag = s.connected ? "  ✓ connected" : "";
    const site = s.website ? `  (${hostFromSupplierWebsite(s.website)})` : "";
    opt.textContent = `${s.name}${site}${tag}`;
    select.appendChild(opt);
  }
  const matchId = pickMatchingSupplier(state.suppliers, tabHost);
  if (matchId) {
    select.value = matchId;
    noMatch.hidden = true;
  } else {
    noMatch.hidden = !tabHost;
  }
  button.disabled = !tabHost;
}

// ---------- Event wiring ----------

function handleSaveUrl() {
  const raw = document.getElementById("stockpilot-url").value;
  const url = normaliseUrl(raw);
  if (!url) {
    const errorEl = document.getElementById("setup-error");
    if (errorEl) {
      errorEl.textContent = "Enter a valid URL like https://stockpilot.yourcompany.com";
      errorEl.hidden = false;
    }
    return;
  }
  setStockpilotUrl(url).then(() => {
    state.baseUrl = url;
    init();
  });
}

document.getElementById("save-url").addEventListener("click", handleSaveUrl);
document.getElementById("stockpilot-url").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    handleSaveUrl();
  }
});
document.getElementById("stockpilot-url").addEventListener("input", () => {
  const errorEl = document.getElementById("setup-error");
  if (errorEl) errorEl.hidden = true;
});

document.getElementById("open-link").addEventListener("click", async () => {
  if (!state.baseUrl) return;
  // /extension/connect mints the extension cookie server-side on
  // page load — no client-side useEffect races. Drops the user on
  // a "You're linked. Close this tab." page.
  await chrome.tabs.create({ url: `${state.baseUrl}/extension/connect` });
  window.close();
});

document.getElementById("open-stockpilot-signin")?.addEventListener("click", async () => {
  if (!state.baseUrl) return;
  await chrome.tabs.create({ url: `${state.baseUrl}/login` });
  window.close();
});

document.getElementById("reset-url").addEventListener("click", async () => {
  await clearStockpilotUrl();
  state.baseUrl = null;
  document.getElementById("stockpilot-url").value = "";
  showView("setup");
  document.getElementById("stockpilot-url").focus();
});

document.getElementById("send-cookies").addEventListener("click", async () => {
  const button = document.getElementById("send-cookies");
  const status = document.getElementById("send-status");
  const select = document.getElementById("supplier-select");
  const supplierId = select.value;
  if (!supplierId) {
    status.textContent = "Pick a supplier first.";
    return;
  }
  if (!state.activeUrl || !state.activeHost) {
    status.textContent = "Open your supplier's site in another tab first, then come back.";
    return;
  }

  // Disable immediately so a rapid double-click doesn't kick off two
  // concurrent permission prompts + pushes. Re-enable before early
  // returns so the user can retry without closing the popup.
  button.disabled = true;

  // If the current tab's host isn't in our static host_permissions,
  // ask the user before we can read its cookies.
  const already = await hasHostPermission(state.activeUrl);
  if (!already) {
    status.textContent = `Asking permission to read cookies for ${state.activeHost}…`;
    const granted = await requestHostPermission(state.activeUrl);
    if (!granted) {
      status.textContent = "Permission denied — can't read cookies without it.";
      button.disabled = false;
      return;
    }
  }

  status.textContent = "Grabbing cookies…";

  const raw = await getAllCookiesForTab(state.activeUrl);
  if (raw.length === 0) {
    button.disabled = false;
    status.textContent = `No cookies found for ${state.activeHost}. Sign in on that tab first, then try again.`;
    return;
  }
  const cookies = raw.map(chromeToSerializable);

  status.textContent = `Pushing ${cookies.length} cookies to StockPilot…`;
  const result = await apiPushCookies(state.baseUrl, supplierId, cookies).catch((e) => ({
    ok: false,
    status: 0,
    message: e && e.message ? e.message : "Network error",
  }));

  if (!result.ok) {
    button.disabled = false;
    if (result.status === 401) {
      // Session got invalidated between list + push. Route them
      // back to the link flow rather than dead-ending.
      showView("link");
      return;
    }
    document.getElementById("error-message").textContent =
      result.message || `Push failed (HTTP ${result.status}).`;
    showView("error");
    return;
  }

  const supplier = state.suppliers.find((s) => s.id === supplierId);
  document.getElementById("success-details").textContent =
    `Saved ${result.cookieCount} cookies to ${supplier ? supplier.name : "this supplier"}.`;
  showView("success");
});

document.getElementById("done-button").addEventListener("click", () => {
  window.close();
});

document.getElementById("retry-button").addEventListener("click", () => {
  init();
});

// ---------- Kickoff ----------

init();
