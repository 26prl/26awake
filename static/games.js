"use strict";
// 2048 for the home page. Best score and the game in progress are kept in localStorage (per device).

(() => {
  const board = document.getElementById("g8-board");
  if (!board) return;
  const gridEl = document.getElementById("g8-grid");
  const scoreEl = document.getElementById("g8-score");
  const bestEl = document.getElementById("g8-best");
  const overlay = document.getElementById("g8-overlay");
  const msg = document.getElementById("g8-msg");
  const keepBtn = document.getElementById("g8-keep");

  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // Cell indices of each line, listed in the direction tiles slide towards.
  const LINES = { L: [], R: [], U: [], D: [] };
  for (let i = 0; i < 4; i++) {
    const row = [0, 1, 2, 3].map((c) => i * 4 + c), col = [0, 1, 2, 3].map((r) => r * 4 + i);
    LINES.L.push(row); LINES.R.push([...row].reverse());
    LINES.U.push(col); LINES.D.push([...col].reverse());
  }

  let cells, score, best = store.get("best-2048", 0), won, phase; // phase: playing | won | over
  const cellEls = Array.from({ length: 16 }, () => gridEl.appendChild(document.createElement("div")));

  function addRandom(fresh) {
    const free = cells.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    if (!free.length) return;
    const i = free[Math.floor(Math.random() * free.length)];
    cells[i] = Math.random() < 0.9 ? 2 : 4;
    fresh.add(i);
  }

  function canMove() {
    for (let i = 0; i < 16; i++) {
      if (!cells[i]) return true;
      if (i % 4 < 3 && cells[i] === cells[i + 1]) return true;
      if (i < 12 && cells[i] === cells[i + 4]) return true;
    }
    return false;
  }

  function render(fresh = new Set(), merged = new Set()) {
    cells.forEach((v, i) => {
      const n = cellEls[i];
      n.className = "g8-cell" + (v ? ` v${v <= 2048 ? v : "max"}` : "") + (v >= 1024 ? " huge" : v >= 128 ? " big" : "")
        + (fresh.has(i) ? " new" : merged.has(i) ? " merged" : "");
      n.textContent = v || "";
    });
    scoreEl.textContent = score.toLocaleString();
    bestEl.textContent = best.toLocaleString();
    overlay.hidden = phase === "playing";
    if (phase !== "playing") {
      msg.replaceChildren(phase === "won" ? "you reached 2048." : "no more moves.",
        Object.assign(document.createElement("strong"), { textContent: score.toLocaleString() }),
        Object.assign(document.createElement("em"), { textContent: score >= best && score > 0 ? "a new best" : `best ${best.toLocaleString()}` }));
      keepBtn.hidden = phase !== "won";
    }
  }

  const save = () => store.set("game-2048", { cells, score, won, over: phase === "over" });

  function newGame() {
    cells = Array(16).fill(0); score = 0; won = false; phase = "playing";
    const fresh = new Set();
    addRandom(fresh); addRandom(fresh);
    render(fresh); save();
  }

  function move(dir) {
    if (phase !== "playing") return;
    let moved = false;
    const merged = new Set();
    for (const line of LINES[dir]) {
      const vals = line.map((i) => cells[i]).filter(Boolean);
      const out = [];
      for (let k = 0; k < vals.length; k++) {
        if (vals[k] === vals[k + 1]) {
          out.push(vals[k] * 2); score += vals[k] * 2; merged.add(line[out.length - 1]); k++;
        } else out.push(vals[k]);
      }
      line.forEach((i, k) => {
        const v = out[k] || 0;
        if (cells[i] !== v) moved = true;
        cells[i] = v;
      });
    }
    if (!moved) return;
    const fresh = new Set();
    addRandom(fresh);
    if (score > best) { best = score; store.set("best-2048", best); }
    if (!won && cells.includes(2048)) { won = true; phase = "won"; }
    else if (!canMove()) phase = "over";
    render(fresh, merged); save();
  }

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

  document.getElementById("g8-new").onclick = () => { newGame(); board.focus({ preventScroll: true }); armed = true; };
  document.getElementById("g8-reset").onclick = () => { newGame(); board.focus({ preventScroll: true }); armed = true; };
  keepBtn.onclick = () => { phase = "playing"; render(); save(); board.focus({ preventScroll: true }); armed = true; };

  // Pick up where this device left off.
  const saved = store.get("game-2048", null);
  if (saved && Array.isArray(saved.cells) && saved.cells.length === 16 && saved.cells.some(Boolean)) {
    cells = saved.cells.map((v) => Number(v) || 0); score = Number(saved.score) || 0; won = !!saved.won;
    phase = saved.over ? "over" : "playing";
    render();
  } else newGame();
})();
