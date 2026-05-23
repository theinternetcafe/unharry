/**
 * unharry popup script
 * Manages the blocklist stored in browser.storage.local under key "blocklist".
 */

(function () {
  "use strict";

  const input   = document.getElementById("new-user");
  const btnAdd  = document.getElementById("btn-add");
  const list    = document.getElementById("user-list");
  const errMsg  = document.getElementById("error-msg");

  const norm = (s) => (s || "").trim().toLowerCase().replace(/^@/, "");

  let users = []; // ordered array of normalised usernames

  // ── Persist ──────────────────────────────────────────────────────────────────
  function save() {
    return browser.storage.local.set({ blocklist: users });
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  function render() {
    list.innerHTML = "";

    if (!users.length) {
      const li = document.createElement("li");
      li.className = "empty-msg";
      li.style.background = "transparent";
      li.style.justifyContent = "center";
      li.textContent = "No users blocked yet";
      list.appendChild(li);
      return;
    }

    users.forEach((username) => {
      const li  = document.createElement("li");
      const span = document.createElement("span");
      span.className = "username";
      span.textContent = username;

      const btn = document.createElement("button");
      btn.className = "btn-remove";
      btn.title = "Unblock";
      btn.textContent = "×";
      btn.addEventListener("click", () => remove(username));

      li.appendChild(span);
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  // ── Add ──────────────────────────────────────────────────────────────────────
  function add() {
    errMsg.textContent = "";
    const username = norm(input.value);

    if (!username) {
      errMsg.textContent = "Enter a username first.";
      return;
    }

    // Basic validity check: TradingView usernames are alphanumeric + underscores + hyphens
    if (!/^[a-z0-9_.\-]+$/i.test(username)) {
      errMsg.textContent = "Invalid username characters.";
      return;
    }

    if (users.includes(username)) {
      errMsg.textContent = `"${username}" is already blocked.`;
      return;
    }

    users.push(username);
    users.sort();
    save().then(() => {
      render();
      input.value = "";
      input.focus();
    });
  }

  // ── Remove ───────────────────────────────────────────────────────────────────
  function remove(username) {
    users = users.filter((u) => u !== username);
    save().then(render);
  }

  // ── Events ───────────────────────────────────────────────────────────────────
  btnAdd.addEventListener("click", add);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") add();
  });

  input.addEventListener("input", () => {
    errMsg.textContent = "";
  });

  // ── Init ─────────────────────────────────────────────────────────────────────
  const DEFAULT_BLOCKLIST = ["harry12345_"];

  browser.storage.local.get("blocklist").then((stored) => {
    if (!stored.blocklist) {
      // First run — seed the default list and persist it
      users = [...DEFAULT_BLOCKLIST];
      save();
    } else {
      users = stored.blocklist.map((u) => u.trim().toLowerCase());
    }
    render();
  });
})();
