"use strict";
// game3: sudoku (rules and puzzle maker in sudoku-core.js, players in players.js, ranking in api/scores.js).
// Each puzzle comes from a server seed (a local one when there is no server). When the grid is full and right,
// it's sent to the server, which rebuilds the puzzle, checks the grid and times the solve itself.
// The puzzle in progress (with pencil notes) is kept on this device.

(() => {
  const gridEl = document.getElementById("sd-grid");
  if (!gridEl || !window.Sudoku || !window.Players) return;
  const S = window.Sudoku, P = window.Players;
  const { el, store, fmt, api, secs } = P;
  const $ = (id) => document.getElementById(id);

  let diff = S.DIFFS[store.get("sudoku-diff", "easy")] ? store.get("sudoku-diff", "easy") : "easy";
  let g = null;       // {diff, seed, game, puzzle[], entries[], notes[], started, solved, time}
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
  }

  function tick() {
    $("sd-time").textContent = g ? secs((g.solved ? g.time : Date.now() - g.started) || 0) : "0.0 s";
  }

  // ---- game ----------------------------------------------------------------------------

  async function newGame() {
    busy = true; g = null; sel = -1; clearInterval(ticker); draw();
    $("sd-result").textContent = "";
    document.querySelectorAll(".ms-diff button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.diff === diff)));
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
    g = { diff, seed, game, puzzle, entries: puzzle.slice(), notes: new Array(81).fill(0), started: Date.now(), solved: false };
    busy = false;
    save(); start(); draw();
  }

  function start() {
    clearInterval(ticker); tick();
    if (!g.solved) ticker = setInterval(tick, 100);
  }

  function put(d) {
    if (!g || g.solved || sel < 0 || g.puzzle[sel]) return;
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
    g.solved = true; g.time = Date.now() - g.started; save();
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

  gridEl.addEventListener("click", (e) => {
    const c = e.target.closest(".sd-cell");
    if (!c) return;
    sel = Number(c.dataset.i);
    draw();
  });
  document.querySelectorAll(".sd-pad [data-d]").forEach((b) => { b.onclick = () => put(Number(b.dataset.d)); });
  $("sd-erase").onclick = () => {
    if (!g || g.solved || sel < 0 || g.puzzle[sel]) return;
    g.entries[sel] = 0; g.notes[sel] = 0; save(); draw();
  };
  $("sd-notes").onclick = () => { notesMode = !notesMode; draw(); };
  $("sd-new").onclick = () => {
    if (g && !g.solved && g.entries.some((d, i) => d && !g.puzzle[i]) && !confirm("Start a new puzzle? This one won't count.")) return;
    newGame();
  };
  document.querySelectorAll(".ms-diff button").forEach((x) => {
    x.onclick = () => {
      if (x.dataset.diff === diff && g && !g.solved) return;
      if (g && !g.solved && g.entries.some((d, i) => d && !g.puzzle[i]) && !confirm("Start a new puzzle? This one won't count.")) return;
      diff = x.dataset.diff; store.set("sudoku-diff", diff); newGame(); loadBoard();
    };
  });
  document.addEventListener("keydown", (e) => {
    if (e.target.matches?.("input, textarea") || !g) return;
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
    if (saved && saved.diff === diff && Array.isArray(saved.puzzle) && saved.puzzle.length === 81 && !saved.solved) {
      g = saved; start(); draw();
    } else {
      newGame();
    }
  })();
})();
