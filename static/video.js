"use strict";
// The music video on the home page.
//  * The box (#mv-box, under the logo) plays it all the time: muted at first (browsers only autoplay without sound),
//    "sound on" turns the sound on; it loops, and full screen is switched off.
//  * A second, silent copy fills the whole screen behind a clip mask, so it's invisible except through "holes":
//    glitch.js calls videoWindow(x, y, w, h, ms) and for that moment a rectangle of the page shows the video.
//    The copy is kept in step with the box (same moment, same play/pause).
// With "reduce motion" switched on (or in browsers that can't cut the holes) only the box stays.

(() => {
  const ID = "1cqJ3HOf-24";
  const box = document.getElementById("mv-box");
  if (!box) return;
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches
    || !CSS.supports("clip-path", 'path("M0 0h1v1Z")'); // no holes possible: no copy either
  const vars = { autoplay: 1, mute: 1, loop: 1, playlist: ID, playsinline: 1, fs: 0, rel: 0, modestbranding: 1, iv_load_policy: 3 };

  // ---- the full-screen copy, seen only through holes ----
  let ghostWrap = null, ghost = null;
  const holes = new Set();

  function cover() { // size it to cover the screen like a background
    const W = innerWidth, H = innerHeight;
    const w = Math.max(W, H * 16 / 9), h = w * 9 / 16;
    Object.assign(ghostWrap.firstElementChild.style, { width: `${w}px`, height: `${h}px`, left: `${(W - w) / 2}px`, top: `${(H - h) / 2}px` });
  }

  function mask() {
    const d = [...holes].map((r) => `M${r.x | 0} ${r.y | 0}h${r.w | 0}v${r.h | 0}h${-(r.w | 0)}Z`).join("");
    ghostWrap.style.clipPath = d ? `path("${d}")` : "inset(100%)";
  }

  if (!calm) {
    ghostWrap = document.createElement("div");
    ghostWrap.className = "mv-ghost";
    ghostWrap.setAttribute("aria-hidden", "true");
    ghostWrap.append(Object.assign(document.createElement("div"), { id: "mv-ghost" }));
    document.body.append(ghostWrap);
    mask();
    window.videoWindow = (x, y, w, h, ms) => {
      if (!ghost || !ghost.getPlayerState || ghost.getPlayerState() !== YT.PlayerState.PLAYING) return;
      const r = { x, y, w, h };
      holes.add(r); mask();
      setTimeout(() => { holes.delete(r); mask(); }, ms);
    };
  }

  // ---- players: our own iframes (no allowfullscreen, so full screen is impossible), driven by YouTube's IFrame API ----
  let player = null;
  const btn = document.getElementById("mv-sound");

  function frame(where, extra) {
    const q = new URLSearchParams({ ...vars, ...extra, enablejsapi: 1, origin: location.origin });
    const f = Object.assign(document.createElement("iframe"), {
      src: `https://www.youtube-nocookie.com/embed/${ID}?${q}`, title: "music video",
      allow: "autoplay; encrypted-media; picture-in-picture", referrerPolicy: "strict-origin-when-cross-origin",
    });
    where.replaceWith(f);
    return f;
  }
  const mainFrame = frame(document.getElementById("mv-player"), { controls: 1 });
  const ghostFrame = ghostWrap ? frame(document.getElementById("mv-ghost"), { controls: 0, disablekb: 1 }) : null;
  if (ghostFrame) { ghostFrame.tabIndex = -1; ghostFrame.title = ""; cover(); addEventListener("resize", cover); }

  function sync() { // keep the copy on the same moment as the box
    if (!player || !ghost || !ghost.getCurrentTime || !player.getCurrentTime) return;
    const playing = player.getPlayerState() === YT.PlayerState.PLAYING;
    if (playing && ghost.getPlayerState() !== YT.PlayerState.PLAYING) ghost.playVideo();
    if (!playing && ghost.getPlayerState() === YT.PlayerState.PLAYING) ghost.pauseVideo();
    if (Math.abs(ghost.getCurrentTime() - player.getCurrentTime()) > 0.4) ghost.seekTo(player.getCurrentTime(), true);
  }

  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player(mainFrame, {
      events: { onReady: (e) => { e.target.mute(); e.target.playVideo(); btn.hidden = false; }, onStateChange: sync },
    });
    if (ghostFrame) {
      ghost = new YT.Player(ghostFrame, { events: { onReady: (e) => { e.target.mute(); e.target.playVideo(); } } });
      setInterval(sync, 3000);
    }
  };

  btn.onclick = () => {
    if (!player || !player.isMuted) return;
    if (player.isMuted()) { player.unMute(); player.playVideo(); btn.textContent = "sound off"; }
    else { player.mute(); btn.textContent = "sound on"; }
  };

  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  document.head.append(s);
})();
