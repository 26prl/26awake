"use strict";
// Vercel serverless function: unique visitor counts at /api/visits, in the same Upstash Redis as the rankings.
// Each browser keeps a random anonymous id (no names, no IP addresses are stored) and is counted once per day
// (UTC) and once overall, with Redis HyperLogLogs, so the counts are approximate (within about 1%).
//
//   POST /api/visits {v: "<anonymous id>"}  → records the visit, returns {today, total}
//   GET  /api/visits                        → {today, total}

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

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

async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  let raw = "";
  for await (const chunk of req) { raw += chunk; if (raw.length > 2000) throw new Error("too big"); }
  return JSON.parse(raw || "{}");
}

module.exports = async (req, res) => {
  if (!URL_ || !TOKEN) return send(res, 200, { configured: false });
  const day = `visits:${new Date().toISOString().slice(0, 10)}`;
  try {
    if (req.method === "POST") {
      const { v } = await body(req);
      if (typeof v !== "string" || !/^[a-f0-9]{32}$/.test(v)) return send(res, 400, { error: "bad id" });
      const [, , , today, total] = await redis(
        ["PFADD", day, v], ["PFADD", "visits:all", v], ["EXPIRE", day, String(60 * 60 * 24 * 400)],
        ["PFCOUNT", day], ["PFCOUNT", "visits:all"]);
      return send(res, 200, { configured: true, today, total });
    }
    const [today, total] = await redis(["PFCOUNT", day], ["PFCOUNT", "visits:all"]);
    return send(res, 200, { configured: true, today, total });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
};
