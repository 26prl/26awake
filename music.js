"use strict";
// Music page: what I'm listening to (Vercel function api/spotify, see README) and the players/tracks in music.json.

(() => {
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    for (const k of kids) if (k != null && k !== false) n.append(k);
    return n;
  };
  const ago = (iso) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 3600) return `${Math.max(1, Math.floor(s / 60))} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  };
  const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const link = (href) => ({ href: href || "#", target: "_blank", rel: "noopener" });

  // ---- Spotify: now playing, top tracks/artists, recently played ----------------------

  function row(t, sub) {
    return el("li", {}, el("a", link(t.url),
      el("img", { src: t.image || "", alt: "", loading: "lazy" }),
      el("span", {}, el("span", { className: "t", textContent: t.title || t.name }), el("span", { className: "a", textContent: sub }))));
  }

  let timer = null;
  function nowCard(data) {
    const now = data.now, last = data.recent?.[0], t = now?.track || last;
    if (!t) return null;
    const playing = !!now?.playing;
    const fill = el("i"), time = el("span", { className: "muted small" });
    const card = el("a", { className: "now", ...link(t.url) },
      el("img", { src: t.image || "", alt: "" }),
      el("div", { style: "flex:1;min-width:0" },
        el("p", { className: "muted small", textContent: playing ? "Listening right now" : now?.track ? "Paused" : `Last played ${ago(last.played_at)}` }),
        el("p", { className: "now-title", textContent: t.title }),
        el("p", { className: "muted", textContent: [t.artists.join(", "), t.album].filter(Boolean).join(" — ") }),
        now?.track && t.duration_ms ? el("div", { className: "now-bar" }, fill) : null,
        now?.track && t.duration_ms ? time : null));
    clearInterval(timer);
    if (now?.track && t.duration_ms) {
      const t0 = Date.now(), p0 = now.progress_ms || 0;
      const tick = () => {
        const p = Math.min(t.duration_ms, p0 + (playing ? Date.now() - t0 : 0));
        fill.style.width = `${(100 * p) / t.duration_ms}%`;
        time.textContent = `${mmss(p)} / ${mmss(t.duration_ms)}`;
      };
      tick();
      if (playing) timer = setInterval(tick, 1000);
    }
    return card;
  }

  async function renderMe() {
    let data;
    try {
      const r = await fetch("api/spotify", { cache: "no-store" });
      if (!(r.headers.get("content-type") || "").includes("json")) return; // no function here (local server)
      data = await r.json();
    } catch { return; }
    if (!data.configured) return;

    const lists = [];
    const list = (title, items) => items.length && lists.push(el("div", {}, el("h2", { textContent: title }), el("ul", { className: "me-list" }, ...items)));
    list("Most played lately", (data.top_tracks || []).map((t) => row(t, t.artists.join(", "))));
    list("Top artists this month", (data.top_artists || []).map((a) => row(a, "")));
    list("Recently played", (data.recent || []).slice(data.now?.track ? 0 : 1, 6).map((t) => row(t, `${t.artists.join(", ")} · ${ago(t.played_at)}`)));

    const card = nowCard(data);
    if (!card && !lists.length) return;
    $("#me").replaceChildren(
      card ? el("div", { className: "section" }, card) : null,
      lists.length ? el("div", { className: "section lists" }, ...lists) : null,
      data.profile?.url ? el("p", { className: "small" }, el("a", { ...link(data.profile.url), textContent: "My Spotify profile ↗" })) : null);
    $("#music-list .empty")?.remove();
  }

  // ---- music.json: Spotify players and audio files -----------------------------------

  // Spotify share links (open.spotify.com/…/track|album|playlist|artist|show|episode/ID) → embeddable player URL.
  const KINDS = ["track", "album", "playlist", "artist", "show", "episode"];
  function embed(href) {
    try {
      const u = new URL(href);
      if (u.hostname !== "open.spotify.com") return null;
      const [kind, id] = u.pathname.split("/").filter((p) => p && !p.startsWith("intl-") && p !== "embed");
      if (!KINDS.includes(kind) || !/^[A-Za-z0-9]{10,40}$/.test(id || "")) return null;
      return { kind, src: `https://open.spotify.com/embed/${kind}/${id}?utm_source=generator` };
    } catch {
      return null;
    }
  }

  async function renderMusic() {
    const box = $("#music-list");
    let data = {};
    try { data = await (await fetch("music.json", { cache: "no-cache" })).json(); } catch { /* none */ }
    const parts = (data.spotify || []).map(embed).filter(Boolean).map((e) => el("iframe", {
      className: "spotify", src: e.src, title: `Spotify ${e.kind}`, loading: "lazy",
      allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
      height: e.kind === "track" || e.kind === "episode" ? 152 : 352,
    }));

    const tracks = data.tracks || [];
    if (tracks.length) {
      const audio = el("audio", { controls: true, preload: "none", className: "music-player" });
      let current = -1;
      const rows = tracks.map((t, i) => {
        const b = el("button", { className: "track", type: "button" },
          el("span", { className: "muted", textContent: String(i + 1).padStart(2, "0") }),
          el("span", { textContent: t.title }), el("span", { className: "muted small", textContent: t.artist || "" }));
        b.onclick = () => play(i);
        return b;
      });
      const play = (i) => {
        current = i; audio.src = tracks[i].src; audio.play().catch(() => {});
        rows.forEach((r, j) => r.classList.toggle("playing", j === i));
      };
      audio.addEventListener("ended", () => { if (current + 1 < tracks.length) play(current + 1); });
      parts.push(audio, el("div", {}, ...rows));
    }

    if (!parts.length && !$("#me").children.length) parts.push(el("p", { className: "empty", textContent: "Nothing here yet." }));
    box.replaceChildren(...parts);
  }

  renderMusic();
  renderMe();
  setInterval(() => { if (!document.hidden) renderMe(); }, 60_000);
})();
