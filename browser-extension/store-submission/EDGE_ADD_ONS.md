# Submitting StockPilot to Microsoft Edge Add-ons

**Cost: $0.** (Chrome Web Store charges a $5 one-time developer fee;
Microsoft does not.) Review typically takes 1–3 business days. The
same MV3 extension works on Chrome, Brave, Arc, and Edge, so publishing
to Edge lets any user of those browsers install with a single click
from the Edge store (yes, including Chrome users — Chrome can install
Edge Add-ons via a "sideload from Edge" workflow once permitted, but
more practically, your Edge users get 1-click, and everyone else still
has the "Load unpacked" path).

## Before you start

You'll need:

1. A **free** Microsoft Partner Center account: https://partner.microsoft.com/
   (sign in with any Microsoft/Outlook/Hotmail account; no billing).
2. The extension zip, built fresh from `npm run build:extension` (lives
   at `public/downloads/stockpilot-extension.zip` after the build).
3. A privacy policy URL — StockPilot publishes one at
   `<your-stockpilot-url>/privacy/extension`. Microsoft requires the
   URL to be publicly reachable (no login wall), so make sure your
   Next.js deployment serves `/privacy/extension` to anonymous users
   — the page was built as `force-static` for exactly this reason.
4. Three screenshots (1280×800) of the extension in action. See
   `screenshots/` below for the script to generate them.
5. A store icon at 300×300 (not the 128×128 toolbar icon). Generated
   by `scripts/generate-store-icon.mjs` below.

## Step-by-step

1. Open https://partner.microsoft.com/en-us/dashboard/microsoftedge/overview
2. Click **Create new extension**.
3. **Package** tab: upload the zip. Wait for the validator to finish.
4. **Properties** tab:
   - Display name: `StockPilot — Sign in helper`
   - Short description: *(paste from STORE_DESCRIPTION.md, "Short")*
   - Detailed description: *(paste from STORE_DESCRIPTION.md, "Detailed")*
   - Category: `Productivity`
   - Privacy policy URL: `https://<your-stockpilot-url>/privacy/extension`
5. **Availability** tab: leave as "Public" unless you want a private
   link-only listing.
6. **Properties → Permissions justification** (Microsoft asks why each
   permission is needed). Copy from `PERMISSION_JUSTIFICATION.md`.
7. **Store listing → Images**: upload the store icon and three
   screenshots from `screenshots/`.
8. Click **Submit**. You'll get an email when the review completes.

## What happens on reviewer objections

Microsoft's most common objections for this kind of extension:

- **"Cookies permission is too broad"** — reply with the justification
  file; point out we only read on user click, no background script.
- **"Host permissions include too many sites"** — explain that the
  listed hosts are a hard-coded supplier allowlist; the
  `optional_host_permissions: ["*://*/*"]` requires a per-site prompt
  the user has to accept.
- **"Privacy policy URL returns 404"** — make sure your StockPilot
  deployment has `/privacy/extension` reachable without login. The
  route is already `force-static` in `src/app/privacy/extension/page.tsx`.

Once approved, the listing URL looks like:

```
https://microsoftedge.microsoft.com/addons/detail/<extension-id>
```

Add that link to the ExtensionPanel UI so Edge users get a 1-click
install path.

## Also consider

- **Mozilla Add-ons (AMO)**: also free, but Firefox has ~3% market
  share among restaurant managers. Lower priority.
- **Chrome Web Store**: $5 one-time fee. Worth it — Chrome is ~80%
  of the market. If/when you pay, the submission package here works
  unchanged (same zip, same screenshots, same description).

---

## Files in this folder

- `STORE_DESCRIPTION.md` — short + detailed descriptions, copy/paste
- `PERMISSION_JUSTIFICATION.md` — what to tell the Edge reviewer
  about each permission and why it's needed
- `screenshots/` — 1280×800 screenshots of the extension in use
  (you'll need to generate these on your own install — instructions
  in `screenshots/README.md`)
- `scripts/generate-store-icon.mjs` — creates a 300×300 PNG from
  the existing 128×128 icon, with a white gradient background and
  rounded corners (Microsoft's recommended style).
