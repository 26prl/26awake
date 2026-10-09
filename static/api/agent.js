"use strict";
// Vercel serverless function behind the "restricted" page: the password lock and the saved rules.
// The chat itself normally goes straight from the browser to Ollama on your own computer and never passes through
// here. Optionally (AGENT_API_KEY set) it can also relay to an OpenAI-compatible API.
//
// Environment variables (Vercel → Settings → Environment Variables):
//   RESTRICTED_PASSWORD   the page's password (required)
//   AGENT_API_KEY         optional: API key of an online provider, if you also want the server-side chat
//   AGENT_BASE_URL        provider's OpenAI-compatible base URL (default Groq: https://api.groq.com/openai/v1)
//   AGENT_MODEL           model name (default llama-3.3-70b-versatile)
// The rules (system prompt) are edited on the page and kept in the same Upstash Redis as the games.
//
//   POST /api/agent {action:"login", password}       → {token}   (token lasts 30 days)
//   GET  /api/agent              (Authorization: Bearer token) → {rules, model, server}
//   GET  /api/agent?traffic&start=N&count=M (Bearer)           → {visits, total} a chunk of the visit log, newest first
//   POST /api/agent {action:"rules", rules}   (Bearer)          → saves the rules
//   POST /api/agent {action:"chat", messages} (Bearer)          → streams the reply (text/event-stream from the provider)

const crypto = require("crypto");

const PASSWORD = process.env.RESTRICTED_PASSWORD || "";
const KEY = process.env.AGENT_API_KEY || "";
const BASE = (process.env.AGENT_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
const MODEL = process.env.AGENT_MODEL || "llama-3.3-70b-versatile";
const R_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const R_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
// Tokens are signed with a secret derived from the password and the API key: changing either logs everyone out.
const SECRET = crypto.createHash("sha256").update(`26awake-agent|${PASSWORD}|${KEY}`).digest();
const TOKEN_DAYS = 30, MAX_FAILS = 3; // 3 wrong passwords lock that connection out for an hour

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function redis(...commands) {
  if (!R_URL || !R_TOKEN) return commands.map(() => null);
  const r = await fetch(`${R_URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${R_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error(`database: ${r.status}`);
  return (await r.json()).map((x) => x.result);
}

async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 400000) throw new Error("too big"); }
  return JSON.parse(raw || "{}");
}

const sign = (exp) => crypto.createHmac("sha256", SECRET).update(String(exp)).digest("base64url");
const makeToken = () => { const exp = Date.now() + TOKEN_DAYS * 864e5; return `${exp}.${sign(exp)}`; };
function validToken(req) {
  const m = (req.headers.authorization || "").match(/^Bearer (\d+)\.([\w-]+)$/);
  if (!m || Number(m[1]) < Date.now()) return false;
  const a = Buffer.from(m[2]), b = Buffer.from(sign(m[1]));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function samePassword(given) {
  const a = crypto.createHash("sha256").update(String(given)).digest(), b = crypto.createHash("sha256").update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  if (!PASSWORD) return send(res, 200, { configured: false });
  try {
    const b = req.method === "POST" ? await body(req) : {};

    if (b.action === "login") {
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
      const failKey = `agent:fail:${crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16)}`;
      const [fails] = await redis(["GET", failKey]);
      if (Number(fails) >= MAX_FAILS) return send(res, 429, { error: "Too many wrong passwords. Try again in an hour." });
      if (!samePassword(b.password || "")) {
        await redis(["INCR", failKey], ["EXPIRE", failKey, "3600"]);
        return send(res, 401, { error: "Wrong password." });
      }
      return send(res, 200, { token: makeToken() });
    }

    if (!validToken(req)) return send(res, 401, { error: "locked" });

    if (req.method === "GET" && new URL(req.url, "http://x").searchParams.has("traffic")) {
      // the owner's traffic log (written by api/visits.js), newest first, in chunks: ?traffic&start=0&count=2000
      const q = new URL(req.url, "http://x").searchParams;
      const start = Math.max(0, Number(q.get("start")) || 0), count = Math.min(2000, Math.max(1, Number(q.get("count")) || 2000));
      const [rows, total] = await redis(["LRANGE", "log:visits", String(start), String(start + count - 1)], ["LLEN", "log:visits"]);
      const visits = (rows || []).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
      return send(res, 200, { visits, total: Number(total) || 0, start });
    }

    if (req.method === "GET") {
      const [rules] = await redis(["GET", "agent:rules"]);
      return send(res, 200, { configured: true, rules: rules || "", server: !!KEY, model: KEY ? MODEL : null, saved: !!(R_URL && R_TOKEN) });
    }

    if (b.action === "rules") {
      if (typeof b.rules !== "string" || b.rules.length > 20000) return send(res, 400, { error: "rules: text up to 20,000 characters" });
      if (!R_URL || !R_TOKEN) return send(res, 400, { error: "No database connected to save the rules." });
      await redis(["SET", "agent:rules", b.rules]);
      return send(res, 200, { ok: true });
    }

    if (b.action === "chat") {
      if (!KEY) return send(res, 400, { error: "No online model is set up; use Ollama on this computer." });
      const messages = (Array.isArray(b.messages) ? b.messages : [])
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-40);
      if (!messages.length) return send(res, 400, { error: "no messages" });
      const [rules] = await redis(["GET", "agent:rules"]);
      const upstream = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL, stream: true,
          messages: [...(rules ? [{ role: "system", content: rules }] : []), ...messages],
        }),
      });
      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => "");
        return send(res, 502, { error: `The model's provider said ${upstream.status}: ${text.slice(0, 300)}` });
      }
      // Pass the provider's stream straight through.
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      for await (const chunk of upstream.body) res.write(chunk);
      return res.end();
    }

    return send(res, 400, { error: "unknown action" });
  } catch (e) {
    if (!res.headersSent) return send(res, 500, { error: String(e.message || e) });
    res.end();
  }
};
