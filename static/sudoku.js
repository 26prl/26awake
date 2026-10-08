"use strict";
// Sudoku (sudoku.html; rules and puzzle maker in sudoku-core.js, players in players.js, ranking in api/scores.js).
// Each puzzle comes from a server seed (a local one when there is no server). When the grid is full and right,
// it's sent to the server, which rebuilds the puzzle, checks the grid and times the solve itself.
// The puzzle in progress (with pencil notes) is kept on this device.
// Nothing is timed until Start is pressed, and leaving the page (other tab, closed, phone locked) pauses the
// game: the board is covered and both the page's clock and the server's clock stop until Continue.

(() => {
  const gridEl = document.getElementById("sd-grid");
  if (!gridEl || !window.Sudoku || !window.Players) return;
  const S = window.Sudoku, P = window.Players;
  const { el, store, fmt, api, secs } = P;
  const $ = (id) => document.getElementById(id);

  let diff = S.DIFFS[store.get("sudoku-diff", "easy")] ? store.get("sudoku-diff", "easy") : "easy";
  let g = null;       // {diff, seed, game, puzzle[], entries[], notes[], elapsed, runSince, solved, time}
  let phase = "idle"; // idle (Start button) | running | paused (Continue button) | solved
  let sel = -1, notesMode = false, ticker = null, ranking = null, busy = false;

  const save = () => store.set("sudoku-game", g);
  const cells = Array.from({ length: 81 }, (_, i) => {
    const c = el("div", { className: "sd-cell" });
    c.dataset.i = i;
    if (S.COL(i) % 3 === 2 && S.COL(i) < 8) c.classList.add("bR");
    if (S.ROW(i) % 3 === 2 && S.ROW(i) < 8) c.classList.add("bB");
    return gridEl.appendChild(c);
  });

  // ---- drawing -------------------------------------------------------------------------

  function draw() {
    const v = g ? g.entries : new Array(81).fill(0);
    const selVal = sel >= 0 ? v[sel] : 0;
    const counts = new Array(10).fill(0);
    v.forEach((d) => counts[d]++);
    cells.forEach((c, i) => {
      const d = v[i];
      const conflict = d && S.PEERS[i].some((j) => v[j] === d);
      let cls = "sd-cell" + (c.classList.contains("bR") ? " bR" : "") + (c.classList.contains("bB") ? " bB" : "");
      if (g && g.puzzle[i]) cls += " given";
      if (i === sel) cls += " sel";
      else if (sel >= 0 && (S.ROW(i) === S.ROW(sel) || S.COL(i) === S.COL(sel) || S.BOX(i) === S.BOX(sel))) cls += " zone";
      if (selVal && d === selVal && i !== sel) cls += " same";
      if (conflict && !(g && g.puzzle[i])) cls += " bad";
      if (c.className !== cls) c.className = cls;
      if (d) {
        if (c.textContent !== String(d) || c.firstChild?.nodeType !== 3) c.textContent = d;
      } else if (g && g.notes[i]) {
        const marks = Array.from({ length: 9 }, (_, k) => el("span", { textContent: g.notes[i] & (1 << (k + 1)) ? k + 1 : "" }));
        c.replaceChildren(el("div", { className: "sd-notes" }, ...marks));
      } else if (c.textContent) c.textContent = "";
    });
    document.querySelectorAll(".sd-pad [data-d]").forEach((b) => { b.disabled = counts[Number(b.dataset.d)] >= 9; });
    $("sd-notes").setAttribute("aria-pressed", String(notesMode));
    gridEl.classList.toggle("busy", busy);
    gridEl.classList.toggle("done", !!(g && g.solved));
    gridEl.classList.toggle("covered", phase === "idle" || phase === "paused");
    const cover = $("sd-cover");
    cover.hidden = !(phase === "idle" || phase === "paused");
    $("sd-cover-text").textContent = phase === "paused" ? "paused" : `${diff} sudoku`;
    $("sd-go").textContent = busy ? "…" : phase === "paused" ? "Continue" : "Start";
  }

  const elapsed = () => (g ? g.elapsed + (g.runSince ? Date.now() - g.runSince : 0) : 0);

  function tick() {
    $("sd-time").textContent = secs(g ? (g.solved ? g.time : elapsed()) : 0);
  }

  // ---- game ----------------------------------------------------------------------------

  // Back to the Start button (for the chosen difficulty). The previous unfinished puzzle doesn't count.
  function newGame() {
    g = null; sel = -1; phase = "idle"; clearInterval(ticker);
    store.set("sudoku-game", null);
    $("sd-result").textContent = "";
    document.querySelectorAll(".ms-diff button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.diff === diff)));
    tick(); draw();
  }

  // Start: get the seed from the server (its clock starts now), make the puzzle, start the timer.
  async function startGame() {
    busy = true; draw();
    let seed = null, game = null;
    if (ranking !== false) {
      try {
        const p = await P.player();
        const s = await api("POST", { action: "sstart", id: p.id, key: p.key, diff });
        seed = s.seed; game = s.game;
      } catch (e) {
        if (e.status === 403) P.forget();
      }
    }
    if (seed === null) seed = (Math.random() * 2 ** 32) >>> 0; // unranked
    const { puzzle } = S.make(diff, seed);
    g = { diff, seed, game, puzzle, entries: puzzle.slice(), notes: new Array(81).fill(0), elapsed: 0, runSince: Date.now(), solved: false };
    busy = false; phase = "running";
    save(); run(); draw();
  }

  function run() {
    clearInterval(ticker); tick();
    ticker = setInterval(tick, 100);
  }

  function serverClock(action) {
    const p = P.current();
    if (!g || !g.game || !p) return null;
    const body = JSON.stringify({ action, id: p.id, key: p.key, game: g.game });
    if (action === "spause" && navigator.sendBeacon) { // still gets sent while the page is closing
      navigator.sendBeacon("api/scores", new Blob([body], { type: "application/json" }));
      return null;
    }
    return fetch("api/scores", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }

  function pause() {
    if (phase !== "running") return;
    g.elapsed = elapsed(); g.runSince = 0; phase = "paused";
    clearInterval(ticker); tick(); save(); draw();
    serverClock("spause");
  }

  async function resume() {
    if (phase !== "paused") return;
    busy = true; draw();
    await serverClock("sresume");
    busy = false; g.runSince = Date.now(); phase = "running";
    save(); run(); draw();
  }

  function put(d) {
    if (!g || phase !== "running" || sel < 0 || g.puzzle[sel]) return;
    if (notesMode && d) {
      if (!g.entries[sel]) g.notes[sel] ^= 1 << d;
    } else {
      g.entries[sel] = g.entries[sel] === d ? 0 : d;
      g.notes[sel] = 0;
      if (d && g.entries[sel]) for (const j of S.PEERS[sel]) g.notes[j] &= ~(1 << d); // tidy notes it rules out
    }
    save(); draw();
    if (g.entries.every(Boolean) && S.check(g.puzzle, g.entries)) solved();
  }

  async function solved() {
    g.time = elapsed(); g.elapsed = g.time; g.runSince = 0; g.solved = true; phase = "solved"; save();
    clearInterval(ticker); tick(); draw();
    const res = $("sd-result");
    res.textContent = `solved in ${secs(g.time)}`;
    if (!g.game) return;
    const p = P.current();
    try {
      const r = await api("POST", { action: "ssubmit", id: p.id, key: p.key, game: g.game, grid: g.entries.join("") });
      res.textContent = `solved in ${secs(r.time)}` + (r.newBest ? " · new best" : "") + ` · rank ${r.rank} of ${fmt(r.players)}`;
    } catch { /* offline: not counted */ }
    g.game = null; save();
    loadBoard();
  }

  // ---- input ---------------------------------------------------------------------------

  $("sd-go").onclick = () => { if (busy) return; phase === "paused" ? resume() : startGame(); };
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  addEventListener("pagehide", pause);

  gridEl.addEventListener("click", (e) => {
    const c = e.target.closest(".sd-cell");
    if (!c || phase !== "running") return;
    sel = Number(c.dataset.i);
    draw();
  });
  document.querySelectorAll(".sd-pad [data-d]").forEach((b) => { b.onclick = () => put(Number(b.dataset.d)); });
  $("sd-erase").onclick = () => {
    if (!g || phase !== "running" || sel < 0 || g.puzzle[sel]) return;
    g.entries[sel] = 0; g.notes[sel] = 0; save(); draw();
  };
  $("sd-notes").onclick = () => { notesMode = !notesMode; draw(); };
  const leaving = () => !(g && !g.solved && g.entries.some((d, i) => d && !g.puzzle[i])) || confirm("Start a new puzzle? This one won't count.");
  $("sd-new").onclick = () => { if (leaving()) newGame(); };
  document.querySelectorAll(".ms-diff button").forEach((x) => {
    x.onclick = () => {
      if (x.dataset.diff === diff && phase === "idle") return;
      if (!leaving()) return;
      diff = x.dataset.diff; store.set("sudoku-diff", diff); newGame(); loadBoard();
    };
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches?.("input, textarea") || !g || phase !== "running") return;
    const k = e.key;
    if (/^[1-9]$/.test(k)) { put(Number(k)); e.preventDefault(); return; }
    if (k === "Backspace" || k === "Delete" || k === "0") { $("sd-erase").click(); e.preventDefault(); return; }
    if (k === "n" || k === "N") { notesMode = !notesMode; draw(); return; }
    const move = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[k];
    if (move) {
      e.preventDefault();
      if (sel < 0) sel = 40;
      else {
        const r = S.ROW(sel), c = S.COL(sel);
        if (move === -9 && r > 0) sel -= 9; if (move === 9 && r < 8) sel += 9;
        if (move === -1 && c > 0) sel -= 1; if (move === 1 && c < 8) sel += 1;
      }
      draw();
    }
  });

  // ---- ranking -------------------------------------------------------------------------

  async function loadBoard() {
    ranking = await P.timedRanking("sudoku", diff, { me: "sd-me", top: "sd-top", title: "sd-rank-title", recovery: "sd-recovery" },
      () => newGame());
  }

  // ---- start: resume this device's puzzle, or make a new one ----------------------------

  (async () => {
    document.querySelectorAll(".ms-diff button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.diff === diff)));
    await loadBoard();
    const saved = store.get("sudoku-game", null);
    if (saved && saved.diff === diff && Array.isArray(saved.puzzle) && saved.puzzle.length === 81 && !saved.solved
        && typeof saved.elapsed === "number") {
      // an unfinished puzzle: it was paused when the page closed; Continue picks it up
      g = saved;
      if (g.runSince) { g.elapsed += Math.max(0, Date.now() - g.runSince); g.runSince = 0; } // page closed without a pause
      phase = "paused"; tick(); draw();
    } else {
      newGame();
    }
  })();
})();
