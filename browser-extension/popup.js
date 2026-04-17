/**
 * StockPilot extension popup logic.
 *
 * Flow:
 *   1. Read the StockPilot base URL from chrome.storage.local.
 *      If not set -> show setup view.
 *   2. Ping /api/suppliers/extension/list to verify the user is
 *      signed in to StockPilot in this browser.
 *      - 401 -> show sign-in view
 *      - 200 -> remember suppliers, show ready view
 *   3. In the ready view, auto-match the current tab's hostname
 *      against the suppliers' website fields. Pre-select the match.
 *   4. On "Push cookies": chrome.cookies.getAll({ domain }) for the
 *      active tab's eTLD+1, POST to /api/suppliers/:id/credentials/from-extension
 *      with credentials: "include". Show success or error.
 */

const STORAGE_KEY_URL = "stockpilotUrl";

// ---------- View switching ----------

const views = {
  setup: document.getElementById("setup-view"),
  signin: document.getElementById("signin-view"),
  ready: document.getElementById("ready-view"),
  success: document.getElementById("success-view"),
  error: document.getElementById("error-view"),
};

function showView(name) {
  for (const key of Object.keys(views)) {
    views[key].hidden = key !== name;
  }
}

// ---------- Storage helpers ----------

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

function normaliseUrl(raw) {
  const trimmed = (raw || "").trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

// ---------- Current tab ----------

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

/**
 * Normalises a hostname to an eTLD+1-ish form good enough for
 * matching supplier.website strings. We keep everything after the
 * leading "www.". Cookies on Amazon are set on .amazon.com, so we
 * also keep the trailing two parts for the cookie query below.
 */
function stripWww(host) {
  return (host || "").toLowerCase().replace(/^www\./, "");
}

/**
 * Return the cookie-domain to query chrome.cookies.getAll against.
 * For amazon.com, we want ".amazon.com" so we scoop up cookies set
 * on the bare domain AND subdomains. chrome.cookies.getAll accepts
 * the `domain` param as a substring match, so ".amazon.com" works.
 */
function cookieDomainFromHost(host) {
  const h = stripWww(host);
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  return parts.slice(-2).join(".");
}

// ---------- API calls ----------

async function apiListSuppliers(baseUrl) {
  const res = await fetch(`${baseUrl}/api/suppliers/extension/list`, {
    method: "GET",
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (res.status === 401) return { ok: false, status: 401 };
  if (!res.ok) {
    return { ok: false, status: res.status, message: await safeText(res) };
  }
  const data = await res.json();
  return { ok: true, suppliers: data.suppliers || [] };
}

async function apiPushCookies(baseUrl, supplierId, cookies) {
  const res = await fetch(
    `${baseUrl}/api/suppliers/${encodeURIComponent(supplierId)}/credentials/from-extension`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ cookies }),
    }
  );
  if (!res.ok) {
    return { ok: false, status: res.status, message: await safeText(res) };
  }
  const data = await res.json();
  return { ok: true, cookieCount: data.cookieCount };
}

async function safeText(res) {
  try {
    const j = await res.json();
    if (j && typeof j.message === "string") return j.message;
  } catch {
    /* fall through */
  }
  return `HTTP ${res.status}`;
}

// ---------- Cookie capture ----------

function getAllCookies(domain) {
  return new Promise((resolve) => {
    chrome.cookies.getAll({ domain }, (cookies) => {
      resolve(cookies || []);
    });
  });
}

function toSerializable(raw) {
  // Chrome's cookie object includes `session`, `storeId`, etc. We
  // only want what encryptSupplierCredentials accepts.
  const sameSite =
    raw.sameSite === "strict"
      ? "Strict"
      : raw.sameSite === "lax"
        ? "Lax"
        : raw.sameSite === "no_restriction"
          ? "None"
          : undefined;
  const out = {
    name: raw.name,
    value: raw.value,
  };
  if (raw.domain) out.domain = raw.domain;
  if (raw.path) out.path = raw.path;
  if (typeof raw.expirationDate === "number") {
    out.expires = Math.floor(raw.expirationDate);
  }
  if (typeof raw.httpOnly === "boolean") out.httpOnly = raw.httpOnly;
  if (typeof raw.secure === "boolean") out.secure = raw.secure;
  if (sameSite) out.sameSite = sameSite;
  return out;
}

