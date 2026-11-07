"use strict";
// Sudoku rules and puzzle maker, shared by the page (sudoku.js) and the score server (api/scores.js).
// A puzzle is made from a seed: a random full grid, then cells are emptied in a random order as long as the
// puzzle keeps exactly one solution. Same seed + difficulty = same puzzle, so the server can rebuild it.

(function (root) {
  const DIFFS = { easy: { clues: 38 }, medium: { clues: 30 }, hard: { clues: 24 } };

  function rng(seed) { // mulberry32
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(a, r) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  const ROW = (i) => Math.floor(i / 9), COL = (i) => i % 9, BOX = (i) => Math.floor(ROW(i) / 3) * 3 + Math.floor(COL(i) / 3);
  const PEERS = Array.from({ length: 81 }, (_, i) => {
    const s = new Set();
    for (let j = 0; j < 81; j++) if (j !== i && (ROW(j) === ROW(i) || COL(j) === COL(i) || BOX(j) === BOX(i))) s.add(j);
    return [...s];
  });

  // Bitmask solver. Counts solutions up to `limit`; with `order` (digit order per call) it also fills `out`.
  function solve(grid, limit = 2, r = null) {
    const g = grid.slice();
    const rows = new Array(9).fill(0), cols = new Array(9).fill(0), boxes = new Array(9).fill(0);
    for (let i = 0; i < 81; i++) if (g[i]) {
      const bit = 1 << g[i];
      if ((rows[ROW(i)] | cols[COL(i)] | boxes[BOX(i)]) & bit) return { count: 0 };
      rows[ROW(i)] |= bit; cols[COL(i)] |= bit; boxes[BOX(i)] |= bit;
    }
    let count = 0, first = null;
    (function go() {
      if (count >= limit) return;
      let best = -1, bestMask = 0, bestN = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const mask = ~(rows[ROW(i)] | cols[COL(i)] | boxes[BOX(i)]) & 0x3fe;
        let n = 0; for (let m = mask; m; m &= m - 1) n++;
        if (n < bestN) { best = i; bestMask = mask; bestN = n; if (n <= 1) break; }
      }
      if (best < 0) { count++; if (!first) first = g.slice(); return; }
      if (!bestN) return;
      const digits = [];
      for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
      if (r) shuffle(digits, r);
      for (const d of digits) {
        const bit = 1 << d;
        g[best] = d; rows[ROW(best)] |= bit; cols[COL(best)] |= bit; boxes[BOX(best)] |= bit;
        go();
        g[best] = 0; rows[ROW(best)] &= ~bit; cols[COL(best)] &= ~bit; boxes[BOX(best)] &= ~bit;
        if (count >= limit) return;
      }
    })();
    return { count, solution: first };
  }

  function make(diff, seed) {
    const r = rng(seed);
    const solution = solve(new Array(81).fill(0), 1, r).solution;
    const puzzle = solution.slice();
    let clues = 81;
    for (const i of shuffle([...Array(81).keys()], r)) {
      if (clues <= DIFFS[diff].clues) break;
      const keep = puzzle[i];
      puzzle[i] = 0;
      if (solve(puzzle, 2).count !== 1) puzzle[i] = keep; else clues--;
    }
    return { diff, puzzle, solution };
  }

  // A finished grid is right if it keeps every given number and breaks no rule.
  function check(puzzle, grid) {
    if (!Array.isArray(grid) || grid.length !== 81) return false;
    for (let i = 0; i < 81; i++) {
      if (!Number.isInteger(grid[i]) || grid[i] < 1 || grid[i] > 9) return false;
      if (puzzle[i] && puzzle[i] !== grid[i]) return false;
      for (const j of PEERS[i]) if (grid[j] === grid[i]) return false;
    }
    return true;
  }

  const api = { DIFFS, PEERS, ROW, COL, BOX, make, solve, check };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Sudoku = api;
})(typeof self !== "undefined" ? self : this);
