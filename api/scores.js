"use strict";
// Vercel serverless function: the game rankings (2048, minesweeper, sudoku) at /api/scores, stored in a free Upstash Redis database
// (Vercel → Storage → Upstash for Redis; it adds KV_REST_API_URL / KV_REST_API_TOKEN by itself).
//
// Players have no names: each device gets the next player number plus a secret key on first play.
// The server hands out each game's random seed and, when a game ends, replays its moves with the same rules
// as the page (g2048-core.js), so a score can't be typed in: it is what the moves really scored.
//
//   GET  /api/scores?id=N                         top 20 + player N's rank and stats
//   POST /api/scores {action:"register"}          → {id, key}
//   POST /api/scores {action:"whoami", id, key}   → player's standing (403 if the key is wrong)
//   POST /api/scores {action:"name", id, key, name} → set the player's nickname (once, final, unique)
//   POST /api/scores {action:"start", id, key}    → {game, seed}
//   POST /api/scores {action:"submit", id, key, game, moves}  → {score, tile, best, rank, players, newBest}
//
// Minesweeper and sudoku (fastest win per difficulty; the server times each game itself):
//   GET  /api/scores?game=mines&diff=easy&id=N    top 20 fastest + player N's rank and stats for that difficulty
//   POST /api/scores {action:"mstart", id, key, diff}          → {game, seed}   (sent on the first click)
//   POST /api/scores {action:"msubmit", id, key, game, opens}  → {won, time, best, rank, players, newBest, ...}
//   GET  /api/scores?game=sudoku&diff=easy&id=N   same for sudoku
//   POST /api/scores {action:"sstart", id, key, diff}          → {game, seed}   (the page makes the puzzle from it)
//   POST /api/scores {action:"spause"|"sresume"|"mpause"|"mresume", id, key, game}
//                                                  → pauses/resumes the server's clock for that sudoku/minesweeper game
//   POST /api/scores {action:"ssubmit", id, key, game, grid}   → {won, time, best, rank, players, newBest, ...}
//
// Anime watchlist and watch history, per player (so the recovery code brings them along):
//   POST /api/scores {action:"wget", id, key}                 → {list: [video], history: [{v, t, pos, dur}]}
//   POST /api/scores {action:"wlist", id, key, v, on}         → adds/removes video v on the watchlist
//   POST /api/scores {action:"wpos", id, key, v, pos, dur}    → remembers where video v was stopped
//   (timed game record: "<s|m>:<player>:<seed>:<diff>:<started ms>:<paused ms so far>:<paused since ms, 0 = running>")

const crypto = require("crypto");
const core = require("../g2048-core.js");
const mines = require("../mines-core.js");
const sudoku = require("../sudoku-core.js");
// Timed games: ranking key prefix and per-player field prefix.
const TIMED = { mines: { lb: "lbm", field: "m", rules: mines }, sudoku: { lb: "lbs", field: "s", rules: sudoku } };

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const GAME_TTL = 60 * 60 * 24 * 30; // an unfinished game can be submitted for 30 days
const MAX_MOVES = 50000;
const NAME = /^[\p{L}\p{N}_.\- ]{2,20}$/u; // letters (any alphabet), digits, _ . - and single spaces

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function redis(...commands) {
  const r = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`database: ${r.status}`);
  const out = await r.json();
  for (const x of out) if (x.error) throw new Error(`database: ${x.error}`);
  return out.map((x) => x.result);
}

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const toInt = (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : 0);

async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 200000) throw new Error("too big"); }
  return JSON.parse(raw || "{}");
}

async function checkPlayer(id, key) {
  if (!Number.isSafeInteger(id) || id < 1 || typeof key !== "string") return false;
  const [hash] = await redis(["HGET", `p:${id}`, "key"]);
  return hash && hash === sha(key);
}

async function standing(id) {
  const [rank, best, stats, players] = await redis(
    ["ZREVRANK", "lb", String(id)], ["ZSCORE", "lb", String(id)], ["HMGET", `p:${id}`, "games", "points", "tile", "name"], ["ZCARD", "lb"]);
  return {
    id, name: stats[3] || null, rank: rank === null ? null : rank + 1, best: toInt(best), players: toInt(players),
    games: toInt(stats[0]), points: toInt(stats[1]), tile: toInt(stats[2]),
  };
}

