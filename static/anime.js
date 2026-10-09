"use strict";
// anime page: plays direct video links listed in anime.json —
//   {"videos": [{"title": "Episode 1", "src": "https://…/video.mp4" | "https://…/master.m3u8", "poster": "optional.jpg", "id": "optional"}]}
// .mp4/.webm play natively; .m3u8 (HLS) streams play through hls.js (vendor/), or natively in Safari.
// The source has to allow its video to be played on other sites (CORS), otherwise the browser refuses it.
//
// Watchlist and watch history (where each video was stopped) belong to the same player as the games
// (players.js: number, nickname, recovery code) and are kept on the server, so the recovery code brings them to
// another device. They're also kept in this browser, so it works offline or without the ranking database.

(() => {
  const $ = (id) => document.getElementById(id);
  const P = window.Players;
  const video = $("an-video"), msg = $("an-msg");
  let items = [], current = -1, hls = null, online = false, lastSaved = 0, registering = null;

  // ---- watch state: {list: [key], hist: {key: {t, pos, dur}}} ---------------------------

  const local = (() => { try { return JSON.parse(localStorage.getItem("anime-watch")) || {}; } catch { return {}; } })();
  const state = { list: new Set(local.list || []), hist: local.hist || {} };
  const saveLocal = () => { try { localStorage.setItem("anime-watch", JSON.stringify({ list: [...state.list], hist: state.hist })); } catch { /* private mode */ } };
  const key = (it) => String(it.id || it.src);

  async function sync() {
    try {
      const probe = await P.api("GET", "");
      online = !!probe.configured;
    } catch { online = false; }
    if (!online) return;
    const p = P.current();
    if (p) {
      try {
        const d = await P.api("POST", { action: "wget", id: p.id, key: p.key });
        for (const v of d.list || []) state.list.add(v);
        for (const h of d.history || []) if (!state.hist[h.v] || (h.t || 0) > (state.hist[h.v].t || 0)) state.hist[h.v] = { t: h.t, pos: h.pos, dur: h.dur };
        // things done on this device before it had a player number go up too
        for (const v of state.list) if (!(d.list || []).includes(v)) send({ action: "wlist", v, on: true });
        saveLocal();
      } catch (e) { if (e.status === 403) P.forget(); }
    }
    drawPlayer();
  }

  // "watching as player #…" plus the recovery code panel (redrawn once a player number exists)
  function drawPlayer() {
    P.recoveryPanel($("an-recovery"), { afterSwitch: async () => { state.list.clear(); state.hist = {}; saveLocal(); await sync(); draw(); } });
    const me = P.current();
    $("an-me").textContent = me ? `watching as player #${me.id} · your watchlist and history follow your recovery code` : "";
    dispatchEvent(new Event("relayout"));
  }

  async function send(body, beacon = false) {
    if (!online) return;
    let p = P.current();
    if (!p) {
      const first = !registering;
      registering ||= P.player();
      try { p = await registering; } catch { registering = null; return; }
      if (first) drawPlayer();
    }
    const payload = { ...body, id: p.id, key: p.key };
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon("api/scores", new Blob([JSON.stringify(payload)], { type: "application/json" }));
      return;
    }
    P.api("POST", payload).catch(() => {});
  }

  function savePos(beacon = false) {
    const it = items[current];
    if (!it || !video.duration || !isFinite(video.duration)) return;
    const k = key(it), pos = Math.round(video.currentTime), dur = Math.round(video.duration);
    if (pos < 1 && !state.hist[k]) return; // loaded but never played
    state.hist[k] = { t: Date.now(), pos, dur };
    saveLocal();
    send({ action: "wpos", v: k, pos, dur }, beacon);
    lastSaved = Date.now();
  }

  // ---- player --------------------------------------------------------------------------

  const isHls = (src) => /\.m3u8(\?|#|$)/i.test(src);

  function play(i, autoplay = true) {
    const it = items[i];
    if (!it) return;
    if (current >= 0 && current !== i) savePos();
    current = i;
    msg.textContent = "";
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute("src");
    video.poster = it.poster || "";
    if (isHls(it.src) && window.Hls && Hls.isSupported()) {
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (d.fatal) msg.textContent = "This stream won't play here — the site it comes from probably doesn't allow other sites to play it.";
      });
      hls.loadSource(it.src);
      hls.attachMedia(video);
    } else {
      video.src = it.src; // mp4/webm, or HLS in Safari
    }
    // pick up where it was stopped (unless it was finished)
    const h = state.hist[key(it)];
    if (h && h.pos > 5 && (!h.dur || h.pos < h.dur - 10)) {
      video.addEventListener("loadedmetadata", () => { video.currentTime = h.pos; }, { once: true });
      msg.textContent = `continuing from ${clock(h.pos)}`;
    }
    if (autoplay) video.play().catch(() => {});
    try { localStorage.setItem("anime-last", String(i)); } catch { /* private mode */ }
    draw();
  }

  video.addEventListener("error", () => {
    if (!hls) msg.textContent = "This video won't play here — the link may be dead or the site doesn't allow it.";
  });
  video.addEventListener("timeupdate", () => { if (Date.now() - lastSaved > 10000 && !video.paused) savePos(); });
  video.addEventListener("pause", () => savePos());
  video.addEventListener("ended", () => { savePos(); if (current + 1 < items.length) play(current + 1); });
  addEventListener("pagehide", () => savePos(true));
  document.addEventListener("visibilitychange", () => { if (document.hidden) savePos(true); });

  $("an-fav").onclick = () => {
    const it = items[current];
    if (!it) return;
    const k = key(it), on = !state.list.has(k);
    on ? state.list.add(k) : state.list.delete(k);
    saveLocal(); send({ action: "wlist", v: k, on }); draw();
  };

  // ---- drawing -------------------------------------------------------------------------

  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const progress = (it) => { const h = state.hist[key(it)]; return h && h.dur ? Math.min(1, h.pos / h.dur) : 0; };
  const watched = (it) => progress(it) >= 0.9;

  function button(i) {
    const it = items[i];
    const b = document.createElement("button");
    b.type = "button";
    b.onclick = () => play(i);
    const p = progress(it);
    b.append(Object.assign(document.createElement("span"), { textContent: (state.list.has(key(it)) ? "★ " : "") + (it.title || `Video ${i + 1}`) }));
    if (watched(it)) b.append(Object.assign(document.createElement("small"), { textContent: " ✓" }));
    if (p > 0) {
      const bar = document.createElement("i");
      bar.style.width = `${Math.round(p * 100)}%`;
      b.append(bar);
    }
    const li = document.createElement("li");
    li.className = i === current ? "on" : "";
    li.append(b);
    return li;
  }

  function section(boxId, indexes) {
    const box = $(boxId);
    box.hidden = !indexes.length;
    box.querySelector("ol").replaceChildren(...indexes.map(button));
  }

  function draw() {
    const it = items[current];
    $("an-title").textContent = it ? it.title || "" : "";
    $("an-fav").hidden = !it;
    $("an-fav").textContent = it && state.list.has(key(it)) ? "★ in watchlist" : "☆ add to watchlist";
    const idx = items.map((_, i) => i);
    const recent = idx.filter((i) => state.hist[key(items[i])])
      .sort((a, b) => (state.hist[key(items[b])].t || 0) - (state.hist[key(items[a])].t || 0));
    section("an-continue", recent.filter((i) => !watched(items[i])).slice(0, 8));
    section("an-watchlist", idx.filter((i) => state.list.has(key(items[i]))));
    section("an-history", recent.slice(0, 20));
    section("an-all", idx);
    dispatchEvent(new Event("relayout"));
  }

  // ---- start ---------------------------------------------------------------------------

  fetch("anime.json", { cache: "no-cache" }).then((r) => r.json()).then(async (d) => {
    items = (d.videos || []).filter((v) => v && typeof v.src === "string" && /^https?:\/\//.test(v.src));
    if (!items.length) {
      document.querySelector(".an-stage").hidden = true;
      $("an-all").replaceWith(Object.assign(document.createElement("p"), { className: "empty", textContent: "Nothing here yet." }));
      dispatchEvent(new Event("relayout"));
      return;
    }
    await sync();
    let last = 0;
    try { last = Math.min(items.length - 1, Math.max(0, Number(localStorage.getItem("anime-last")) || 0)); } catch { /* private mode */ }
    play(last, false);
  }).catch(() => { msg.textContent = "Couldn't load the list."; });
})();
