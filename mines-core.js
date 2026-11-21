"use strict";
// Minesweeper rules, shared by the page (mines.js) and the score server (api/scores.js).
// Mines are placed from a seed, never on or next to the first opened cell, so the server can rebuild the board
// from the seed and replay the list of opened cells.

(function (root) {
  const DIFFS = {
    easy: { w: 9, h: 9, m: 10 },
    medium: { w: 16, h: 16, m: 40 },
    hard: { w: 30, h: 16, m: 99 },
  };

  // mulberry32
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function neighbours(i, w, h) {
    const x = i % w, y = (i - x) / w, out = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.push(ny * w + nx);
    }
    return out;
  }

  // A new board: {w, h, m, mine[], count[], open[], opened, over: null|"won"|"lost", boom}
  function create(diff, seed, first) {
    const { w, h, m } = DIFFS[diff];
    const n = w * h;
    const keepClear = new Set([first, ...neighbours(first, w, h)]);
    const spots = [];
    for (let i = 0; i < n; i++) if (!keepClear.has(i)) spots.push(i);
    const r = rng(seed);
    for (let i = spots.length - 1; i > 0; i--) { // Fisher–Yates
      const j = Math.floor(r() * (i + 1));
      [spots[i], spots[j]] = [spots[j], spots[i]];
    }
    const mine = new Array(n).fill(false);
    for (let k = 0; k < m; k++) mine[spots[k]] = true;
    const count = mine.map((_, i) => neighbours(i, w, h).filter((j) => mine[j]).length);
    return { diff, w, h, m, mine, count, open: new Array(n).fill(false), opened: 0, over: null, boom: -1 };
  }

  // Opens one cell (and the empty area around it). Returns the newly opened cells.
  function open(b, i) {
    if (b.over || b.open[i]) return [];
    if (b.mine[i]) { b.over = "lost"; b.boom = i; return [i]; }
    const done = [], stack = [i];
    while (stack.length) {
      const c = stack.pop();
      if (b.open[c] || b.mine[c]) continue;
      b.open[c] = true; b.opened++; done.push(c);
      if (b.count[c] === 0) for (const j of neighbours(c, b.w, b.h)) if (!b.open[j]) stack.push(j);
    }
    if (b.opened === b.w * b.h - b.m) b.over = "won";
    return done;
  }

  // Rebuilds a game from its seed and the cells the player opened, in order.
  function replay(diff, seed, opens) {
    if (!DIFFS[diff] || !opens.length) return { valid: false };
    const n = DIFFS[diff].w * DIFFS[diff].h;
    if (opens.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) return { valid: false };
    const b = create(diff, seed, opens[0]);
    for (const i of opens) {
      if (b.over) return { valid: false }; // nothing can be opened after the game ended
      open(b, i);
    }
    return { valid: true, won: b.over === "won", lost: b.over === "lost", opened: b.opened };
  }

  const api = { DIFFS, create, open, neighbours, replay };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Mines = api;
})(typeof self !== "undefined" ? self : this);
