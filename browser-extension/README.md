# StockPilot — Sign in helper (browser extension)

A tiny Chrome extension that lets a restaurant manager sign in to their
supplier's real website (amazon.com, costco.com, lcbo.com…) in a normal
tab, then push their session to StockPilot with one click. No typing
passwords into StockPilot. No streamed browser in an iframe. Just a
cookie push.

## Why this exists

Some supplier sites have strong bot detection (Amazon, Costco) that
blocks headless browsers — even the realistic ones. The reliable way
to automate ordering on those sites is to start with a cookie jar that
came from a real human-piloted session. This extension is the least
friction way to produce that jar.

## Install (developer / sideload mode)

1. Grab `stockpilot-extension.zip` from the StockPilot app (any supplier's
   sign-in page has a download link in the "Use browser extension" tab).
2. Unzip it anywhere on your computer.
3. Open `chrome://extensions` in Chrome (or `edge://extensions` in Edge).
4. Toggle **Developer mode** on (top right).
5. Click **Load unpacked**, point it at the unzipped folder.
6. Pin the StockPilot icon to your toolbar (puzzle icon → pin).

## First-time use

1. Click the StockPilot icon. The popup asks for your StockPilot URL
   (e.g. `https://stockpilot.yourcompany.com`). Paste it in.
2. If you aren't already signed in to StockPilot in this browser, the
   popup tells you to open StockPilot and sign in once. Come back.
3. Open, say, `www.amazon.com` in a normal tab. Sign in. Complete any
   2FA. Browse normally — nothing special to do.
4. Click the StockPilot icon again. The popup auto-matches your current
   tab to the right supplier in StockPilot. Click **Push cookies to
   StockPilot**.
5. Done. StockPilot now has an authenticated session for that supplier
   and can add items to the cart on your behalf when the Telegram bot
   asks it to.

## What the extension can read

- **Cookies for the supplier's domain only**, and only the moment you
  press "Push cookies". We call `chrome.cookies.getAll({ domain })`
  scoped to the active tab's domain — we don't poll, we don't read
  cookies from other sites, and we don't have a background script at
  all.
- **The StockPilot URL you entered**, stored in `chrome.storage.local`.
- **The active tab's URL**, to auto-select the matching supplier.

That's it. No browsing history, no page content, no password access,
no remote syncing. The source is in this folder (~300 lines of JS), go
read it.

## What the extension sends

One POST per click, to your StockPilot URL:

```
POST https://stockpilot.yourcompany.com/api/suppliers/<id>/credentials/from-extension
Cookie: stockpilot_session=<your StockPilot session cookie>
Content-Type: application/json

{ "cookies": [ { "name": "...", "value": "...", "domain": "...", ... }, ... ] }
```

The server encrypts the cookies with AES-256-GCM before they land in
the database. They're only decrypted at order-dispatch time, inside
the browser-agent process, never logged.

## Uninstalling

`chrome://extensions` → StockPilot → Remove. Nothing else to clean up;
stored data lives in `chrome.storage.local` and is cleaned up
automatically. The cookies the extension pushed to StockPilot stay on
your account until you delete them from the Supplier settings page.

## Troubleshooting

**"This site isn't a supplier you've set up"** — make sure the supplier
in StockPilot has its `website` set to something that matches the
domain (e.g. `amazon.com`). If you added the supplier with a full URL
like `https://amazon.com/foo`, that works too — we strip back to the
host when matching.

**"No cookies found"** — you're not actually signed in on the current
tab. Check the site shows your name / account menu, then retry.

**Extension icon does nothing** — you might have the popup blocked. In
`chrome://extensions` click the **Details** for StockPilot and make
sure **Site access** is set to on-click or all sites.

**"Sign in to StockPilot in this browser first"** — open your
StockPilot URL, sign in, come back.

## Development

Edit `popup.html`, `popup.css`, `popup.js`, `manifest.json` directly
and reload the extension from `chrome://extensions` → Reload.

To regenerate the placeholder icons:

```
node scripts/generate-icons.mjs
```

To rebuild the zip for distribution:

```
node scripts/build-zip.mjs
```

That writes `../public/downloads/stockpilot-extension.zip` so the app
can serve it from `/downloads/stockpilot-extension.zip`.
