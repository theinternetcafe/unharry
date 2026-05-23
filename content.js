/**
 * unharry – TradingView Minds feed user filter
 *
 * Strategy:
 *  1. Load the blocklist from browser.storage.local.
 *  2. Scan the current page for Minds feed posts that belong to blocked users.
 *  3. Watch for dynamically injected posts via MutationObserver and filter them too.
 *  4. Listen for storage changes so a blocklist edit in the popup takes effect instantly.
 *
 * Username detection: TradingView links user profiles as /u/<username>/ in the DOM.
 * We locate those anchors inside each post card and compare against the blocklist.
 */

(function () {
  "use strict";

  // ── Normalise a username for comparison ─────────────────────────────────────
  const norm = (s) => (s || "").trim().toLowerCase();

  // ── Extract the TradingView username from a profile href ─────────────────────
  // Handles both /u/username/ and /u/username (no trailing slash)
  const RE_PROFILE = /\/u\/([^/?#]+)/i;
  function usernameFromHref(href) {
    const m = RE_PROFILE.exec(href || "");
    return m ? norm(m[1]) : null;
  }

  // ── Find the post card that contains only this one user ─────────────────────
  // Walk up from the username anchor, keeping track of the outermost ancestor
  // that still contains profile links for ONLY the blocked user. The moment we
  // step into an element that also links to other users (i.e. a shared feed
  // container), we stop and return the last safe candidate.
  // Hard cap of MAX_DEPTH levels to avoid climbing into <body>/<html>.
  const MAX_DEPTH = 15;

  function findCard(anchor, targetUser) {
    let el = anchor.parentElement;
    let candidate = null;
    let depth = 0;

    while (el && el !== document.body && depth < MAX_DEPTH) {
      const profileLinks = el.querySelectorAll('a[href*="/u/"]');
      const usersInEl = new Set();
      for (const a of profileLinks) {
        const u = usernameFromHref(a.getAttribute("href"));
        if (u) usersInEl.add(u);
      }

      if (usersInEl.size === 0) {
        // No profile links yet — keep climbing, this wrapper just hasn't loaded
        el = el.parentElement;
        depth++;
        continue;
      }

      if (usersInEl.size === 1 && usersInEl.has(targetUser)) {
        // Still a single-user subtree — this is a valid card candidate
        candidate = el;
        el = el.parentElement;
        depth++;
        continue;
      }

      // Multiple users in this element — we've overshot into a shared container
      break;
    }

    return candidate;
  }

  // ── Current blocklist (Set of normalised usernames) ──────────────────────────
  let blocklist = new Set();

  // ── Hide a single feed card ──────────────────────────────────────────────────
  function hideCard(card, username) {
    if (!card || card.dataset.unharryHidden) return;
    card.dataset.unharryHidden = "1";
    card.dataset.unharryUser = username;
    card.style.setProperty("display", "none", "important");
  }

  // ── Unhide cards for a username that was removed from the blocklist ──────────
  function unhideCardsFor(username) {
    const n = norm(username);
    document.querySelectorAll(`[data-unharry-hidden][data-unharry-user="${n}"]`)
      .forEach((el) => {
        el.removeAttribute("data-unharry-hidden");
        el.removeAttribute("data-unharry-user");
        el.style.removeProperty("display");
      });
  }

  // ── Scan a subtree for posts by blocked users ────────────────────────────────
  function scan(root) {
    if (!blocklist.size) return;

    // Find every profile link inside the root
    const anchors = root.querySelectorAll
      ? root.querySelectorAll('a[href*="/u/"]')
      : [];

    for (const a of anchors) {
      const user = usernameFromHref(a.getAttribute("href"));
      if (user && blocklist.has(user)) {
        const card = findCard(a, user);
        if (card) hideCard(card, user);
      }
    }
  }

  // ── MutationObserver – watch for newly added posts ───────────────────────────
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          scan(node);
        }
      }
    }
  });

  function startObserver() {
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Default blocklist (applied on first install before popup is opened) ──────
  const DEFAULT_BLOCKLIST = ["harry12345_"];

  // ── Initialise ───────────────────────────────────────────────────────────────
  function init(stored) {
    let users = stored.blocklist;
    if (!users) {
      // First run — seed defaults and persist so popup sees them too
      users = [...DEFAULT_BLOCKLIST];
      browser.storage.local.set({ blocklist: users });
    }
    blocklist = new Set(users.map(norm));
    scan(document.body);
    startObserver();
  }

  browser.storage.local.get("blocklist").then(init).catch(() => {
    blocklist = new Set(DEFAULT_BLOCKLIST.map(norm));
    startObserver();
  });

  // ── React to popup edits in real time ───────────────────────────────────────
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.blocklist) return;

    const oldList = (changes.blocklist.oldValue || []).map(norm);
    const newList = (changes.blocklist.newValue || []).map(norm);
    blocklist = new Set(newList);

    // Unhide cards for users that were removed
    oldList.forEach((u) => {
      if (!blocklist.has(u)) unhideCardsFor(u);
    });

    // Hide cards for newly added users
    scan(document.body);
  });
})();
