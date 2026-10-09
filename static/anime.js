"use strict";
// anime page: plays direct video links listed in anime.json —
//   {"videos": [{"title": "Episode 1", "src": "https://…/video.mp4" | "https://…/master.m3u8", "poster": "optional.jpg"}]}
// .mp4/.webm play natively; .m3u8 (HLS) streams play through hls.js (vendor/), or natively in Safari.
// The source has to allow its video to be played on other sites (CORS), otherwise the browser refuses it.

(() => {
  const $ = (id) => document.getElementById(id);
  const video = $("an-video"), list = $("an-list"), msg = $("an-msg");
  let items = [], current = -1, hls = null;

  const isHls = (src) => /\.m3u8(\?|#|$)/i.test(src);

  function play(i, autoplay = true) {
    const it = items[i];
    if (!it) return;
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
    if (autoplay) video.play().catch(() => {});
    $("an-title").textContent = it.title || "";
    [...list.children].forEach((li, j) => li.classList.toggle("on", j === i));
    try { localStorage.setItem("anime-last", String(i)); } catch { /* private mode */ }
  }

  video.addEventListener("error", () => {
    if (!hls) msg.textContent = "This video won't play here — the link may be dead or the site doesn't allow it.";
  });
  video.addEventListener("ended", () => { if (current + 1 < items.length) play(current + 1); });

  fetch("anime.json", { cache: "no-cache" }).then((r) => r.json()).then((d) => {
    items = (d.videos || []).filter((v) => v && typeof v.src === "string" && /^https?:\/\//.test(v.src));
    if (!items.length) {
      document.querySelector(".an-stage").hidden = true;
      list.replaceWith(Object.assign(document.createElement("p"), { className: "empty", textContent: "Nothing here yet." }));
      dispatchEvent(new Event("relayout"));
      return;
    }
    list.replaceChildren(...items.map((it, i) => {
      const li = document.createElement("li");
      const b = Object.assign(document.createElement("button"), { type: "button", textContent: it.title || `Video ${i + 1}` });
      b.onclick = () => play(i);
      li.append(b);
      return li;
    }));
    let last = 0;
    try { last = Math.min(items.length - 1, Math.max(0, Number(localStorage.getItem("anime-last")) || 0)); } catch { /* private mode */ }
    play(last, false);
    dispatchEvent(new Event("relayout"));
  }).catch(() => { msg.textContent = "Couldn't load the list."; });
})();