// ---------- State machine ----------

let state = {
  baseUrl: null,
  suppliers: [],
  activeHost: null,
  activeUrl: null,
};

async function init() {
  const baseUrl = await getStockpilotUrl();
  if (!baseUrl) {
    showView("setup");
    return;
  }
  state.baseUrl = baseUrl;
  document.getElementById("current-url-display").textContent = baseUrl;

  const list = await apiListSuppliers(baseUrl).catch((e) => ({
    ok: false,
    status: 0,
    message: e && e.message ? e.message : "Network error",
  }));
  if (!list.ok && list.status === 401) {
    showView("signin");
    return;
  }
  if (!list.ok) {
    document.getElementById("error-message").textContent =
      list.message || `Couldn't reach StockPilot (HTTP ${list.status}).`;
    showView("error");
    return;
  }
  state.suppliers = list.suppliers;

  const tab = await getActiveTab();
  const url = tab && tab.url ? tab.url : "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  state.activeHost = host;
  state.activeUrl = url;
  document.getElementById("current-host").textContent = host || "(no active tab)";

  populateSupplierPicker();
  showView("ready");
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
    return;
  }

  const hostBare = stripWww(state.activeHost);
  let matchId = null;
  for (const s of state.suppliers) {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.name + (s.website ? `  (${s.website})` : "");
    select.appendChild(opt);
    if (!matchId && s.website) {
      const supplierHost = stripWww(s.website);
      if (hostBare && (hostBare === supplierHost || hostBare.endsWith(`.${supplierHost}`))) {
        matchId = s.id;
      }
    }
  }
  if (matchId) {
    select.value = matchId;
    noMatch.hidden = true;
  } else {
    noMatch.hidden = !hostBare; // only warn if we *have* a host but didn't match
  }
  button.disabled = false;
}

// ---------- Event wiring ----------

document.getElementById("save-url").addEventListener("click", async () => {
  const raw = document.getElementById("stockpilot-url").value;
  const url = normaliseUrl(raw);
  if (!url) {
    alert("Enter a valid URL like https://stockpilot.yourcompany.com");
    return;
  }
  await setStockpilotUrl(url);
  state.baseUrl = url;
  await init();
});

document.getElementById("open-stockpilot").addEventListener("click", async () => {
  if (!state.baseUrl) return;
  await chrome.tabs.create({ url: `${state.baseUrl}/login` });
  window.close();
});

document.getElementById("reset-url").addEventListener("click", async () => {
  await clearStockpilotUrl();
  state.baseUrl = null;
  document.getElementById("stockpilot-url").value = "";
  showView("setup");
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
  if (!state.activeHost) {
    status.textContent = "No active tab hostname — open a supplier tab first.";
    return;
  }
  button.disabled = true;
  status.textContent = "Grabbing cookies…";

  const domain = cookieDomainFromHost(state.activeHost);
  const raw = await getAllCookies(domain);
  if (raw.length === 0) {
    button.disabled = false;
    status.textContent = `No cookies found for ${domain}. Sign in to the site first, then try again.`;
    return;
  }
  const cookies = raw.map(toSerializable);

  status.textContent = `Pushing ${cookies.length} cookies to StockPilot…`;
  const result = await apiPushCookies(state.baseUrl, supplierId, cookies).catch((e) => ({
    ok: false,
    status: 0,
    message: e && e.message ? e.message : "Network error",
  }));

  if (!result.ok) {
    button.disabled = false;
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