async function top(n = 20) {
  const flat = await redis(["ZREVRANGE", "lb", "0", String(n - 1), "WITHSCORES"]);
  const rows = [];
  for (let i = 0; i < flat[0].length; i += 2) rows.push({ rank: rows.length + 1, id: toInt(flat[0][i]), score: toInt(flat[0][i + 1]) });
  if (!rows.length) return rows;
  const stats = await redis(...rows.map((r) => ["HMGET", `p:${r.id}`, "games", "tile", "name"]));
  rows.forEach((r, i) => { r.games = toInt(stats[i][0]); r.tile = toInt(stats[i][1]); r.name = stats[i][2] || null; });
  return rows;
}

async function tStanding(kind, id, diff) {
  const { lb: prefix, field } = TIMED[kind];
  const lb = `${prefix}:${diff}`;
  const [rank, best, stats, players] = await redis(
    ["ZRANK", lb, String(id)], ["ZSCORE", lb, String(id)], ["HMGET", `p:${id}`, `${field}:${diff}:wins`, `${field}:${diff}:games`, "name"], ["ZCARD", lb]);
  return {
    id, diff, name: stats[2] || null, rank: rank === null ? null : rank + 1, best: best === null ? null : toInt(best),
    players: toInt(players), wins: toInt(stats[0]), games: toInt(stats[1]),
  };
}

async function tTop(kind, diff, n = 20) {
  const { lb, field } = TIMED[kind];
  const [flat] = await redis(["ZRANGE", `${lb}:${diff}`, "0", String(n - 1), "WITHSCORES"]);
  const rows = [];
  for (let i = 0; i < flat.length; i += 2) rows.push({ rank: rows.length + 1, id: toInt(flat[i]), time: toInt(flat[i + 1]) });
  if (!rows.length) return rows;
  const stats = await redis(...rows.map((r) => ["HMGET", `p:${r.id}`, `${field}:${diff}:wins`, "name", `${field}:${diff}:games`]));
  rows.forEach((r, i) => { r.wins = toInt(stats[i][0]); r.name = stats[i][1] || null; r.games = toInt(stats[i][2]); });
  return rows;
}

