# unharry

A Firefox extension that removes posts by specific users from the [TradingView Minds](https://www.tradingview.com/ideas/) feed. Blocked users are configurable — add or remove anyone from the popup without touching code.

---

## Installation

Firefox does not allow loading unsigned local extensions permanently by default, so you have two options depending on how you plan to use unharry.

### Option A — Temporary (easiest, works in any Firefox)

This is the quickest way to try it out. The extension will be active until you close Firefox or restart it.

1. Download or clone this repository so you have the `unharry/` folder on your computer.
2. Open Firefox and navigate to `about:debugging`.
3. Click **This Firefox** in the left sidebar.
4. Click **Load Temporary Add-on…**.
5. Navigate into the `unharry/` folder and select `manifest.json`.
6. The **unharry** button will appear in your Firefox toolbar.

> The extension stays active for the current Firefox session. You will need to reload it each time you restart Firefox.

---

### Option B — Permanent (Firefox Developer Edition or Nightly)

Firefox Developer Edition and Firefox Nightly both allow permanently loading unsigned local extensions. This is the recommended setup if you want unharry to always be active.

1. Install [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/) or [Firefox Nightly](https://www.mozilla.org/firefox/nightly/).
2. Open the browser and navigate to `about:config`.
3. Search for `xpinstall.signatures.required` and set it to **false**.
4. Navigate to `about:addons`.
5. Click the gear icon → **Install Add-on From File…**.
6. To package unharry as an installable `.xpi` file, zip the contents of the `unharry/` folder (not the folder itself — select all files inside it) and rename the resulting `.zip` to `unharry.xpi`.
7. Select the `unharry.xpi` file. Firefox will install it permanently.

> Changing `xpinstall.signatures.required` to false only works in Developer Edition and Nightly. It has no effect in standard Firefox release builds.

---

## Managing blocked users

Click the **unharry** button in the Firefox toolbar to open the popup.

- **Block a user:** Type their TradingView username into the text field and click **Block** (or press Enter). You do not need to include the `@` symbol.
- **Unblock a user:** Click the **×** next to their name in the list.

Changes take effect immediately on any open TradingView tab — no page reload required.

The blocklist is stored locally in your browser (`browser.storage.local`) and never leaves your machine.

---

## Default blocked users

unharry ships with the following users pre-blocked:

- `harry12345_`

You can remove them from the popup at any time.

---

## How it works

A content script runs on every `tradingview.com` page. It watches the Minds feed for posts and checks each one for a link to a blocked user's profile (`/u/<username>/`). When a match is found, that post card is hidden. A `MutationObserver` catches posts that load dynamically as you scroll.

---

## Files

```
unharry/
├── manifest.json   Extension manifest (permissions, content script registration)
├── content.js      Feed filtering logic and MutationObserver
├── popup.html      Blocklist manager UI
└── popup.js        Popup logic and storage management
```
