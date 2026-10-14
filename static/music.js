"use strict";
// The mini music-video player on the game pages: a small player in the bottom-right corner playing the same clips
// as the home page box, carrying on where the music was (mvqueue.js). Muted until "sound on"; once the sound is on
// it stays on across clips and pages (it comes back with the first click or key press on a new page, because
// browsers don't allow sound before that). "next" skips, × closes it (and it stays closed until "♪ music" opens it
// again). No full screen. Kept at YouTube's minimum player size (200 px high). On screens where the corner would
// cover the game board, it sits at the bottom of the page instead.

(() => {
  const Q = window.MV;
  if (!Q) return;
  const vars = { autoplay: 1, mute: 1, playsinline: 1, fs: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, controls: 1 };
  const PLAYING = 1, ENDED = 0;
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

  const box = document.createElement("div");
  box.className = "mini-mv"; box.setAttribute("data-avoid", "");
  box.innerHTML = `<div class="mini-mv-video"><div id="mini-mv-player"></div></div>
    <div class="mini-mv-bar"><span class="mini-mv-now"></span><button type="button" data-a="sound">sound on</button>
    <button type="button" data-a="next">next</button><button type="button" data-a="close" aria-label="close">×</button></div>`;
  const pill = Object.assign(document.createElement("button"), { type: "button", className: "mini-mv-pill", textContent: "♪ music" });
  const $ = (a) => box.querySelector(`[data-a="${a}"]`);
  const now = box.querySelector(".mini-mv-now");

  let player = null, wantSound = false, fails = 0, started = false;
  const label = () => {
    $("sound").textContent = wantSound ? "sound off" : "sound on";
    now.textContent = `♪ ${Q.at + 1} / ${Q.clips.length}`;
  };
  const save = () => { if (player && player.getCurrentTime) Q.save(player.getCurrentTime()); };

  function frame(clip) {
    const q = new URLSearchParams({ ...vars, enablejsapi: 1, origin: location.origin });
    if (clip.startSeconds) q.set("start", Math.floor(clip.startSeconds));
    if (clip.endSeconds) q.set("end", Math.ceil(clip.endSeconds));
    const f = Object.assign(document.createElement("iframe"), {
      src: `https://www.youtube-nocookie.com/embed/${clip.videoId}?${q}`, title: "music video",
      allow: "autoplay; encrypted-media; picture-in-picture", referrerPolicy: "strict-origin-when-cross-origin",
    });
    box.querySelector("#mini-mv-player").replaceWith(f);
    return f;
  }

  function go() {
    const clip = Q.next();
    wantSound = !player.isMuted(); Q.sound = wantSound; Q.save(0);
    player.loadVideoById(clip);
    wantSound ? player.unMute() : player.mute();
    label();
  }

  function start() {
    if (started) return; started = true;
    const f = frame(Q.first());
    const boot = () => {
      player = new YT.Player(f, {
        events: {
          onReady: (e) => { e.target.mute(); e.target.playVideo(); },
          onStateChange: (e) => {
            if (e.data === PLAYING) { fails = 0; if (wantSound && player.isMuted()) player.unMute(); }
            if (e.data === ENDED) go();
          },
          onError: () => { if (++fails < Q.clips.length) go(); },
        },
      });
    };
    if (window.YT && YT.Player) boot();
    else {
      window.onYouTubeIframeAPIReady = boot;
      const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.append(s);
    }
  }

  function show(open) {
    box.hidden = !open; pill.hidden = open;
    set("mv-mini-closed", open ? "" : "1");
    if (open) { start(); if (player && player.playVideo) player.playVideo(); }
    else if (player && player.pauseVideo) { save(); player.pauseVideo(); }
  }

  $("sound").onclick = () => {
    if (!player || !player.isMuted) return;
    wantSound = player.isMuted();
    if (wantSound) { player.unMute(); player.playVideo(); } else player.mute();
    Q.sound = wantSound; save(); label();
  };
  $("next").onclick = () => { if (player && player.loadVideoById) go(); };
  $("close").onclick = () => show(false);
  pill.onclick = () => show(true);

  setInterval(save, 2000);
  addEventListener("pagehide", save);
  const wake = () => { if (wantSound && player && player.unMute && !box.hidden) { player.unMute(); player.playVideo(); } };
  addEventListener("pointerdown", wake, { once: true, capture: true }); addEventListener("keydown", wake, { once: true, capture: true });

  Q.load().then((ok) => {
    if (!ok) return;
    wantSound = Q.sound; label();
    document.body.append(box, pill);
    show(get("mv-mini-closed") !== "1");
    // if the corner player would sit over the game board (wide board, small screen), it moves to the bottom of the
    // page instead (only its style changes: moving the player itself would restart the song)
    const board = document.querySelector("#g8-board, #ms-grid, .sd-grid");
    const fit = () => {
      if (!board) return;
      const r = board.getBoundingClientRect();
      box.classList.toggle("docked", r.right + 12 > innerWidth - 16 - 356);
      pill.classList.toggle("docked", box.classList.contains("docked"));
    };
    fit(); addEventListener("resize", fit);
    if (board && window.ResizeObserver) new ResizeObserver(fit).observe(board);
  }).catch(() => {});
})();
