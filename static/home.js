"use strict";
// Home page: topic cards with live numbers, art gallery (art.json) and music player (music.json).

(() => {
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    Object.assign(n, props);
    for (const k of kids) if (k != null && k !== false) n.append(k);
    return n;
  };
  const getJSON = async (url, opts = {}) => {
    const r = await fetch(url, { cache: "no-cache", ...opts });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  };
  const ago = (iso) => {
    if (!iso) return "never";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  };

  // ---- data: live server API, or the static export (+ newest snapshot on GitHub) ----------

  async function loadTopics() {
    try {
      const r = await fetch("api/topics", { cache: "no-store" });
      if (r.ok && (r.headers.get("content-type") || "").includes("json")) {
        const topics = await r.json();
        return Promise.all(topics.map(async (t) => ({
          ...t, counts: (await getJSON(`api/topics/${t.id}/insights`).catch(() => ({}))).counts,
        })));
      }
    } catch { /* static site */ }

    let site = await getJSON("data/site.json");
    let base = "";
    // Same newest-snapshot logic as the tracker page: what this browser saw last, then GitHub's latest.
    if (site.live) {
      let seen = null;
      try { seen = JSON.parse(localStorage.getItem("live-snapshot") || "null"); } catch { /* private mode */ }
      const candidates = [];
      if (seen?.sha && seen.generated_at > site.generated_at) candidates.push(seen.sha);
      try {
        const head = await getJSON(`https://api.github.com/repos/${site.live.repo}/commits/${encodeURIComponent(site.live.branch)}`);
        if (head.sha) candidates.unshift(head.sha);
      } catch { /* rate-limited or offline: fine */ }
      for (const sha of candidates) {
        try {
          const b = `https://raw.githubusercontent.com/${site.live.repo}/${sha}/`;
          const fresh = await getJSON(`${b}data/site.json`);
          if (fresh.generated_at > site.generated_at) { site = fresh; base = b; }
          break;
        } catch { /* try the next one */ }
      }
    }
    return Promise.all(site.topics.map(async (t) => ({
      ...t, updated: site.last_check?.finished_at || site.generated_at,
      counts: (await getJSON(`${base}data/topic-${t.id}.json`).catch(() => ({})))?.insights?.counts,
    })));
  }

  function stat(label, value, sub, tone = "") {
    return el("div", { className: `mini-stat ${tone}` },
      el("span", { className: "value", textContent: value }),
      el("span", { className: "label", textContent: label }),
      sub ? el("span", { className: "sub", textContent: sub }) : null);
  }

  function topicCard(t) {
    const s = t.stats || {};
    const unique = (s.total || 0) - (s.repeats || 0);
    const c = t.counts;
    const qual = (m) => m && m.value ? (m.suspected_only ? "suspected" : "confirmed") + (m.disputed ? " · disputed" : "") : "";
    return el("a", { className: "card topic-card", href: `watch.html#${t.id}` },
      el("div", { className: "topic-card-head" },
        el("h3", { textContent: t.name }),
        s.spike ? el("span", { className: "spike", textContent: "Spike" }) : null),
      t.description ? el("p", { className: "muted", textContent: t.description }) : null,
      el("div", { className: "mini-stats" },
        stat("articles in 24 h", s.last24h ?? "–"),
        stat("from trusted sources", unique ? `${Math.round((100 * (s.trusted || 0)) / unique)}%` : "–"),
        c ? stat("infected", c.cases.value ? `~${c.cases.value}` : "0", qual(c.cases), c.cases.value ? "warn" : "") : null,
        c ? stat("deaths", `${c.deaths.value || 0}`, qual(c.deaths), c.deaths.value ? "bad" : "") : null),
      el("div", { className: "topic-card-foot" },
        el("span", { className: "muted small", textContent: `Updated ${ago(t.updated || t.last_run_at)}` }),
        el("span", { className: "open", textContent: "Open tracker →" })));
  }

  async function renderTopics() {
    const box = $("#topic-cards");
    try {
      const topics = await loadTopics();
      box.replaceChildren(...topics.filter((t) => t.enabled !== false).map(topicCard),
        el("div", { className: "card topic-card more" },
          el("h3", { textContent: "More topics soon" }),
          el("p", { className: "muted", textContent: "New trackers appear here automatically when they're added." })));
    } catch (e) {
      box.replaceChildren(el("p", { className: "muted", textContent: `Couldn't load topics right now (${e.message}).` }));
    }
  }

  // ---- art -----------------------------------------------------------------------------

  async function renderArt() {
    const grid = $("#art-grid");
    let items = [];
    try { items = (await getJSON("art.json")).items || []; } catch { /* none */ }
    if (!items.length) {
      grid.replaceChildren(el("p", { className: "muted", textContent: "No art yet." }));
      return;
    }
    const dlg = $("#art-view");
    grid.replaceChildren(...items.map((a) => {
      const img = el("img", { src: a.src, alt: a.title || "", loading: "lazy", decoding: "async" });
      const fig = el("button", { className: "art-item", type: "button", title: a.title || "" }, img,
        a.title ? el("span", { className: "art-title", textContent: a.title }) : null);
      fig.onclick = () => {
        $("#art-view-img").src = a.src;
        $("#art-view-img").alt = a.title || "";
        $("#art-view-caption").textContent = [a.title, a.by && `by ${a.by}`].filter(Boolean).join(" · ");
        dlg.showModal();
      };
      return fig;
    }));
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); }); // click outside closes
  }

  // ---- music ---------------------------------------------------------------------------

  // Spotify share links (open.spotify.com/…/track|album|playlist|artist|show|episode/ID) → embeddable player URL.
  const SPOTIFY_KINDS = ["track", "album", "playlist", "artist", "show", "episode"];
  function spotifyEmbed(link) {
    try {
      const u = new URL(link);
      if (u.hostname !== "open.spotify.com") return null;
      const parts = u.pathname.split("/").filter((p) => p && !p.startsWith("intl-") && p !== "embed");
      const [kind, id] = parts;
      if (!SPOTIFY_KINDS.includes(kind) || !/^[A-Za-z0-9]{10,40}$/.test(id || "")) return null;
      return { kind, src: `https://open.spotify.com/embed/${kind}/${id}?utm_source=generator` };
    } catch {
      return null;
    }
  }

  async function renderMusic() {
    const box = $("#music-list");
    let data = {};
    try { data = await getJSON("music.json"); } catch { /* none */ }
    const tracks = data.tracks || [];
    const embeds = (data.spotify || []).map(spotifyEmbed).filter(Boolean);
    const parts = [];

    for (const e of embeds) {
      parts.push(el("iframe", {
        className: "spotify", src: e.src, title: `Spotify ${e.kind}`, loading: "lazy",
        allow: "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture",
        height: e.kind === "track" || e.kind === "episode" ? 152 : 352,
      }));
    }
    if (embeds.length) {
      parts.push(el("p", { className: "muted small", textContent: "Logged in to Spotify in this browser? You get full songs; otherwise 30-second previews." }));
    }

    if (tracks.length) {
      const audio = el("audio", { controls: true, preload: "none", className: "music-player" });
      let current = -1;
      const rows = tracks.map((t, i) => {
        const row = el("button", { className: "track", type: "button" },
          el("span", { className: "track-n", textContent: String(i + 1).padStart(2, "0") }),
          el("span", { className: "track-title", textContent: t.title }),
          el("span", { className: "muted small", textContent: t.artist || "" }));
        row.onclick = () => play(i);
        return row;
      });
      const play = (i) => {
        current = i;
        audio.src = tracks[i].src;
        audio.play().catch(() => {});
        rows.forEach((r, j) => r.classList.toggle("playing", j === i));
      };
      audio.addEventListener("ended", () => { if (current + 1 < tracks.length) play(current + 1); });
      parts.push(audio, el("div", { className: "tracks" }, ...rows));
    }

    if (!parts.length) {
      parts.push(el("p", { className: "music-empty", textContent: "🎧 Tracks coming soon." }),
        el("p", { className: "muted small", textContent: "Once music is added, you can play it right here." }));
    }
    box.replaceChildren(...parts);
  }

  renderTopics();
  renderArt();
  renderMusic();
})();
