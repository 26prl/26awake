"use strict";
// Vercel serverless function: GET /api/spotify → what the site owner is listening to (now playing, recently
// played, top artists and tracks of the last ~4 weeks), for the "sound" room on the home page.
//
// Needs three environment variables in Vercel (Project → Settings → Environment Variables):
//   SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET  from developer.spotify.com/dashboard
//   SPOTIFY_REFRESH_TOKEN                     from the one-time setup below
// One-time setup: with only the first two set, open /api/spotify?setup on the site, log in to Spotify and copy
// the refresh token it shows into SPOTIFY_REFRESH_TOKEN. Once that is set, the setup flow is switched off.

const crypto = require("crypto");

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";
const SCOPES = "user-read-currently-playing user-read-playback-state user-read-recently-played user-top-read";

let access = null; // { token, expires } — reused while this function instance stays warm

function send(res, status, body, headers = {}) {
  const json = typeof body !== "string";
  res.statusCode = status;
  res.setHeader("Content-Type", json ? "application/json; charset=utf-8" : "text/html; charset=utf-8");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(json ? JSON.stringify(body) : body);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title, inner) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#16131f;color:#ece6f2;
font:15px/1.6 ui-monospace,Menlo,monospace;padding:16px"><main style="max-width:640px">${inner}</main></body>`;

function redirectUri(req) {
  if (process.env.SPOTIFY_REDIRECT_URI) return process.env.SPOTIFY_REDIRECT_URI;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}/api/spotify`;
}

async function tokenRequest(params) {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  const r = await fetch(`${ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || data.error || `token request failed (${r.status})`);
  return data;
}

async function accessToken() {
  if (access && access.expires > Date.now() + 30_000) return access.token;
  const data = await tokenRequest({ grant_type: "refresh_token", refresh_token: process.env.SPOTIFY_REFRESH_TOKEN });
  access = { token: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return access.token;
}

async function api(path, token) {
  const r = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 204) return null; // nothing playing
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

// Spotify image lists run largest first; take a medium one.
const image = (imgs) => (imgs && imgs.length ? (imgs.find((i) => (i.width || 0) <= 320) || imgs[imgs.length - 1] || imgs[0]).url : null);

function track(t) {
  if (!t) return null;
  const episode = t.type === "episode";
  return {
    title: t.name,
    artists: episode ? [t.show?.name].filter(Boolean) : (t.artists || []).map((a) => a.name),
    album: episode ? null : t.album?.name || null,
    image: image(episode ? t.images || t.show?.images : t.album?.images),
    url: t.external_urls?.spotify || null,
    duration_ms: t.duration_ms || null,
  };
}

async function snapshot() {
  const token = await accessToken();
  const [now, recent, artists, tracks, me] = await Promise.allSettled([
    api("/me/player/currently-playing?additional_types=episode", token),
    api("/me/player/recently-played?limit=8", token),
    api("/me/top/artists?time_range=short_term&limit=6", token),
    api("/me/top/tracks?time_range=short_term&limit=5", token),
    api("/me", token),
  ]);
  const ok = (p) => (p.status === "fulfilled" ? p.value : null);
  const playing = ok(now);
  const profile = ok(me);
  return {
    configured: true,
    now: playing && playing.item ? { playing: !!playing.is_playing, progress_ms: playing.progress_ms || 0, track: track(playing.item) } : null,
    recent: (ok(recent)?.items || []).map((i) => ({ ...track(i.track), played_at: i.played_at })),
    top_artists: (ok(artists)?.items || []).map((a) => ({ name: a.name, image: image(a.images), url: a.external_urls?.spotify || null })),
    top_tracks: (ok(tracks)?.items || []).map(track),
    profile: profile ? { name: profile.display_name || null, url: profile.external_urls?.spotify || null } : null,
    fetched_at: new Date().toISOString(),
  };
}

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const q = url.searchParams;
  const hasApp = process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET;

  if (process.env.SPOTIFY_REFRESH_TOKEN && hasApp) {
    try {
      return send(res, 200, await snapshot(), { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=40" });
    } catch (e) {
      return send(res, 502, { configured: true, error: String(e.message || e) }, { "Cache-Control": "public, s-maxage=30" });
    }
  }

  // ---- one-time setup (only while no refresh token is configured) ----
  if (!hasApp) return send(res, 200, { configured: false }, { "Cache-Control": "public, s-maxage=60" });

  if (q.has("setup")) {
    const state = crypto.randomBytes(16).toString("hex");
    const auth = new URL(`${ACCOUNTS}/authorize`);
    auth.search = new URLSearchParams({
      response_type: "code", client_id: process.env.SPOTIFY_CLIENT_ID, scope: SCOPES,
      redirect_uri: redirectUri(req), state, show_dialog: "true",
    });
    res.setHeader("Set-Cookie", `sp_state=${state}; Path=/api/spotify; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    res.setHeader("Cache-Control", "no-store");
    res.statusCode = 302;
    res.setHeader("Location", auth.toString());
    return res.end();
  }

  if (q.has("code") || q.has("error")) {
    const cookie = (req.headers.cookie || "").match(/(?:^|;\s*)sp_state=([a-f0-9]+)/);
    if (q.get("error") || !cookie || cookie[1] !== q.get("state")) {
      return send(res, 400, page("Spotify setup", `<p>Spotify login didn't go through (${esc(q.get("error") || "state mismatch")}).
        <a style="color:#ffe9b8" href="/api/spotify?setup">Try again</a>.</p>`), { "Cache-Control": "no-store" });
    }
    try {
      const data = await tokenRequest({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirectUri(req) });
      return send(res, 200, page("Spotify connected", `<h1 style="font-weight:300">Almost there.</h1>
        <p>In Vercel → your project → Settings → Environment Variables, add <b>SPOTIFY_REFRESH_TOKEN</b> with this value
        (don't share it with anyone), then redeploy:</p>
        <textarea readonly rows="5" style="width:100%;background:#0f0d17;color:#ffe9b8;border:1px solid #333;border-radius:8px;padding:10px"
        onclick="this.select()">${esc(data.refresh_token || "")}</textarea>
        <p style="opacity:.6">After that, this setup page switches itself off.</p>`),
        { "Cache-Control": "no-store", "Set-Cookie": "sp_state=; Path=/api/spotify; Max-Age=0" });
    } catch (e) {
      return send(res, 400, page("Spotify setup", `<p>Couldn't finish: ${esc(e.message || e)}</p>`), { "Cache-Control": "no-store" });
    }
  }

  return send(res, 200, { configured: false, setup: "open /api/spotify?setup to connect" }, { "Cache-Control": "no-store" });
};
