"use strict";
// Home page: clock, rooms that fade in, art (art.json), what I'm listening to (api/spotify), music (music.json)
// and topic cards with live numbers.

(() => {
  document.documentElement.classList.add("js");
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
        el("span", { className: "open", textContent: "look →" })));
  }

  async function renderTopics() {
    const box = $("#topic-cards");
    try {
      const topics = await loadTopics();
      box.replaceChildren(...topics.filter((t) => t.enabled !== false).map(topicCard),
        el("div", { className: "card topic-card more" },
          el("h3", { textContent: "more windows later" }),
          el("p", { textContent: "new trackers show up here on their own." })));
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
      grid.replaceChildren(el("div", { className: "empty-wall" }, el("span"), el("span"), el("span"),
        el("p", { textContent: "the walls are bare for now." })));
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
      parts.push(el("p", { className: "small", textContent: "logged in to spotify in this browser? full songs. otherwise 30-second previews." }));
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

    if (!parts.length && $("#me").hidden) parts.push(el("p", { className: "quiet", textContent: "silence, for now." }));
    box.replaceChildren(...parts);
  }

  // ---- what I'm listening to (Vercel function api/spotify, see README) ------------------

  const mmss = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  const sinceText = (iso) => (iso ? ago(iso).replace("min", "m") : "");

  function trackRow(t, right) {
    return el("li", {}, el("a", { href: t.url || "#", target: "_blank", rel: "noopener" },
      el("img", { src: t.image || "", alt: "", loading: "lazy" }),
      el("span", {}, el("span", { className: "t", textContent: t.title }), el("span", { className: "a", textContent: t.artists.join(", ") })),
      el("span", { className: "w", textContent: right || "" })));
  }

  let nowTimer = null;
  function renderNow(data) {
    const now = data.now;
    const last = data.recent?.[0];
    const t = now?.track || last;
    if (!t) return null;
    const playing = !!now?.playing;
    const fill = el("i");
    const elapsed = el("span"), total = el("span", { textContent: t.duration_ms ? mmss(t.duration_ms) : "" });
    const card = el("a", { className: `glass now${playing ? " playing" : ""}`, href: t.url || "#", target: "_blank", rel: "noopener" },
      el("div", { className: "now-bg", style: `background-image:url("${t.image || ""}")` }),
      el("img", { className: "now-art", src: t.image || "", alt: "" }),
      el("div", {},
        el("p", { className: "now-state" }, el("span", { className: "pulse" }),
          playing ? "listening right now" : now?.track ? "paused" : `last played ${sinceText(last?.played_at)}`),
        el("p", { className: "now-title", textContent: t.title }),
        el("p", { className: "now-sub", textContent: [t.artists.join(", "), t.album].filter(Boolean).join(" — ") }),
        now?.track && t.duration_ms ? el("div", {}, el("div", { className: "now-bar" }, fill), el("div", { className: "now-time" }, elapsed, total)) : null));
    clearInterval(nowTimer);
    if (now?.track && t.duration_ms) {
      const t0 = Date.now(), p0 = now.progress_ms || 0;
      const tick = () => {
        const p = Math.min(t.duration_ms, p0 + (playing ? Date.now() - t0 : 0));
        fill.style.width = `${(100 * p) / t.duration_ms}%`;
        elapsed.textContent = mmss(p);
      };
      tick();
      if (playing) nowTimer = setInterval(tick, 1000);
    }
    return card;
  }

  async function renderMe() {
    const box = $("#me");
    let data;
    try {
      const r = await fetch("api/spotify", { cache: "no-store" });
      if (!(r.headers.get("content-type") || "").includes("json")) return; // no function here (local server)
      data = await r.json();
    } catch { return; }
    if (!data.configured) return;

    const parts = [renderNow(data)];
    const cols = [];
    if (data.top_artists?.length) {
      cols.push(el("div", { className: "glass me-box" }, el("h3", { textContent: "on repeat this month" }),
        el("div", { className: "artists" }, ...data.top_artists.map((a) =>
          el("a", { href: a.url || "#", target: "_blank", rel: "noopener" }, el("img", { src: a.image || "", alt: "", loading: "lazy" }),
            el("span", { textContent: a.name }))))));
    }
    if (data.top_tracks?.length) {
      cols.push(el("div", { className: "glass me-box" }, el("h3", { textContent: "most played lately" }),
        el("ol", { className: "me-list" }, ...data.top_tracks.map((t, i) => trackRow(t, String(i + 1).padStart(2, "0"))))));
    }
    const recent = (data.recent || []).slice(data.now?.track ? 0 : 1);
    if (recent.length) {
      cols.push(el("div", { className: "glass me-box" }, el("h3", { textContent: "recently" }),
        el("ul", { className: "me-list" }, ...recent.slice(0, 5).map((t) => trackRow(t, sinceText(t.played_at))))));
    }
    if (cols.length) parts.push(el("div", { className: "me-cols" }, ...cols));
    if (data.profile?.url) {
      parts.push(el("p", { className: "me-foot" }, el("a", { href: data.profile.url, target: "_blank", rel: "noopener",
        textContent: `${data.profile.name || "me"} on spotify ↗` })));
    }
    const kept = parts.filter(Boolean);
    if (!kept.length) return;
    box.replaceChildren(...kept);
    box.hidden = false;
    $("#music-list .quiet")?.remove();
  }

  // ---- atmosphere ----------------------------------------------------------------------

  function clock() {
    const d = new Date();
    $("#clock").textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const h = d.getHours();
    $("#still").textContent = h < 5 ? "you're still awake." : h < 11 ? "you're up early." : h < 18 ? "the afternoon hum." : h < 22 ? "the light is going." : "you're still awake.";
  }

  function reveal() {
    const rooms = document.querySelectorAll(".room");
    if (!("IntersectionObserver" in window)) return rooms.forEach((r) => r.classList.add("seen"));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("seen"); io.unobserve(e.target); }
    }, { threshold: 0.08 });
    rooms.forEach((r) => io.observe(r));
  }

  clock();
  setInterval(clock, 15_000);
  reveal();
  renderTopics();
  renderArt();
  renderMusic();
  renderMe();
  setInterval(() => { if (!document.hidden) renderMe(); }, 60_000);
})();
