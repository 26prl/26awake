"use strict";
// GIF wall: every entry in gifs.json, edge to edge, in a new random order on every visit.
// Entries: a URL (.gif/.webp/.png/.jpg image, .mp4/.webm clip, giphy.com or tenor.com page link) or
// {"src": gif, "mp4": clip, "page": link} as written by tools/resolve_gifs.py.

(() => {
  const wall = document.getElementById("wall");

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const TENOR = /^https?:\/\/(www\.)?tenor\.com\/(\w{2}\/)?view\/.*?(\d{6,})\/?$/i;

  // giphy.com/gifs/some-name-ID → the GIF file itself
  function direct(url) {
    try {
      const u = new URL(url);
      if (/(^|\.)giphy\.com$/.test(u.hostname) && u.pathname.startsWith("/gifs/")) {
        const id = u.pathname.split("/").filter(Boolean).pop().split("-").pop();
        return `https://media.giphy.com/media/${id}/giphy.gif`;
      }
      return u.href;
    } catch {
      return url; // a path inside the site, like gifs/thing.gif
    }
  }

  const image = (src) => Object.assign(document.createElement("img"), { src, alt: "", loading: "lazy", decoding: "async" });

  function video(src, fallback) {
    const v = Object.assign(document.createElement("video"), { src, autoplay: true, loop: true, muted: true, playsInline: true, preload: "metadata" });
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.addEventListener("error", () => (fallback ? v.replaceWith(withDrop(image(fallback))) : v.remove()));
    return v;
  }

  // dead links just disappear
  function withDrop(el) {
    el.addEventListener("error", () => el.remove());
    return el;
  }

  function tile(item) {
    const entry = typeof item === "string" ? { src: item } : item;
    const tenor = (entry.src || entry.page || "").match(TENOR);
    if (!entry.mp4 && tenor && !/media\d*\.tenor\.com/.test(entry.src || "")) {
      // not resolved yet: Tenor's own player
      const f = Object.assign(document.createElement("iframe"), { src: `https://tenor.com/embed/${tenor[3]}`, loading: "lazy", title: "gif" });
      f.className = "tenor";
      return f;
    }
    if (entry.mp4) return video(entry.mp4, entry.src);
    const src = direct(entry.src);
    return /\.(mp4|webm)(\?|$)/i.test(src) ? video(src) : withDrop(image(src));
  }

  fetch("gifs.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((data) => {
      const items = shuffle((data.gifs || []).slice());
      if (!items.length) {
        wall.replaceChildren(Object.assign(document.createElement("p"), { className: "empty wall-empty", textContent: "no gifs yet" }));
        return;
      }
      wall.replaceChildren(...items.map(tile));
    })
    .catch(() => {
      wall.replaceChildren(Object.assign(document.createElement("p"), { className: "empty wall-empty", textContent: "couldn't load the gifs" }));
    });
})();