module.exports = async (req, res) => {
  if (!URL_ || !TOKEN) return send(res, 200, { configured: false });
  try {
    if (req.method === "GET") {
      const q = new URL(req.url, "http://x").searchParams;
      const id = toInt(q.get("id"));
      const kind = q.get("game");
      if (TIMED[kind]) {
        const diff = q.get("diff");
        if (!TIMED[kind].rules.DIFFS[diff]) return send(res, 400, { error: "diff: easy, medium or hard" });
        const [rows, me] = await Promise.all([tTop(kind, diff), id > 0 ? tStanding(kind, id, diff) : null]);
        return send(res, 200, { configured: true, top: rows, me });
      }
      const [rows, me] = await Promise.all([top(20), id > 0 ? standing(id) : null]);
      return send(res, 200, { configured: true, top: rows, me });
    }
    if (req.method !== "POST") return send(res, 405, { error: "GET or POST" });

    const b = await body(req);
    if (b.action === "register") {
      const key = crypto.randomBytes(16).toString("hex");
      const [id] = await redis(["INCR", "players"]);
      await redis(["HSET", `p:${id}`, "key", sha(key), "joined", new Date().toISOString(), "games", "0", "points", "0", "tile", "0"]);
      return send(res, 200, { id, key });
    }

    const id = toInt(b.id);
    if (!(await checkPlayer(id, b.key))) return send(res, 403, { error: "unknown player" });

    if (b.action === "whoami") return send(res, 200, await standing(id)); // checks a recovery code

    if (b.action === "wget") {
      const [list, recent] = await redis(["SMEMBERS", `w:${id}:list`], ["ZREVRANGE", `w:${id}:recent`, "0", "199"]);
      const pos = recent.length ? (await redis(["HMGET", `w:${id}:pos`, ...recent]))[0] : [];
      const history = recent.map((v, i) => { try { return { v, ...JSON.parse(pos[i] || "{}") }; } catch { return { v }; } });
      return send(res, 200, { list, history });
    }

    if (b.action === "wlist" || b.action === "wpos") {
      const v = String(b.v || "");
      if (!v || v.length > 500) return send(res, 400, { error: "bad video" });
      if (b.action === "wlist") {
        await redis(b.on ? ["SADD", `w:${id}:list`, v] : ["SREM", `w:${id}:list`, v]);
        return send(res, 200, { ok: true });
      }
      const pos = Math.max(0, Number(b.pos) || 0), dur = Math.max(0, Number(b.dur) || 0), t = Date.now();
      await redis(
        ["HSET", `w:${id}:pos`, v, JSON.stringify({ t, pos: Math.round(pos), dur: Math.round(dur) })],
        ["ZADD", `w:${id}:recent`, String(t), v],
        ["ZREMRANGEBYRANK", `w:${id}:recent`, "0", "-201"]); // keep the 200 most recent
      return send(res, 200, { ok: true });
    }

    if (b.action === "name") {
      const name = String(b.name || "").trim().replace(/\s+/g, " ");
      if (!NAME.test(name)) return send(res, 400, { error: "2–20 letters, numbers, spaces or _ . -" });
      const [current] = await redis(["HGET", `p:${id}`, "name"]);
      if (current) return send(res, 409, { error: "nickname already set", name: current });
      // Reserve the name (case-insensitive) for this player; first come, first served.
      const [won] = await redis(["HSETNX", "names", name.toLowerCase(), String(id)]);
      if (!won) return send(res, 409, { error: "that nickname is taken" });
      await redis(["HSET", `p:${id}`, "name", name]);
      return send(res, 200, await standing(id));
    }

    if (b.action === "start") {
      const game = crypto.randomBytes(9).toString("base64url");
      const seed = crypto.randomBytes(4).readUInt32LE(0);
      await redis(["SET", `g:${game}`, `${id}:${seed}`, "EX", String(GAME_TTL)]);
      return send(res, 200, { game, seed });
    }

    if (b.action === "mstart") {
      if (!mines.DIFFS[b.diff]) return send(res, 400, { error: "diff: easy, medium or hard" });
      const game = crypto.randomBytes(9).toString("base64url");
      const seed = crypto.randomBytes(4).readUInt32LE(0);
      await redis(["SET", `g:${game}`, `m:${id}:${seed}:${b.diff}:${Date.now()}:0:0`, "EX", String(60 * 60 * 24 * 7)]);
      return send(res, 200, { game, seed });
    }

    if (b.action === "sstart") {
      if (!sudoku.DIFFS[b.diff]) return send(res, 400, { error: "diff: easy, medium or hard" });
      const game = crypto.randomBytes(9).toString("base64url");
      const seed = crypto.randomBytes(4).readUInt32LE(0);
      await redis(["SET", `g:${game}`, `s:${id}:${seed}:${b.diff}:${Date.now()}`, "EX", String(GAME_TTL)]);
      return send(res, 200, { game, seed });
    }

    if (["spause", "sresume", "mpause", "mresume"].includes(b.action)) {
      const kind = b.action[0], pausing = b.action.endsWith("pause");
      if (typeof b.game !== "string") return send(res, 400, { error: "bad game" });
      const [stored] = await redis(["GET", `g:${b.game}`]);
      if (!stored || !stored.startsWith(`${kind}:`)) return send(res, 409, { error: "game already counted or expired" });
      const [, owner, seed, diff, started, pausedMs = "0", since = "0"] = stored.split(":");
      if (Number(owner) !== id) return send(res, 403, { error: "not your game" });
      let paused = Number(pausedMs), at = Number(since);
      const now = Date.now();
      if (pausing && !at) at = now;
      if (!pausing && at) { paused += now - at; at = 0; }
      await redis(["SET", `g:${b.game}`, [kind, owner, seed, diff, started, paused, at].join(":"), "KEEPTTL"]);
      return send(res, 200, { paused: !!at });
    }

    if (b.action === "ssubmit") {
      if (typeof b.game !== "string" || typeof b.grid !== "string" || !/^[1-9]{81}$/.test(b.grid)) return send(res, 400, { error: "bad grid" });
      const [stored] = await redis(["GETDEL", `g:${b.game}`]); // each game counts once
      if (!stored || !stored.startsWith("s:")) return send(res, 409, { error: "game already counted or expired" });
      const [, owner, seed, diff, started, pausedMs = "0", since = "0"] = stored.split(":");
      if (Number(owner) !== id) return send(res, 403, { error: "not your game" });
      const { puzzle } = sudoku.make(diff, Number(seed));
      if (!sudoku.check(puzzle, [...b.grid].map(Number))) return send(res, 400, { error: "that grid isn't solved" });
      // measured here, not by the page: time since start, minus the time the game was paused
      const now = Date.now();
      const time = now - Number(started) - Number(pausedMs) - (Number(since) ? now - Number(since) : 0);
      const before = await tStanding("sudoku", id, diff);
      await redis(["HINCRBY", `p:${id}`, `s:${diff}:games`, "1"], ["HINCRBY", `p:${id}`, `s:${diff}:wins`, "1"],
        ["ZADD", `lbs:${diff}`, "LT", String(time), String(id)]);
      const after = await tStanding("sudoku", id, diff);
      return send(res, 200, { won: true, time, newBest: before.best === null || time < before.best, ...after });
    }

    if (b.action === "msubmit") {
      const opens = String(b.opens || "").split(",").filter(Boolean).map(Number);
      if (typeof b.game !== "string" || opens.length > 2000) return send(res, 400, { error: "bad game" });
      const [stored] = await redis(["GETDEL", `g:${b.game}`]); // each game counts once
      if (!stored || !stored.startsWith("m:")) return send(res, 409, { error: "game already counted or expired" });
      const [, owner, seed, diff, started, pausedMs = "0", since = "0"] = stored.split(":");
      if (Number(owner) !== id) return send(res, 403, { error: "not your game" });
      const result = mines.replay(diff, Number(seed), opens);
      if (!result.valid || (!result.won && !result.lost)) return send(res, 400, { error: "moves don't add up" });
      // measured here, not by the page: time since the first click, minus paused time
      const now = Date.now();
      const time = now - Number(started) - Number(pausedMs) - (Number(since) ? now - Number(since) : 0);
      const before = await tStanding("mines", id, diff);
      await redis(
        ["HINCRBY", `p:${id}`, `m:${diff}:games`, "1"],
        ...(result.won ? [["HINCRBY", `p:${id}`, `m:${diff}:wins`, "1"], ["ZADD", `lbm:${diff}`, "LT", String(time), String(id)]] : []));
      const after = await tStanding("mines", id, diff);
      return send(res, 200, { won: result.won, time: result.won ? time : null,
        newBest: result.won && (before.best === null || time < before.best), ...after });
    }

    if (b.action === "submit") {
      const moves = String(b.moves || "");
      if (typeof b.game !== "string" || moves.length > MAX_MOVES) return send(res, 400, { error: "bad game" });
      const [stored] = await redis(["GETDEL", `g:${b.game}`]); // each game counts once
      if (!stored) return send(res, 409, { error: "game already counted or expired" });
      const [owner, seed] = stored.split(":").map(Number);
      if (owner !== id) return send(res, 403, { error: "not your game" });
      const result = core.replay(seed, moves);
      if (!result.valid) return send(res, 400, { error: "moves don't add up" });

      const before = await standing(id);
      await redis(
        ["ZADD", "lb", "GT", String(result.score), String(id)],
        ["HINCRBY", `p:${id}`, "games", "1"],
        ["HINCRBY", `p:${id}`, "points", String(result.score)],
        ...(result.maxTile > before.tile ? [["HSET", `p:${id}`, "tile", String(result.maxTile)]] : []));
      const after = await standing(id);
      return send(res, 200, { score: result.score, tile: result.maxTile, newBest: result.score > before.best, ...after });
    }
    return send(res, 400, { error: "unknown action" });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
};
