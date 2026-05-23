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

  // ── Find the post card for a blocked user ────────────────────────────────────
  //
  // Strategy A — "author is first" (primary, handles Minds posts with comment previews)
  //   Walk up while the target user is the FIRST /u/ link in each ancestor AND
  //   the ancestor has ≤ MAX_LINKS profile links total. This correctly traverses
  //   past the author-byline section into the full post card, stopping when we
  //   hit the shared feed container (where a different user appears first, or
  //   link count spikes).
  //
  // Strategy B — "single unique user" (fallback, handles edge cases)
  //   Some cards have a follow-button or a "related" chip above the author that
  //   links to another /u/ profile, making Strategy A fail on the very first
  //   step. Strategy B ignores ordering and just requires that each ancestor
  //   contains only the target user's profile links. Tighter depth cap (8) to
  //   avoid overshooting in the absence of the density guard.
  //
  // Returns the best (most specific) candidate from whichever strategy succeeds,
  // or null if neither can identify a safe card.
  //
  const MAX_DEPTH = 15;
  const MAX_LINKS = 20; // more than this → feed-level container, not a card

  function findCardStrategyA(anchor, targetUser) {
    let el = anchor.parentElement;
    let candidate = null;
    let depth = 0;

    while (el && el !== document.body && depth < MAX_DEPTH) {
      const links = el.querySelectorAll('a[href*="/u/"]');

      if (links.length === 0) { el = el.parentElement; depth++; continue; }
      if (links.length > MAX_LINKS) break;

      const firstUser = usernameFromHref(links[0].getAttribute("href"));
      if (firstUser !== targetUser) break;

      candidate = el;
      el = el.parentElement;
      depth++;
    }

    return candidate;
  }

  function findCardStrategyB(anchor, targetUser) {
    let el = anchor.parentElement;
    let candidate = null;
    let depth = 0;
    const DEPTH_CAP = 8;

    while (el && el !== document.body && depth < DEPTH_CAP) {
      const links = el.querySelectorAll('a[href*="/u/"]');

      if (links.length === 0) { el = el.parentElement; depth++; continue; }

      const users = new Set();
      for (const a of links) {
        const u = usernameFromHref(a.getAttribute("href"));
        if (u) users.add(u);
      }

      if (users.size === 1 && users.has(targetUser)) {
        candidate = el;
        el = el.parentElement;
        depth++;
        continue;
      }

      break;
    }

    return candidate;
  }

  function findCard(anchor, targetUser) {
    return findCardStrategyA(anchor, targetUser)
        || findCardStrategyB(anchor, targetUser);
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
    if (!blocklist.size || !root || !root.querySelectorAll) return;

    const hidden = new WeakSet(); // avoid hiding the same card twice per scan

    // Primary pass: /u/username/ profile links (covers most Minds posts)
    for (const a of root.querySelectorAll('a[href*="/u/"]')) {
      const user = usernameFromHref(a.getAttribute("href"));
      if (!user || !blocklist.has(user)) continue;
      const card = findCard(a, user);
      if (card && !hidden.has(card)) { hidden.add(card); hideCard(card, user); }
    }

    // Fallback pass: search for the username string anywhere in an href.
    // Catches profiles that use a different URL pattern (e.g. /p/username/,
    // or any future TradingView URL change). Only runs for users not already
    // fully handled above. CSS "i" flag makes the match case-insensitive.
    for (const username of blocklist) {
      let selector;
      try {
        selector = `a[href*="${CSS.escape(username)}" i]`;
      } catch (_) {
        continue; // CSS.escape failure on exotic chars — skip
      }

      for (const a of root.querySelectorAll(selector)) {
        // Skip anchors already handled by the primary /u/ pass
        if (/\/u\//i.test(a.getAttribute("href") || "")) continue;
        const card = findCard(a, username);
        if (card && !hidden.has(card)) { hidden.add(card); hideCard(card, username); }
      }
    }
  }

  // ── Debounced scan ───────────────────────────────────────────────────────────
  // TradingView renders feed items in bursts of many small DOM mutations. If we
  // scan mid-burst, findCard may climb into a half-built ancestor that doesn't
  // yet have the comment-preview links that would normally stop the ascent,
  // causing it to overshoot into a sidebar or page-level wrapper.
  //
  // Solution: collect the added nodes from each burst, then scan them all in one
  // pass 250 ms after the burst goes quiet. By then TradingView has finished
  // populating the card and the link-density check works correctly.
  let debounceTimer = null;
  const pendingNodes = new Set();

  function scheduleScan(nodes) {
    if (nodes) nodes.forEach((n) => pendingNodes.add(n));
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (pendingNodes.size) {
        pendingNodes.forEach((n) => scan(n));
        pendingNodes.clear();
      } else {
        scan(document.body);
      }
    }, 250);
  }

  // ── MutationObserver – watch for newly added posts ───────────────────────────
  const observer = new MutationObserver((mutations) => {
    const added = [];
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) added.push(node);
      }
    }
    if (added.length) scheduleScan(added);
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

    // Unhide cards for users that were removed (safe to do immediately)
    oldList.forEach((u) => {
      if (!blocklist.has(u)) unhideCardsFor(u);
    });

    // Debounce the hide scan — the popup may fire while TradingView is still
    // mid-render, which would cause findCard to overshoot into a sidebar wrapper.
    // Waiting 250 ms lets the DOM settle before we walk it.
    scheduleScan(null);
  });
})();
