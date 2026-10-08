"use strict";
// GIF wall: every entry in gifs.json, edge to edge, newest first. Entries are URLs (a .gif/.webp/.png/.jpg image,
// an .mp4/.webm clip, or a giphy.com page link) or {"src": "...", "title": "..."}.

(() => {
  const wall = document.getElementById("wall");

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

  function tile(item) {
    const src = direct(typeof item === "string" ? item : item.src);
    const title = typeof item === "string" ? "" : item.title || "";
    let media;
    if (/\.(mp4|webm)(\?|$)/i.test(src)) {
      media = Object.assign(document.createElement("video"), { src, autoplay: true, loop: true, muted: true, playsInline: true });
      media.setAttribute("muted", "");
    } else {
      media = Object.assign(document.createElement("img"), { src, alt: title, loading: "lazy", decoding: "async" });
    }
    media.title = title;
    media.addEventListener("error", () => media.remove()); // dead links just disappear
    return media;
  }

  fetch("gifs.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((data) => {
      const items = (data.gifs || []).slice().reverse();
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
