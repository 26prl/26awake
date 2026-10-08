"use strict";
// 2048 page: the board (rules in g2048-core.js) and the ranking (api/scores.js).
// The game in progress (seed + moves), the best score and this device's player number are kept in localStorage.
// When the ranking server is set up, each game gets its seed from the server and is sent there when it ends
// (or when you start over); the server replays it to count the score. Without the server the game still works.

(() => {
  const board = document.getElementById("g8-board");
  if (!board || !window.G2048 || !window.Players) return;
  const core = window.G2048;
  const P = window.Players;
  const { el, store, fmt, who, api } = P;
  const $ = (id) => document.getElementById(id);
  const gridEl = $("g8-grid"), scoreEl = $("g8-score"), bestEl = $("g8-best");
  const overlay = $("g8-overlay"), msg = $("g8-msg"), keepBtn = $("g8-keep");

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

  async function newGame() {
    // Send the game being left (if it counts) before starting another.
    if (g && g.moves.length && phase !== "over") await finish();
    phase = "loading"; g = null; render();
    if (ranking !== false) {
      try {
        const p = await P.player();
        const s = await api("POST", { action: "start", id: p.id, key: p.key });
        ranking = true;
        return begin(s.seed, s.game);
      } catch (e) {
        if (e.status === 403) P.forget(); // unknown player (database reset): get a new number next time
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
    const p = P.current();
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
      ...(me.name ? [] : [P.nicknameForm(loadBoard)]));
  }

  async function loadBoard() {
    const box = $("g8-top");
    const p = P.current();
    let data;
    try { data = await api("GET", p ? `?id=${p.id}` : ""); } catch { data = { configured: false }; }
    if (!data.configured) {
      ranking = false;
      box.replaceChildren(el("p", { className: "muted small", textContent: "Rankings aren't switched on yet. Your best score is saved on this device." }));
      return;
    }
    ranking = true;
    // (re)draw the recovery panel when this device's player changes (e.g. just got a number)
    if ($("g8-recovery").dataset.player !== String(p?.id)) { recovery(); $("g8-recovery").dataset.player = String(p?.id); }
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

  // ---- recovery code (players.js); a game in progress still counts for the old number ----

  function recovery() {
    P.recoveryPanel($("g8-recovery"), {
      beforeSwitch: async () => { if (g && g.moves.length && phase !== "over") await finish(); await flush(); },
      afterSwitch: async () => { await loadBoard(); newGame(); },
    });
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
