"use strict";
// The music videos on the home page.
//  * The box (#mv-box, under the logo) plays the clips listed in videos.json one after another, in the order they're
//    listed (always starting from #1), and starts over from #1 after the last one. Muted at first (browsers only autoplay without
//    sound); "sound on" turns the sound on (and it stays on for the next clips), "next" skips. Full screen is
//    switched off. Between clips the page glitches hard (the "mv-switch" event, glitch.js).
//  * A second, silent copy fills the whole screen behind a clip mask, so it's invisible except through "holes":
//    glitch.js calls videoWindow(x, y, w, h, ms) and for that moment a rectangle of the page shows the video.
//    The copy plays the same clip and is kept on the same moment as the box.
// With "reduce motion" switched on (or in browsers that can't cut the holes) only the box stays.
//
// videos.json: {"videos": ["https://youtu.be/…", "https://www.youtube.com/watch?v=…", "VIDEO_ID",
//                          {"id": "…or a link", "start": 30, "end": 75}]}   (start/end in seconds: play just that part)

(() => {
  const box = document.getElementById("mv-box");
  if (!box) return;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches
    || !CSS.supports("clip-path", 'path("M0 0h1v1Z")'); // no holes possible: no copy either
  const vars = { autoplay: 1, mute: 1, playsinline: 1, fs: 0, rel: 0, modestbranding: 1, iv_load_policy: 3 };
  const btn = document.getElementById("mv-sound"), skip = document.getElementById("mv-next");

  // "https://youtu.be/ID", "…watch?v=ID", "…/embed/ID", "…/shorts/ID" or just "ID" → "ID"
  const idOf = (s) => {
    const m = String(s || "").match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/) || String(s || "").match(/^([\w-]{11})$/);
    return m ? m[1] : null;
  };
  const clipOf = (v) => {
    const id = idOf(typeof v === "object" && v ? v.id : v);
    if (!id) return null;
    const c = { videoId: id };
    if (v && typeof v === "object") {
      if (Number(v.start) > 0) c.startSeconds = Number(v.start);
      if (Number(v.end) > 0) c.endSeconds = Number(v.end);
    }
    return c;
  };

  let clips = [], at = 0, wantSound = false, player = null, ghost = null, ghostWrap = null, ghostFrame = null, fails = 0;
  const holes = new Set();

  // ---- the full-screen copy, seen only through holes ----
  function cover() { // size it to cover the screen like a background
    const W = innerWidth, H = innerHeight;
    const w = Math.max(W, H * 16 / 9), h = w * 9 / 16;
    Object.assign(ghostFrame.style, { width: `${w}px`, height: `${h}px`, left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px` });
  }
  function mask() {
    const d = [...holes].map((r) => `M${r.x | 0} ${r.y | 0}h${r.w | 0}v${r.h | 0}h${-(r.w | 0)}Z`).join("");
    ghostWrap.style.clipPath = d ? `path("${d}")` : "inset(100%)";
  }

  // ---- players: our own iframes (no allowfullscreen, so full screen is impossible), driven by YouTube's IFrame API ----
  function frame(where, clip, extra) {
    const q = new URLSearchParams({ ...vars, ...extra, enablejsapi: 1, origin: location.origin });
    if (clip.startSeconds) q.set("start", Math.floor(clip.startSeconds));
    if (clip.endSeconds) q.set("end", Math.ceil(clip.endSeconds));
    const f = Object.assign(document.createElement("iframe"), {
      src: `https://www.youtube-nocookie.com/embed/${clip.videoId}?${q}`, title: "music video",
      allow: "autoplay; encrypted-media; picture-in-picture", referrerPolicy: "strict-origin-when-cross-origin",
    });
    where.replaceWith(f);
    return f;
  }

  const PLAYING = 1, ENDED = 0;
  function sync() { // keep the copy on the same clip and moment as the box
    if (!player || !ghost || !ghost.getCurrentTime || !player.getCurrentTime) return;
    const playing = player.getPlayerState() === PLAYING;
    if (playing && ghost.getPlayerState() !== PLAYING) ghost.playVideo();
    if (!playing && ghost.getPlayerState() === PLAYING) ghost.pauseVideo();
    if (Math.abs(ghost.getCurrentTime() - player.getCurrentTime()) > 0.4) ghost.seekTo(player.getCurrentTime(), true);
  }

  function go(i) { // switch both players to clip i, with a glitch
    at = (i + clips.length) % clips.length;
    dispatchEvent(new Event("mv-switch"));
    wantSound = !player.isMuted(); // also catches YouTube's own speaker button
    btn.textContent = wantSound ? "sound off" : "sound on";
    player.loadVideoById(clips[at]);
    wantSound ? player.unMute() : player.mute(); // the sound stays as it was set
    if (ghost && ghost.loadVideoById) { ghost.loadVideoById(clips[at]); ghost.mute(); }
  }

  function start() {
    const mainFrame = frame(document.getElementById("mv-player"), clips[0], { controls: 1 });
    if (!calm) {
      ghostWrap = document.createElement("div");
      ghostWrap.className = "mv-ghost";
      ghostWrap.setAttribute("aria-hidden", "true");
      const spot = document.createElement("div");
      ghostWrap.append(spot);
      document.body.append(ghostWrap);
      ghostFrame = frame(spot, clips[0], { controls: 0, disablekb: 1 });
      ghostFrame.tabIndex = -1; ghostFrame.title = "";
      mask(); cover();
      addEventListener("resize", cover);
      window.videoWindow = (x, y, w, h, ms) => {
        if (!ghost || !ghost.getPlayerState || ghost.getPlayerState() !== PLAYING) return;
        const r = { x, y, w, h };
        holes.add(r); mask();
        setTimeout(() => { holes.delete(r); mask(); }, ms);
      };
    }

    window.onYouTubeIframeAPIReady = () => {
      player = new YT.Player(mainFrame, {
        events: {
          onReady: (e) => { e.target.mute(); e.target.playVideo(); btn.hidden = false; skip.hidden = clips.length < 2; },
          onStateChange: (e) => {
            if (e.data === PLAYING) { fails = 0; if (wantSound && player.isMuted()) player.unMute(); }
            if (e.data === ENDED) clips.length > 1 ? go(at + 1) : go(0);
            sync();
          },
          // a clip that can't be played here (removed, private, embedding off): go on to the next one
          onError: () => { if (++fails < clips.length) go(at + 1); },
        },
      });
      if (ghostFrame) {
        ghost = new YT.Player(ghostFrame, { events: { onReady: (e) => { e.target.mute(); e.target.playVideo(); } } });
        setInterval(sync, 3000);
      }
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    document.head.append(s);
  }

  btn.onclick = () => {
    if (!player || !player.isMuted) return;
    wantSound = player.isMuted();
    if (wantSound) { player.unMute(); player.playVideo(); } else player.mute();
    btn.textContent = wantSound ? "sound off" : "sound on";
  };
  skip.onclick = () => { if (player && player.loadVideoById) go(at + 1); };

  fetch("videos.json", { cache: "no-cache" }).then((r) => r.json()).then((d) => {
    clips = (d.videos || []).map(clipOf).filter(Boolean);
    if (clips.length) start(); else box.hidden = true;
  }).catch(() => { box.hidden = true; });
})();
