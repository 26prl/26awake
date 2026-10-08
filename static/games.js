"use strict";
// 2048 page: the board (rules in g2048-core.js) and the ranking (api/scores.js).
// The game in progress (seed + moves), the best score and this device's player number are kept in localStorage.
// When the ranking server is set up, each game gets its seed from the server and is sent there when it ends
// (or when you start over); the server replays it to count the score. Without the server the game still works.

(() => {
  const board = document.getElementById("g8-board");
  if (!board || !window.G2048) return;
  const core = window.G2048;
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids) if (k != null && k !== false) n.append(k);
    return n;
  };
  const gridEl = $("g8-grid"), scoreEl = $("g8-score"), bestEl = $("g8-best");
  const overlay = $("g8-overlay"), msg = $("g8-msg"), keepBtn = $("g8-keep");
  const fmt = (n) => Number(n || 0).toLocaleString();
  const who = (p) => (p.name ? `${p.name}` : `#${p.id}`);

  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  let g = null;              // {cells, score, rng, moves}
  let meta = {};             // {seed, game (server id or null), won}
  let phase = "playing";     // playing | won | over | loading
  let best = store.get("best-2048", 0);
  let ranking = null;        // null = unknown, false = not set up, true = on
  const cellEls = Array.from({ length: 16 }, () => gridEl.appendChild(document.createElement("div")));

  // ---- board ---------------------------------------------------------------------------

  function render(fresh = [], merged = []) {
    (g ? g.cells : Array(16).fill(0)).forEach((v, i) => {
      const n = cellEls[i];
      n.className = "g8-cell" + (v ? ` v${v <= 2048 ? v : "max"}` : "") + (v >= 1024 ? " huge" : v >= 128 ? " big" : "")
        + (fresh.includes(i) ? " new" : merged.includes(i) ? " merged" : "");
      n.textContent = v || "";
    });
    scoreEl.textContent = fmt(g?.score);
    bestEl.textContent = fmt(best);
    overlay.hidden = phase === "playing" || phase === "loading";
    board.classList.toggle("loading", phase === "loading");
    if (phase === "won" || phase === "over") {
      msg.replaceChildren(
        el("span", { className: "g8-sub", textContent: phase === "won" ? "you reached 2048!" : "game over" }),
        el("strong", { className: "g8-big", textContent: fmt(g.score) }),
        el("span", { className: "g8-sub", id: "g8-result", textContent: g.score >= best && g.score > 0 ? "new best" : "" }));
      keepBtn.hidden = phase !== "won";
    }
  }

  const save = () => store.set("game-2048", { seed: meta.seed, moves: g.moves, game: meta.game, won: meta.won, over: phase === "over" });

  function begin(seed, gameId) {
    const s = core.start(seed);
    g = s.game; meta = { seed, game: gameId, won: false }; phase = "playing";
    render(s.fresh); save();
  }

  function move(dir) {
    if (phase !== "playing") return;
    const r = core.move(g, dir);
    if (!r) return;
    if (g.score > best) { best = g.score; store.set("best-2048", best); }
    if (!meta.won && g.cells.includes(2048)) { meta.won = true; phase = "won"; }
    else if (!core.canMove(g)) phase = "over";
    render(r.fresh >= 0 ? [r.fresh] : [], r.merged); save();
    if (phase === "over") finish();
  }

  // ---- ranking server ------------------------------------------------------------------

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

  async function player() {
    let p = store.get("player-2048", null);
    if (p?.id && p?.key) return p;
    p = await api("POST", { action: "register" });
    store.set("player-2048", p);
    recoveryPanel();
    return p;
  }

  async function newGame() {
    // Send the game being left (if it counts) before starting another.
    if (g && g.moves.length && phase !== "over") await finish();
    phase = "loading"; g = null; render();
    if (ranking !== false) {
      try {
        const p = await player();
        const s = await api("POST", { action: "start", id: p.id, key: p.key });
        ranking = true;
        return begin(s.seed, s.game);
      } catch (e) {
        if (e.status === 403) store.set("player-2048", null); // unknown player (database reset): get a new number next time
      }
    }
    begin((Math.random() * 2 ** 32) >>> 0, null); // unranked game
  }

  // Send a finished (or abandoned) game. Kept in a queue until the server has it.
  async function finish() {
    if (!meta.game) return;
    const queue = store.get("pending-2048", []);
    queue.push({ game: meta.game, moves: g.moves });
    meta.game = null; save();
    store.set("pending-2048", queue);
    await flush();
  }

  async function flush() {
    let queue = store.get("pending-2048", []);
    const p = store.get("player-2048", null);
    if (!queue.length || !p) return;
    for (const item of [...queue]) {
      try {
        const r = await api("POST", { action: "submit", id: p.id, key: p.key, ...item });
        showStanding(r);
        if (r.newBest) $("g8-result") && ($("g8-result").textContent = `new personal best · rank ${r.rank} of ${r.players}`);
        else if ($("g8-result")) $("g8-result").textContent = `rank ${r.rank} of ${r.players}`;
      } catch (e) {
        if (!e.status || e.status >= 500) break; // offline: try again later
        // 4xx: the server won't take it (already counted, expired); drop it
      }
      queue = queue.filter((q) => q.game !== item.game);
      store.set("pending-2048", queue);
    }
    loadBoard();
  }

  // ---- ranking panel -------------------------------------------------------------------

  function showStanding(me) {
    const box = $("g8-me");
    if (!me) return;
    box.replaceChildren(
      el("b", { textContent: me.name ? `${me.name} (#${me.id})` : `player #${me.id}` }),
      me.rank ? ` · rank ${me.rank} of ${fmt(me.players)}` : " · no ranked game yet",
      el("br"),
      el("span", { className: "muted", textContent:
        `best ${fmt(me.best)} · ${fmt(me.games)} game${me.games === 1 ? "" : "s"} · ${fmt(me.points)} points in total` +
        (me.tile ? ` · biggest tile ${fmt(me.tile)}` : "") }),
      ...(me.name ? [] : [nicknameForm()]));
  }

  // One nickname per player, chosen once; it stays with the player number (and the recovery code).
  function nicknameForm() {
    const input = el("input", { type: "text", maxLength: 20, placeholder: "nickname", autocomplete: "off", className: "g8-input g8-name" });
    const btn = el("button", { type: "button", className: "btn", textContent: "Set nickname" });
    const note = el("span", { className: "muted", textContent: "You can only choose it once." });
    btn.onclick = async () => {
      const name = input.value.trim().replace(/\s+/g, " ");
      if (!/^[\p{L}\p{N}_.\- ]{2,20}$/u.test(name)) { note.textContent = "2–20 letters, numbers, spaces or _ . -"; return; }
      if (!confirm(`Your nickname will be "${name}" forever. It can't be changed later. OK?`)) return;
      const p = store.get("player-2048", null);
      try {
        const me = await api("POST", { action: "name", id: p.id, key: p.key, name });
        showStanding(me);
        loadBoard();
      } catch (e) {
        note.textContent = e.message === "nickname already set" ? "This player already has a nickname." : e.message;
        if (e.message === "nickname already set") loadBoard();
      }
    };
    return el("span", { className: "g8-nick" }, el("br"), input, " ", btn, " ", note);
  }

  async function loadBoard() {
    const box = $("g8-top");
    const p = store.get("player-2048", null);
    let data;
    try { data = await api("GET", p ? `?id=${p.id}` : ""); } catch { data = { configured: false }; }
    if (!data.configured) {
      ranking = false;
      box.replaceChildren(el("p", { className: "muted small", textContent: "Rankings aren't switched on yet. Your best score is saved on this device." }));
      return;
    }
    ranking = true;
    $("g8-recovery").hidden = false;
    if (!$("g8-recovery").children.length) recoveryPanel();
    if (data.me) showStanding(data.me);
    else $("g8-me").textContent = "Finish a game to get your player number and a rank.";
    if (!data.top.length) {
      box.replaceChildren(el("p", { className: "muted small", textContent: "No ranked games yet — be the first." }));
      return;
    }
    box.replaceChildren(el("table", { className: "g8-table" },
      el("thead", {}, el("tr", {}, ...["#", "player", "best", "tile", "games"].map((h) => el("th", { textContent: h })))),
      el("tbody", {}, ...data.top.map((r) => el("tr", { className: p && r.id === p.id ? "me" : "" },
        el("td", { textContent: r.rank }), el("td", { textContent: who(r) }), el("td", { textContent: fmt(r.score) }),
        el("td", { textContent: r.tile ? fmt(r.tile) : "–" }), el("td", { textContent: fmt(r.games) }))))));
    dispatchEvent(new Event("relayout"));
  }

  // ---- recovery code: player number + key, to keep the same player on another browser or device ----

  const codeOf = (p) => `26awake-${p.id}-${p.key}`;

  function recoveryPanel() {
    const box = $("g8-recovery");
    const p = store.get("player-2048", null);
    const out = el("p", { className: "small g8-code" });
    const status = el("p", { className: "small muted" });
    const input = el("input", { type: "text", placeholder: "26awake-…", autocomplete: "off", spellcheck: false, className: "g8-input" });
    const restore = el("button", { type: "button", className: "g8-reset", textContent: "restore" });

    const kids = [];
    if (p) {
      const show = el("button", { type: "button", className: "g8-reset", textContent: "show recovery code" });
      show.onclick = () => {
        const code = codeOf(store.get("player-2048", p));
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
      if (g && g.moves.length && phase !== "over") await finish(); // the game in progress still counts for the old number
      await flush();
      store.set("player-2048", next);
      status.textContent = "Welcome back.";
      input.value = "";
      await loadBoard();
      recoveryPanel();
      newGame();
    };
    kids.push(el("details", { className: "small" }, el("summary", { textContent: "use a recovery code" }),
      el("p", { className: "g8-restore" }, input, " ", restore), status));
    box.replaceChildren(...kids);
    dispatchEvent(new Event("relayout"));
  }

  // ---- controls ------------------------------------------------------------------------

  const KEYS = { ArrowLeft: "L", ArrowRight: "R", ArrowUp: "U", ArrowDown: "D", a: "L", d: "R", w: "U", s: "D",
                 A: "L", D: "R", W: "U", S: "D" };
  // Keys play while the board is mostly on screen (or after it was clicked), so elsewhere the arrows still scroll.
  let armed = false, inView = false;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => { inView = e.intersectionRatio >= 0.6; }, { threshold: [0, 0.6, 1] }).observe(board);
  }
  board.addEventListener("pointerdown", () => { armed = true; board.focus({ preventScroll: true }); });
  document.addEventListener("pointerdown", (e) => { if (!board.contains(e.target)) armed = false; });
  document.addEventListener("keydown", (e) => {
    const d = KEYS[e.key];
    if (!d || !(armed || inView || document.activeElement === board) || e.target.matches?.("input, textarea")) return;
    e.preventDefault();
    move(d);
  });

  let touch = null;
  board.addEventListener("touchstart", (e) => { touch = e.touches[0]; }, { passive: true });
  board.addEventListener("touchend", (e) => {
    if (!touch) return;
    const t = e.changedTouches[0], dx = t.clientX - touch.clientX, dy = t.clientY - touch.clientY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 24) move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U"));
    touch = null;
  });

  const focus = () => { board.focus({ preventScroll: true }); armed = true; };
  $("g8-new").onclick = () => { newGame(); focus(); };
  $("g8-reset").onclick = () => { newGame(); focus(); };
  keepBtn.onclick = () => { phase = "playing"; render(); save(); focus(); };

  // ---- start: resume this device's game, or begin a new one -----------------------------

  (async () => {
    await loadBoard();
    flush();
    const saved = store.get("game-2048", null);
    if (saved && Number.isInteger(saved.seed) && typeof saved.moves === "string") {
      const s = core.start(saved.seed);
      for (const d of saved.moves) if (!core.move(s.game, d)) break;
      g = s.game; meta = { seed: saved.seed, game: saved.game || null, won: !!saved.won };
      phase = saved.over || !core.canMove(g) ? "over" : "playing";
      render();
      if (phase === "over" && meta.game) finish();
    } else {
      newGame();
    }
  })();
})();
