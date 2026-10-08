"use strict";
// Puts every .scatter link at a random spot in the first screenful, each in its own colour, without covering
// the page's content ([data-avoid] elements) or each other. New spots and colours on every visit.

(() => {
  document.documentElement.classList.add("js");
  const links = [...document.querySelectorAll(".scatter")];
  if (!links.length) return;
  const GAP = 14;

  const hue0 = Math.random() * 360;
  links.forEach((a, i) => {
    const hue = (hue0 + (360 / links.length) * i + Math.random() * 30) % 360;
    // dark enough to read on white pages, light enough on dark ones (body.dark)
    a.style.color = `hsl(${Math.round(hue)} 85% ${document.body.classList.contains("dark") ? 65 : 40}%)`;
  });

  const box = (r) => ({ l: r.left + scrollX - GAP, t: r.top + scrollY - GAP, r: r.right + scrollX + GAP, b: r.bottom + scrollY + GAP });
  const hits = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

  function place() {
    const taken = [...document.querySelectorAll("[data-avoid]")].map((e) => box(e.getBoundingClientRect()));
    const W = document.documentElement.clientWidth, H = innerHeight;
    for (const a of links) {
      const w = a.offsetWidth, h = a.offsetHeight;
      let spot = null;
      for (let tries = 0; tries < 300 && !spot; tries++) {
        const x = 8 + Math.random() * Math.max(0, W - w - 16), y = 8 + Math.random() * Math.max(0, H - h - 16);
        const me = { l: x - GAP, t: y - GAP, r: x + w + GAP, b: y + h + GAP };
        if (!taken.some((t) => hits(me, t))) spot = { x, y, me };
      }
      if (!spot) { // no room on screen (small phone): drop it somewhere under the content instead
        const bottom = Math.max(H, ...taken.map((t) => t.b));
        const x = 8 + Math.random() * Math.max(0, W - w - 16), y = bottom + Math.random() * 40;
        spot = { x, y, me: { l: x - GAP, t: y - GAP, r: x + w + GAP, b: y + h + GAP } };
      }
      a.style.left = `${spot.x}px`;
      a.style.top = `${spot.y}px`;
      a.classList.add("placed");
      taken.push(spot.me);
    }
  }

  // Wait for images (the logo) so their size is known.
  if (document.readyState === "complete") place();
  else addEventListener("load", place);
  // Re-place only when the width changes (phones fire resize while scrolling as the address bar hides).
  let resized, lastW = innerWidth;
  addEventListener("resize", () => {
    if (innerWidth === lastW) return;
    lastW = innerWidth;
    clearTimeout(resized); resized = setTimeout(place, 250);
  });
})();
