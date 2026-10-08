"use strict";
// game2: minesweeper (rules in mines-core.js, players in players.js, ranking in api/scores.js).
// The first click asks the server for this game's seed (unranked with a local seed if there is no server);
// when the game ends, the list of opened cells is sent and the server checks it and times the game.

(() => {
  const gridEl = document.getElementById("ms-grid");
  if (!gridEl || !window.Mines || !window.Players) return;
  const M = window.Mines, P = window.Players;
  const { el, store, fmt, api } = P;
  const $ = (id) => document.getElementById(id);

  let diff = M.DIFFS[store.get("mines-diff", "easy")] ? store.get("mines-diff", "easy") : "easy";
  let b = null;                 // board, created on the first click
  let game = null, opens = [], flags = new Set();
  let started = 0, ticker = null, busy = false, flagMode = false, transposed = false;
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
  }

  function tick() { $("ms-time").textContent = started ? secs(performance.now() - started) : "0.0 s"; }

  function reset() {
    b = null; game = null; opens = []; flags = new Set(); started = 0; busy = false;
    clearInterval(ticker); tick();
    $("ms-result").textContent = "";
    document.querySelectorAll(".ms-diff button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.diff === diff)));
    layout();
  }

  async function firstClick(i) {
    busy = true; draw();
    let seed = null;
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
    started = performance.now();
    ticker = setInterval(tick, 100);
    reveal(i);
  }

  function reveal(i) {
    if (!b || b.over || flags.has(i) || b.open[i]) return;
    opens.push(i);
    M.open(b, i);
    if (b.over) end();
    draw();
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
    draw();
  }

  function press(i, asFlag) {
    if (busy || (b && b.over)) return;
    if (asFlag) return toggleFlag(i);
    if (!b) return flags.has(i) ? undefined : firstClick(i);
    if (b.open[i]) chord(i); else reveal(i);
  }

  async function end() {
    clearInterval(ticker);
    const local = performance.now() - started;
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
  $("ms-new").onclick = reset;
  document.querySelectorAll(".ms-diff button").forEach((x) => {
    x.onclick = () => { diff = x.dataset.diff; store.set("mines-diff", diff); reset(); loadBoard(); };
  });
  let lastW = innerWidth;
  addEventListener("resize", () => { if (innerWidth !== lastW) { lastW = innerWidth; layout(); } });

  // ---- ranking -------------------------------------------------------------------------

  async function loadBoard() {
    ranking = await P.timedRanking("mines", diff, { me: "ms-me", top: "ms-top", title: "ms-rank-title", recovery: "ms-recovery" },
      () => { game = null; reset(); });
  }

  reset();
  loadBoard();
})();
