"use strict";
// Minesweeper (minesweeper.html; rules in mines-core.js, players in players.js, ranking in api/scores.js).
// The first click asks the server for this game's seed (unranked with a local seed if there is no server);
// when the game ends, the list of opened cells is sent and the server checks it and times the game.
// Leaving the page (other tab, closed, phone locked) pauses the game: the board is covered and both clocks stop
// until Continue. The game in progress is kept on this device, so a reload brings it back paused.

(() => {
  const gridEl = document.getElementById("ms-grid");
  if (!gridEl || !window.Mines || !window.Players) return;
  const M = window.Mines, P = window.Players;
  const { el, store, fmt, api } = P;
  const $ = (id) => document.getElementById(id);

  let diff = M.DIFFS[store.get("mines-diff", "easy")] ? store.get("mines-diff", "easy") : "easy";
  let b = null;                 // board, created on the first click
  let game = null, opens = [], flags = new Set();
  let elapsedMs = 0, runSince = 0, paused = false, seed = null;
  let ticker = null, busy = false, flagMode = false, transposed = false;
  let ranking = null;           // null unknown, false off, true on

  const secs = P.secs;
  const dims = () => M.DIFFS[diff];

  // ---- board ---------------------------------------------------------------------------

  function layout() {
    const { w, h } = dims();
    const avail = Math.min($("ms").clientWidth, 900);
    transposed = w > h && avail / w < 24; // wide board on a narrow screen: turn it on its side
    const cols = transposed ? h : w;
    const cell = Math.max(18, Math.min(34, Math.floor((avail - 2) / cols)));
    gridEl.style.setProperty("--cell", `${cell}px`);
    gridEl.style.gridTemplateColumns = `repeat(${cols}, var(--cell))`;
    // each display slot shows one board cell; on a turned board, rows and columns swap
    gridEl.replaceChildren(...Array.from({ length: w * h }, (_, k) =>
      el("div", { className: "ms-cell" })));
    [...gridEl.children].forEach((c, k) => { c.dataset.i = transposed ? (k % h) * w + Math.floor(k / h) : k; });
    draw();
  }

  function draw() {
    const { m } = dims();
    for (const c of gridEl.children) {
      const i = Number(c.dataset.i);
      let cls = "ms-cell", txt = "";
      if (b && b.open[i]) {
        cls += " open";
        if (b.count[i]) { txt = b.count[i]; cls += ` n${b.count[i]}`; }
      } else if (b && b.over && b.mine[i]) {
        cls += i === b.boom ? " boom" : b.over === "won" ? " flag" : " mine";
        txt = b.over === "won" ? "⚑" : "●";
      } else if (flags.has(i)) {
        cls += b && b.over === "lost" && !b.mine[i] ? " flag wrong" : " flag";
        txt = "⚑";
      }
      if (c.className !== cls) c.className = cls;
      if (c.textContent !== String(txt)) c.textContent = txt;
    }
    $("ms-left").textContent = b && b.over === "won" ? 0 : m - flags.size;
    gridEl.classList.toggle("ended", !!(b && b.over));
    gridEl.classList.toggle("busy", busy);
    gridEl.classList.toggle("covered", paused);
    $("ms-cover").hidden = !paused;
    $("ms-go").textContent = busy ? "…" : "Continue";
  }

  const elapsed = () => elapsedMs + (runSince ? Date.now() - runSince : 0);
  function tick() { $("ms-time").textContent = secs(elapsed()); }

  // The game in progress, so a reload can bring it back.
  function save() {
    store.set("mines-game", b && !b.over
      ? { diff, seed, game, opens, flags: [...flags], elapsed: elapsed() }
      : null);
  }

  function reset() {
    b = null; game = null; opens = []; flags = new Set(); elapsedMs = 0; runSince = 0; paused = false; busy = false; seed = null;
    clearInterval(ticker); tick(); save();
    $("ms-result").textContent = "";
    document.querySelectorAll(".ms-diff button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.diff === diff)));
    layout();
  }

  async function firstClick(i) {
    busy = true; draw();
    seed = null;
    if (ranking !== false) {
      try {
        const p = await P.player();
        const s = await api("POST", { action: "mstart", id: p.id, key: p.key, diff });
        seed = s.seed; game = s.game; ranking = true;
      } catch (e) {
        if (e.status === 403) P.forget();
      }
    }
    if (seed === null) { seed = (Math.random() * 2 ** 32) >>> 0; game = null; } // unranked
    b = M.create(diff, seed, i);
    busy = false;
    elapsedMs = 0; runSince = Date.now();
    ticker = setInterval(tick, 100);
    reveal(i);
  }

  function reveal(i) {
    if (!b || b.over || flags.has(i) || b.open[i]) return;
    opens.push(i);
    M.open(b, i);
    if (b.over) end();
    save(); draw();
  }

  // Clicking an opened number whose flags are all placed opens the rest of its neighbours.
  function chord(i) {
    const around = M.neighbours(i, b.w, b.h);
    if (around.filter((j) => flags.has(j)).length !== b.count[i]) return;
    for (const j of around) if (!b.open[j] && !flags.has(j)) { reveal(j); if (b.over) break; }
  }

  function toggleFlag(i) {
    if (b && (b.over || b.open[i])) return;
    flags.has(i) ? flags.delete(i) : flags.add(i);
    save(); draw();
  }

  function press(i, asFlag) {
    if (busy || paused || (b && b.over)) return;
    if (asFlag) return toggleFlag(i);
    if (!b) return flags.has(i) ? undefined : firstClick(i);
    if (b.open[i]) chord(i); else reveal(i);
  }

  async function end() {
    clearInterval(ticker);
    const local = elapsed();
    elapsedMs = local; runSince = 0;
    tick();
    const res = $("ms-result");
    res.textContent = b.over === "won" ? `cleared in ${secs(local)}` : "boom.";
    if (!game) return;
    const p = P.current();
    try {
      const r = await api("POST", { action: "msubmit", id: p.id, key: p.key, game, opens: opens.join(",") });
      if (r.won) res.textContent = `cleared in ${secs(r.time)}` + (r.newBest ? " · new best" : "") + ` · rank ${r.rank} of ${fmt(r.players)}`;
    } catch { /* offline: the game just isn't counted */ }
    game = null;
    loadBoard();
  }

  // ---- pause when the page is left -----------------------------------------------------

  function serverClock(action) {
    const p = P.current();
    if (!game || !p) return null;
    const body = JSON.stringify({ action, id: p.id, key: p.key, game });
    if (action === "mpause" && navigator.sendBeacon) { // still gets sent while the page is closing
      navigator.sendBeacon("api/scores", new Blob([body], { type: "application/json" }));
      return null;
    }
    return fetch("api/scores", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }

  function pause() {
    if (!b || b.over || paused) return;
    elapsedMs = elapsed(); runSince = 0; paused = true;
    clearInterval(ticker); tick(); save(); draw();
    serverClock("mpause");
  }

  async function resume() {
    if (!paused || busy) return;
    busy = true; draw();
    await serverClock("mresume");
    busy = false; paused = false; runSince = Date.now();
    ticker = setInterval(tick, 100);
    draw();
  }

  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  addEventListener("pagehide", pause);

  // ---- input ---------------------------------------------------------------------------

  let pressTimer = null, longPressed = false;
  gridEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const c = e.target.closest(".ms-cell");
    if (c && !longPressed) press(Number(c.dataset.i), true);
  });
  gridEl.addEventListener("pointerdown", (e) => {
    longPressed = false;
    if (e.pointerType !== "touch") return;
    const c = e.target.closest(".ms-cell");
    if (!c) return;
    pressTimer = setTimeout(() => { longPressed = true; press(Number(c.dataset.i), true); navigator.vibrate?.(20); }, 380);
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach((t) => gridEl.addEventListener(t, () => clearTimeout(pressTimer)));
  gridEl.addEventListener("click", (e) => {
    const c = e.target.closest(".ms-cell");
    if (!c || longPressed) { longPressed = false; return; }
    press(Number(c.dataset.i), flagMode);
  });

  $("ms-flagmode").onclick = () => {
    flagMode = !flagMode;
    $("ms-flagmode").setAttribute("aria-pressed", String(flagMode));
    $("ms-flagmode").textContent = flagMode ? "⚑ flagging (tap to open instead)" : "⚑ flag mode";
  };
  $("ms-go").onclick = resume;
  $("ms-new").onclick = () => {
    if (b && !b.over && opens.length && !confirm("Start a new game? This one won't count.")) return;
    reset();
  };
  document.querySelectorAll(".ms-diff button").forEach((x) => {
    x.onclick = () => {
      if (b && !b.over && opens.length && !confirm("Start a new game? This one won't count.")) return;
      diff = x.dataset.diff; store.set("mines-diff", diff); reset(); loadBoard();
    };
  });
  let lastW = innerWidth;
  addEventListener("resize", () => { if (innerWidth !== lastW) { lastW = innerWidth; layout(); } });

  // ---- ranking -------------------------------------------------------------------------

  async function loadBoard() {
    ranking = await P.timedRanking("mines", diff, { me: "ms-me", top: "ms-top", title: "ms-rank-title", recovery: "ms-recovery" },
      () => { game = null; reset(); });
  }

  // Start: bring back an unfinished game (paused), or an empty board.
  const saved = store.get("mines-game", null);
  if (saved && M.DIFFS[saved.diff] && Number.isInteger(saved.seed) && Array.isArray(saved.opens) && saved.opens.length) {
    diff = saved.diff;
    reset();
    seed = saved.seed; game = saved.game || null; opens = [];
    b = M.create(diff, seed, saved.opens[0]);
    for (const i of saved.opens) { opens.push(i); M.open(b, i); }
    flags = new Set(saved.flags || []);
    elapsedMs = Number(saved.elapsed) || 0;
    if (b.over) reset(); else { paused = true; tick(); save(); draw(); }
  } else {
    reset();
  }
  loadBoard();
})();
