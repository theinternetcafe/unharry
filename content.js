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

  // ── Find the post card for the blocked user ──────────────────────────────────
  //
  // Two-phase strategy that handles both comments (single-user cards) and Minds
  // posts (multi-user cards where other users appear in comment previews):
  //
  // Phase 1 — climb while the blocked user is the FIRST profile link.
  //   In any well-structured post card the author link comes first in the DOM.
  //   We keep climbing as long as that invariant holds, updating `candidate`
  //   each time. The moment a different user appears as the first link we have
  //   crossed into the feed container — stop.
  //
  // Phase 2 — safety cap on link density.
  //   If an ancestor contains more than MAX_LINKS profile links it is almost
  //   certainly a feed-level wrapper (dozens of posts), not a single card.
  //   Stop there regardless of who is first.
  //
  // Hard limit: MAX_DEPTH levels, never reach <body>.
  const MAX_DEPTH = 15;
  const MAX_LINKS = 20; // more than this → feed container, not a single card

  function findCard(anchor, targetUser) {
    let el = anchor.parentElement;
    let candidate = null;
    let depth = 0;

    while (el && el !== document.body && depth < MAX_DEPTH) {
      const profileLinks = el.querySelectorAll('a[href*="/u/"]');

      if (profileLinks.length === 0) {
        // No profile links yet — plain wrapper, keep climbing
        el = el.parentElement;
        depth++;
        continue;
      }

      // Too many links → definitely a feed container, stop
      if (profileLinks.length > MAX_LINKS) break;

      // The blocked user must be the first profile link (i.e. the author).
      // If someone else is first we have climbed too high.
      const firstUser = usernameFromHref(profileLinks[0].getAttribute("href"));
      if (firstUser !== targetUser) break;

      candidate = el;
      el = el.parentElement;
      depth++;
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
