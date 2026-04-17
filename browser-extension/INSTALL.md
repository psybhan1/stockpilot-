# Install StockPilot — 90 seconds

You just unzipped the extension. **Keep this folder where it is** — the
browser reads the extension directly from this location. If you move or
delete this folder later, the extension breaks.

---

## Chrome / Brave / Edge / Arc

1. **Open your browser's extensions page.** Copy one of these into the
   address bar (the browser won't let you click them from here):

   ```
   chrome://extensions       ← Chrome / Brave / Arc
   edge://extensions         ← Microsoft Edge
   ```

2. **Turn on "Developer mode"** — the toggle is in the top-right corner
   of that page.

3. **Click "Load unpacked"** (new button that just appeared in the top-
   left). A file picker opens.

4. **Pick the folder that contains this file.** That's it — the browser
   adds the extension.

5. **Pin the StockPilot icon.** Click the puzzle-piece icon in your
   browser's toolbar, find StockPilot, click the pin next to it so the
   icon stays visible.

---

## Firefox

Firefox only runs unsigned extensions in Developer Edition or Nightly.
On regular Firefox the extension cannot be installed directly from
this folder; wait for us to publish to the Mozilla Add-ons store, or
use Chrome / Edge / Brave for now.

If you're on Developer Edition / Nightly:

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Pick `manifest.json` inside this folder
4. The extension runs until you restart Firefox; reload it after a restart

---

## Safari

Safari requires wrapping the extension in Xcode. Use Chrome / Edge /
Brave for now — we'll ship a Safari build later.

---

## After install — first use (60 seconds)

1. Click the StockPilot toolbar icon. It asks for your StockPilot URL
   (the one you log into — e.g. `https://stockpilot.yourcompany.com`).
   Paste it in.

2. The popup tells you to **link this browser** — clicking opens your
   StockPilot account. If you aren't already signed in, sign in; then
   open any supplier's sign-in page. The "Use browser extension" tab
   auto-links your browser on mount. Close the tab.

3. Open the supplier site you use (amazon.com, costco.com, lcbo.com…)
   in a regular tab. Sign in the way you normally would — complete
   2FA, solve captchas, whatever. **This is the step the extension
   exists for** — we need your real browser's signed-in session.

4. Click the StockPilot icon again. It auto-matches the current tab
   to the matching supplier. Click **💾 Push cookies to StockPilot**.
   That's it.

Going forward, whenever StockPilot's ordering bot needs to add items
to your cart at that supplier, it uses the session you just pushed.
No more typing passwords into forms.

---

## Troubleshooting

- **"This site isn't a supplier you've set up"** — the domain in the
  tab doesn't match any supplier in your StockPilot account. Either
  open the right supplier's tab or update the supplier's `website`
  field in StockPilot.
- **"No cookies found"** — you're not actually signed in on the
  current tab. Check that the site shows your name / account menu,
  then try again.
- **Extension icon does nothing when clicked** — go to
  `chrome://extensions` → StockPilot → Details → make sure Site
  access is set to "on all sites" or "on click".
- **"This browser isn't linked to StockPilot yet"** — the popup asks
  you to link the browser. Click the button; it opens StockPilot and
  mints a session cookie dedicated to the extension. Takes one second.

## Privacy

The extension reads cookies only for the supplier domain you're
looking at, only at the moment you click **Push cookies**. It does
not run in the background, does not read any other tab, and does
not send data anywhere except your own StockPilot server.

Full policy: open your StockPilot URL and visit `/privacy/extension`.
Source code for the extension is in this folder — every file is
readable JavaScript, no build step, nothing minified.
