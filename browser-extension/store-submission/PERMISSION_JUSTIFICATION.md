# Permission justifications

Paste these into the "Permission justification" field of the Edge
Add-ons / Chrome Web Store submission form. Each permission we
request has a concrete, non-optional reason; the reviewer wants to
see we're not just grabbing everything.

## `cookies`

Required to read the supplier site's session cookies at the moment
the user clicks "Push cookies to StockPilot" in the popup. We call
`chrome.cookies.getAll({ domain })` scoped to the active tab's
eTLD+1 only, and only in response to the user's explicit click —
there is no background script. Without this permission, the
extension's entire purpose (capturing an authenticated session for
a supplier website) cannot happen.

## `storage`

Used to persist the user's StockPilot server URL in
`chrome.storage.local` on first run, so the popup doesn't have to
ask every time. Stores a single key: `stockpilotUrl` (a string).
No other state is persisted.

## `activeTab`

Used to read the URL of the currently-active tab so the popup can
auto-select the matching supplier from the user's StockPilot
account. Activated on icon click only.

## `tabs`

Used to open new tabs when the user clicks "Connect this browser"
(navigates to the StockPilot linking page) or "Open StockPilot to
sign in". We do not enumerate or read existing tabs beyond the
active-tab URL covered by `activeTab`.

## `host_permissions` — the supplier domain list

The manifest lists known supplier hosts (amazon.com, costco.com,
walmart.com, lcbo.com, sysco.com, etc.). These are pre-granted at
install time because the extension's value proposition *is* reading
cookies from those exact hosts. A restaurant manager who installs
this extension will use it on one or more of these sites by
definition.

## `optional_host_permissions: ["*://*/*"]`

Required for the small number of regional / independent suppliers
whose domains aren't in our static list. When the user tries to
push cookies for a supplier we don't ship permissions for,
`chrome.permissions.request({ origins: [specific-host] })` fires
a Chrome permission prompt the user must explicitly accept — the
narrower pattern (e.g. `https://*.sysco.com/*`) is a subset of
the wildcard, so the prompt is scoped to that specific host. We
never silently use the wildcard; every prompt is user-initiated.

## What we DO NOT request

- `scripting` — no content-script injection
- `webRequest` — no network interception
- `history` — no browsing history access
- `bookmarks`, `downloads`, `geolocation`, `identity` — none of it

The minimal set above is what's needed to capture one cookie jar
per supplier, per user-initiated click. That's the whole product.
