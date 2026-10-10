"use strict";
// 2048 rules, shared by the page (games.js) and the score server (api/scores.js), so the server can replay a
// game from its seed and its list of moves and get exactly the same board and score.
// Tile spawns come from a seeded generator (mulberry32): same seed + same moves = same game.

(function (root) {
  const SIZE = 16;
  const DIRS = "LRUD";

  // Cell indices of each line, listed in the direction tiles slide towards.
  const LINES = { L: [], R: [], U: [], D: [] };
  for (let i = 0; i < 4; i++) {
    const row = [0, 1, 2, 3].map((c) => i * 4 + c), col = [0, 1, 2, 3].map((r) => r * 4 + i);
    LINES.L.push(row); LINES.R.push([...row].reverse());
    LINES.U.push(col); LINES.D.push([...col].reverse());
  }

  // mulberry32: returns [random 0..1, next state]
  function next(state) {
    let t = (state + 0x6d2b79f5) >>> 0;
    const s = t;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
  }

  function spawn(g) {
    const free = [];
    g.cells.forEach((v, i) => { if (!v) free.push(i); });
    if (!free.length) return -1;
    let r;
    [r, g.rng] = next(g.rng);
    const i = free[Math.floor(r * free.length)];
    [r, g.rng] = next(g.rng);
    g.cells[i] = r < 0.9 ? 2 : 4;
    return i;
  }

  function start(seed) {
    const g = { cells: Array(SIZE).fill(0), score: 0, rng: seed >>> 0, moves: "" };
    const fresh = [spawn(g), spawn(g)];
    return { game: g, fresh };
  }

  // Applies one move in place. Returns null if nothing moved, else {fresh, merged, gained}.
  function move(g, dir) {
    let moved = false, gained = 0;
    const merged = [];
    for (const line of LINES[dir]) {
      const vals = line.map((i) => g.cells[i]).filter(Boolean);
      const out = [];
      for (let k = 0; k < vals.length; k++) {
        if (vals[k] === vals[k + 1]) {
          out.push(vals[k] * 2); gained += vals[k] * 2; merged.push(line[out.length - 1]); k++;
        } else out.push(vals[k]);
      }
      line.forEach((i, k) => {
        const v = out[k] || 0;
        if (g.cells[i] !== v) moved = true;
        g.cells[i] = v;
      });
    }
    if (!moved) return null;
    g.score += gained;
    g.moves += dir;
    return { fresh: spawn(g), merged, gained };
  }

  function canMove(g) {
    const c = g.cells;
    for (let i = 0; i < SIZE; i++) {
      if (!c[i]) return true;
      if (i % 4 < 3 && c[i] === c[i + 1]) return true;
      if (i < 12 && c[i] === c[i + 4]) return true;
    }
    return false;
  }

  // Replays a whole game. Any move that doesn't change the board makes the record invalid.
  function replay(seed, moves) {
    const { game } = start(seed);
    for (const d of String(moves)) {
      if (!DIRS.includes(d) || !move(game, d)) return { valid: false, score: game.score, maxTile: Math.max(...game.cells) };
    }
    return { valid: true, score: game.score, maxTile: Math.max(...game.cells), over: !canMove(game), moves: game.moves.length };
  }

  const api = { start, move, canMove, replay, DIRS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.G2048 = api;
})(typeof self !== "undefined" ? self : this);
