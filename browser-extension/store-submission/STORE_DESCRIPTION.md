# Store listing copy

Paste these into the Edge Add-ons / Chrome Web Store / AMO submission
form. The "short" description shows in search results; the "detailed"
one on the listing page.

## Display name (max 50 chars)

    StockPilot — Sign in helper

## Short description (max 132 chars)

    Save your supplier logins to StockPilot so the ordering bot can add items to your real cart — no password sharing.

## Detailed description

StockPilot is a restaurant-inventory app that auto-orders from your
suppliers (Amazon, Costco, LCBO, Sysco, Walmart, and more). To do
that, it needs a logged-in session at each supplier.

This extension is the *safe, one-click* way to give StockPilot that
session. You sign in to the supplier's real website normally — using
your own browser, with your own password, solving any captchas or 2FA
they throw at you. When you're signed in, click the StockPilot icon
in your toolbar and pick the supplier. The extension reads the
session cookies from that tab *only at that moment* and sends them
encrypted to your StockPilot server.

### Why you need this

Most supplier sites run bot detection that blocks headless or
automated browsers. There's no way to reliably sign in from
server-side — the only path that works is to start with a cookie jar
captured from a real human session. That's what this extension does,
and only that.

### What it reads

• Cookies for the supplier domain you're on, ONLY when you click
  "Push cookies to StockPilot"
• The current tab's URL, to auto-match the right supplier
• The StockPilot URL you entered on first run, saved locally

### What it DOES NOT read

• Browsing history, other tabs, page content, passwords
• Anything in the background — there's no background script
• Any site outside the supplier host you're on

### How the data is stored

Cookies land encrypted (AES-256-GCM) on your StockPilot database the
moment they arrive. They're only decrypted at order-dispatch time
inside StockPilot's browser-agent process. Never logged, never
emailed, never shown in plaintext.

### Who is this for

Restaurant managers using StockPilot to automate supplier ordering.
If you don't operate a StockPilot deployment, this extension does
nothing for you — it only talks to the URL you enter on first run,
which must be your StockPilot server.

### Open source

Every line of this extension is in the StockPilot repo at
https://github.com/<your-org>/stockpilot under `browser-extension/`.
About 500 lines of plain JavaScript, no minification, no build step.
Read it, audit it, modify it.

### Privacy policy

https://stockpilot.<your-domain>/privacy/extension

---

## Tags / keywords

    restaurant, inventory, supplier, ordering, automation, productivity,
    purchase orders, stock management

## Category

    Productivity
