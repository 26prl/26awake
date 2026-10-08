"use strict";
// Players shared by all games (2048, minesweeper, sudoku): this device's player number + secret key,
// the one-time nickname and the recovery code. Talks to api/scores.js. Exposes window.Players.

window.Players = (() => {
  const KEY = "player-2048"; // name kept from when 2048 was the only game, so existing players stay who they are
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids) if (k != null && k !== false) n.append(k);
    return n;
  };
  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const fmt = (n) => Number(n || 0).toLocaleString();
  const who = (p) => (p.name ? `${p.name}` : `#${p.id}`);

  async function api(method, payload) {
    const r = await fetch(method === "GET" ? `api/scores${payload || ""}` : "api/scores", {
      method, cache: "no-store",
      headers: method === "POST" ? { "Content-Type": "application/json" } : {},
      body: method === "POST" ? JSON.stringify(payload) : undefined,
    });
    if (!(r.headers.get("content-type") || "").includes("json")) throw new Error("no ranking server here");
    const data = await r.json();
    if (!r.ok) throw Object.assign(new Error(data.error || r.status), { status: r.status });
    return data;
  }

  const current = () => store.get(KEY, null);
  const forget = () => store.set(KEY, null);

  // This device's player, registering a new number the first time.
  async function player() {
    let p = current();
    if (p?.id && p?.key) return p;
    p = await api("POST", { action: "register" });
    store.set(KEY, p);
    return p;
  }

  // One nickname per player, chosen once; it stays with the player number (and the recovery code).
  function nicknameForm(onDone) {
    const input = el("input", { type: "text", maxLength: 20, placeholder: "nickname", autocomplete: "off", className: "g8-input g8-name" });
    const btn = el("button", { type: "button", className: "btn", textContent: "Set nickname" });
    const note = el("span", { className: "muted", textContent: "You can only choose it once." });
    btn.onclick = async () => {
      const name = input.value.trim().replace(/\s+/g, " ");
      if (!/^[\p{L}\p{N}_.\- ]{2,20}$/u.test(name)) { note.textContent = "2–20 letters, numbers, spaces or _ . -"; return; }
      if (!confirm(`Your nickname will be "${name}" forever. It can't be changed later. OK?`)) return;
      const p = current();
      try {
        await api("POST", { action: "name", id: p.id, key: p.key, name });
        onDone();
      } catch (e) {
        note.textContent = e.message === "nickname already set" ? "This player already has a nickname." : e.message;
        if (e.message === "nickname already set") onDone();
      }
    };
    return el("span", { className: "g8-nick" }, el("br"), input, " ", btn, " ", note);
  }

  // "show recovery code" + "use a recovery code". beforeSwitch() runs before this device becomes another
  // player (to send a game in progress for the old number), afterSwitch() after.
  function recoveryPanel(box, { beforeSwitch, afterSwitch } = {}) {
    const p = current();
    const out = el("p", { className: "small g8-code" });
    const status = el("p", { className: "small muted" });
    const input = el("input", { type: "text", placeholder: "26awake-…", autocomplete: "off", spellcheck: false, className: "g8-input" });
    const restore = el("button", { type: "button", className: "g8-reset", textContent: "restore" });

    const kids = [];
    if (p) {
      const show = el("button", { type: "button", className: "g8-reset", textContent: "show recovery code" });
      show.onclick = () => {
        const me = current() || p;
        const code = `26awake-${me.id}-${me.key}`;
        const copy = el("button", { type: "button", className: "g8-reset", textContent: "copy" });
        copy.onclick = async () => {
          try { await navigator.clipboard.writeText(code); copy.textContent = "copied"; } catch { copy.textContent = "select and copy it"; }
        };
        out.replaceChildren(el("code", { textContent: code }), " ", copy,
          el("br"), el("span", { className: "muted", textContent: "Keep it somewhere safe and don't share it: anyone with it can play as you." }));
        show.remove();
      };
      kids.push(el("p", { className: "small" }, show), out);
    }
    restore.onclick = async () => {
      const m = input.value.trim().match(/^(?:26awake-)?(\d+)-([a-f0-9]{32})$/i);
      if (!m) { status.textContent = "That doesn't look like a recovery code."; return; }
      const next = { id: Number(m[1]), key: m[2].toLowerCase() };
      status.textContent = "Checking…";
      try {
        await api("POST", { action: "whoami", ...next });
      } catch (e) {
        status.textContent = e.status === 403 ? "That code isn't right." : "Couldn't reach the server, try again.";
        return;
      }
      if (beforeSwitch) await beforeSwitch();
      store.set(KEY, next);
      status.textContent = "Welcome back.";
      input.value = "";
      recoveryPanel(box, { beforeSwitch, afterSwitch });
      if (afterSwitch) await afterSwitch();
    };
    kids.push(el("details", { className: "small" }, el("summary", { textContent: "use a recovery code" }),
      el("p", { className: "g8-restore" }, input, " ", restore), status));
    box.hidden = false;
    box.replaceChildren(...kids);
    dispatchEvent(new Event("relayout"));
  }

  const secs = (ms) => {
    const t = ms / 1000;
    return t < 60 ? `${t.toFixed(1)} s` : `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;
  };

  // Ranking panel for the timed games (fastest win per difficulty). Returns false when rankings are off.
  // ids: {me, top, title, recovery} element ids; onSwitch runs after this device became another player.
  async function timedRanking(kind, diff, ids, onSwitch) {
    const $ = (id) => document.getElementById(id);
    const box = $(ids.top), meBox = $(ids.me);
    const p = current();
    let data;
    try { data = await api("GET", `?game=${kind}&diff=${diff}` + (p ? `&id=${p.id}` : "")); } catch { data = { configured: false }; }
    if (!data.configured) {
      box.replaceChildren(el("p", { className: "muted small", textContent: "Rankings aren't switched on yet." }));
      return false;
    }
    const again = () => timedRanking(kind, diff, ids, onSwitch);
    const rec = $(ids.recovery);
    if (rec.dataset.player !== String(p?.id)) {
      recoveryPanel(rec, { afterSwitch: async () => { await onSwitch?.(); await again(); } });
      rec.dataset.player = String(p?.id);
    }
    // Sudoku can't be lost: count completed puzzles instead of "won of played".
    const finishOnly = kind === "sudoku";
    const losses = (m) => Math.max(0, (m.games || 0) - (m.wins || 0));
    const tally = (m) => finishOnly ? `${fmt(m.wins)} completed`
      : `${fmt(m.wins)} win${m.wins === 1 ? "" : "s"} · ${fmt(losses(m))} loss${losses(m) === 1 ? "" : "es"}`;
    const me = data.me;
    if (me) {
      meBox.replaceChildren(
        el("b", { textContent: me.name ? `${me.name} (#${me.id})` : `player #${me.id}` }),
        me.rank ? ` · ${diff}: rank ${me.rank} of ${fmt(me.players)}` : ` · no ${diff} ${finishOnly ? "puzzle completed" : "win"} yet`,
        el("br"),
        el("span", { className: "muted", textContent: (me.best !== null ? `best ${secs(me.best)} · ` : "") + tally(me) }),
        ...(me.name ? [] : [nicknameForm(again)]));
    } else {
      meBox.textContent = "Finish a game to get your player number and a rank.";
    }
    if (!data.top.length) {
      box.replaceChildren(el("p", { className: "muted small", textContent: `No ${diff} ${finishOnly ? "puzzles completed" : "wins"} yet — be the first.` }));
    } else {
      box.replaceChildren(el("table", { className: "g8-table" },
        el("thead", {}, el("tr", {}, ...["#", "player", "fastest", ...(finishOnly ? ["completed"] : ["wins", "losses"])].map((h) => el("th", { textContent: h })))),
        el("tbody", {}, ...data.top.map((r) => el("tr", { className: p && r.id === p.id ? "me" : "" },
          el("td", { textContent: r.rank }), el("td", { textContent: who(r) }),
          el("td", { textContent: secs(r.time) }), el("td", { textContent: fmt(r.wins) }),
          finishOnly ? null : el("td", { textContent: fmt(losses(r)) }))))));
    }
    $(ids.title).textContent = `Ranking · ${diff}`;
    dispatchEvent(new Event("relayout"));
    return true;
  }

  return { el, store, fmt, who, secs, api, current, forget, player, nicknameForm, recoveryPanel, timedRanking };
})();
