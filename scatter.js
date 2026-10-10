"use strict";
// Puts every .scatter link at a random spot in the first screenful, each in its own colour, without covering
// the page's content ([data-avoid] elements) or each other. New spots and colours on every visit.

(() => {
  document.documentElement.classList.add("js");
  const links = [...document.querySelectorAll(".scatter")];
  if (!links.length) return;
  const GAP = 14;

  // Home page: weird, clashing colours, random sizes and a bit of tilt. Other pages: one calm readable colour each.
  const WEIRD = ["#ff00aa", "#b6ff00", "#00ffd5", "#ff5e00", "#7a00ff", "#c8a200", "#00a2ff", "#ff2d55", "#4b5320",
    "#e4ff1a", "#ff8fab", "#00c26e", "#a0522d", "#ff00ff", "#14ffec", "#8b8000", "#ff3c00", "#6f00ff", "#ff9900", "#2e8b57"];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  const hue0 = Math.random() * 360;
  links.forEach((a, i) => {
    if (document.body.classList.contains("home")) {
      // clashing but still readable: text on a coloured block, or straight on the white page
      let fg, bg = null;
      if (Math.random() < 0.5) {
        do { fg = pick(WEIRD); bg = pick(WEIRD); } while (contrast(fg, bg) < 3);
      } else {
        do fg = pick(WEIRD); while (contrast(fg, "#ffffff") < 2.6);
      }
      a.style.color = fg;
      if (bg) { a.style.background = bg; a.style.padding = "2px 6px"; }
      a.style.textDecorationColor = pick(WEIRD);
      a.style.textDecorationThickness = `${1 + Math.floor(Math.random() * 4)}px`;
      a.style.fontSize = `${(1.1 + Math.random() * 1.6).toFixed(2)}rem`;
      a.style.transform = `rotate(${(Math.random() * 24 - 12).toFixed(1)}deg)`;
      return;
    }
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

  // Pages that add content later fire "relayout"; a link that is now covering something moves.
  addEventListener("relayout", () => {
    const avoid = [...document.querySelectorAll("[data-avoid]")].map((e) => box(e.getBoundingClientRect()));
    const covering = links.some((a) => a.classList.contains("placed") && avoid.some((t) => hits(box(a.getBoundingClientRect()), t)));
    if (covering) place();
  });

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
