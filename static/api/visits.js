"use strict";
// Vercel serverless function: the visit count at /api/visits, in the same Upstash Redis as the rankings.
// total = all visits ever (every page view), a counter (pageviews:all — not "visits:all", which is an old
// HyperLogLog from an earlier counter and can't be added to). When the counter is first made it starts
// from the number of page views already in the visit log, so earlier visits aren't lost.
//
//   POST /api/visits {v: "<anonymous browser id>", p: "/page", r: "<referrer>"}  → records the visit, returns {total}
//
// Every page view is also written to a visit log (Redis list log:visits), readable only with the database keys:
// time, page, where the visitor came from, country/region/city (from Vercel's own headers), IP address,
// browser (user agent) and language, with the full IP address. The newest LOG_MAX entries are kept (100,000 page
// views, about 40 MB, well inside Upstash's free 256 MB).
//   GET  /api/visits                        → {total}

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const LOG_MAX = 100000;

const header = (req, name) => {
  const v = req.headers[name];
  try { return v ? decodeURIComponent(String(v)) : ""; } catch { return String(v || ""); }
};
const clip = (s, n) => String(s || "").slice(0, n);

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
  try {
    if (req.method === "POST") {
      const { v, p, r } = await body(req);
      if (typeof v !== "string" || !/^[a-f0-9]{32}$/.test(v)) return send(res, 400, { error: "bad id" });
      const entry = {
        t: Date.now(), v, p: clip(p, 200), r: clip(r, 300),
        ip: clip(String(req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "").split(",")[0].trim(), 64),
        c: clip(header(req, "x-vercel-ip-country"), 4), rg: clip(header(req, "x-vercel-ip-country-region"), 16),
        city: clip(header(req, "x-vercel-ip-city"), 64), ua: clip(req.headers["user-agent"], 300),
        lang: clip(String(req.headers["accept-language"] || "").split(",")[0], 16),
      };
      let [total, logged] = await redis(
        ["INCR", "pageviews:all"], ["LLEN", "log:visits"],
        ["LPUSH", "log:visits", JSON.stringify(entry)], ["LTRIM", "log:visits", "0", String(LOG_MAX - 1)]);
      // the counter was just made: start it from the page views already logged
      if (total === 1 && logged > 0) [total] = await redis(["INCRBY", "pageviews:all", String(logged)]);
      return send(res, 200, { configured: true, total: Number(total) });
    }
    const [total, logged] = await redis(["GET", "pageviews:all"], ["LLEN", "log:visits"]);
    return send(res, 200, { configured: true, total: total === null ? logged : Number(total) });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
};
