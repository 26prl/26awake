"use strict";
// Glitch effects for the home page and the games: scanlines, RGB-split bursts on the logo, titles and links,
// scrambled letters, squares and rectangles popping out in clusters, inverted "screen tear" strips and, on the
// home page, a whole-screen jolt now and then.
// Links glitch while hovered, and a link on the home page glitches hard before it opens.
// Everything sits on top with pointer-events: none, so it never gets in the way of playing.
// With "reduce motion" switched on in the system settings only the scanlines stay.

(() => {
  const home = document.body.classList.contains("home");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const COLORS = ["#ff00aa", "#00ffd5", "#b6ff00", "#ff5e00", "#7a00ff", "#00a2ff"];
  const CHARS = "!<>-_\\/[]{}=+*^?#░▒▓█▀▄$%&@0123456789";

  document.body.append(Object.assign(document.createElement("div"), { className: "gl-scan" }));
  if (calm) return;

  // ---- text: coloured copies (::before/::after, from data-text) slide apart in slices ----
  const texts = [...document.querySelectorAll(".scatter, .back, h1")];
  for (const t of texts) { t.dataset.text = t.textContent; t.classList.add("gl-txt"); }

  function glitchText(t, ms = rnd(160, 420)) {
    t.style.setProperty("--gl-a", pick(COLORS));
    t.style.setProperty("--gl-b", pick(COLORS));
    t.classList.add("gl-on");
    scramble(t, ms * 0.6);
    setTimeout(() => { if (!t.matches(":hover")) t.classList.remove("gl-on"); }, ms);
  }

  // a few letters turn into junk for a moment
  function scramble(t, ms) {
    const real = t.dataset.text;
    if (t.children.length || !real) return;
    const end = Date.now() + ms;
    const step = () => {
      if (Date.now() >= end) { t.textContent = real; return; }
      t.textContent = [...real].map((c) => (c !== " " && Math.random() < 0.35 ? pick(CHARS) : c)).join("");
      setTimeout(step, 50);
    };
    step();
  }

  for (const a of document.querySelectorAll(".scatter, .back")) {
    a.addEventListener("mouseenter", () => glitchText(a, 300));
    a.addEventListener("mouseleave", () => a.classList.remove("gl-on"));
  }

  // ---- logo: shifted, colour-flipped slices of the picture on top of it ----
  const logo = document.querySelector(".logo");
  const slices = logo ? [0, 1, 2].map(() => {
    const s = logo.cloneNode();
    s.removeAttribute("data-avoid"); s.alt = ""; s.className = "gl-slice";
    s.hidden = true;
    document.body.append(s);
    return s;
  }) : [];

  function glitchLogo(ms = rnd(150, 400), hard = false) {
    if (!logo) return;
    const r = logo.getBoundingClientRect();
    for (const s of slices) {
      const top = rnd(0, 85), h = rnd(4, hard ? 40 : 18);
      Object.assign(s.style, {
        left: `${r.left + scrollX}px`, top: `${r.top + scrollY}px`, width: `${r.width}px`, height: `${r.height}px`,
        clipPath: `inset(${top}% 0 ${Math.max(0, 100 - top - h)}% 0)`,
        translate: `${rnd(-1, 1) * (hard ? 40 : 18)}px 0`,
        filter: pick(["invert(1)", "hue-rotate(90deg) saturate(4)", `drop-shadow(3px 0 ${pick(COLORS)})`, "none"]),
      });
      s.hidden = false;
    }
    logo.classList.add("gl-split");
    setTimeout(() => { for (const s of slices) s.hidden = true; logo.classList.remove("gl-split"); }, ms);
  }

  // ---- screen tears: thin strips that flip the colours of whatever is under them ----
  function tear(n = 1, hard = false) {
    for (let i = 0; i < n; i++) {
      const d = document.createElement("div");
      d.className = "gl-tear";
      d.style.top = `${rnd(0, 96)}vh`;
      d.style.height = `${rnd(2, hard ? 60 : home ? 26 : 8)}px`;
      d.style.translate = `${rnd(-30, 30)}px 0`;
      if (Math.random() < 0.4) d.style.backdropFilter = d.style.webkitBackdropFilter = `invert(1) hue-rotate(${Math.round(rnd(0, 360))}deg)`;
      document.body.append(d);
      setTimeout(() => d.remove(), rnd(60, 180));
    }
  }

  // ---- blocks: squares and rectangles that pop out in clusters, like corrupted pixels ----
  // In the games they stay off the board and the ranking ([data-avoid]), so they never hide anything.
  const STYLES = [
    (c) => ({ background: c }),
    (c) => ({ background: `repeating-linear-gradient(0deg, ${c} 0 2px, transparent 2px 4px)` }),
    (c) => ({ background: `repeating-linear-gradient(90deg, ${c} 0 3px, ${pick(COLORS)} 3px 6px)` }),
    (c) => ({ background: `repeating-conic-gradient(${c} 0 25%, ${pick(COLORS)} 0 50%) 0 0 / ${pick([4, 6, 8])}px ${pick([4, 6, 8])}px` }),
    (c) => ({ outline: `2px solid ${c}`, outlineOffset: "-2px" }),
    () => ({ backdropFilter: `invert(1) hue-rotate(${Math.round(rnd(0, 360))}deg)`, webkitBackdropFilter: "invert(1)" }),
    () => ({ background: "#111" }),
  ];
  const avoid = () => (home ? [] : [...document.querySelectorAll("[data-avoid]")].map((e) => e.getBoundingClientRect()));
  const overlaps = (x, y, w, h, rs) => rs.some((r) => x < r.right + 6 && x + w > r.left - 6 && y < r.bottom + 6 && y + h > r.top - 6);

  function blocks(n = 1, big = false) {
    const W = innerWidth, H = innerHeight, rs = avoid();
    for (let k = 0; k < n; k++) {
      // a cluster: one spot, a few pieces stacked in rows next to it
      let cx = 0, cy = 0, ok = false;
      for (let t = 0; t < 30 && !ok; t++) {
        cx = rnd(0, W - 40); cy = rnd(0, H - 30);
        ok = !overlaps(cx, cy, 120, 80, rs);
      }
      if (!ok) continue;
      const pieces = Math.ceil(rnd(1, big ? 9 : 6));
      const life = rnd(90, big ? 500 : 350);
      for (let i = 0; i < pieces; i++) {
        const w = Math.round(pick([rnd(4, 14), rnd(14, 60), rnd(40, big ? 260 : 140)]));
        const h = Math.round(pick([w, rnd(3, 10), rnd(8, big ? 90 : 40)])); // squares, thin bars, rectangles
        const x = cx + rnd(-30, 90), y = cy + rnd(-20, 60);
        if (overlaps(x, y, w, h, rs)) continue;
        // pieces can be holes that show a music video, where a page offers window.videoWindow
        if (window.videoWindow && w >= 20 && h >= 14 && Math.random() < 0.4) { window.videoWindow(x, y, w, h, life * rnd(0.8, 1.6)); continue; }
        const d = document.createElement("div");
        d.className = "gl-block" + (Math.random() < 0.5 ? " gl-flick" : "");
        Object.assign(d.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }, pick(STYLES)(pick(COLORS)));
        if (Math.random() < 0.3) d.style.mixBlendMode = pick(["difference", "multiply", "exclusion"]);
        document.body.append(d);
        // some jump sideways once before vanishing
        if (home && Math.random() < 0.4) setTimeout(() => { d.style.translate = `${rnd(-60, 60)}px ${rnd(-6, 6)}px`; }, life / 2);
        setTimeout(() => d.remove(), life * rnd(0.6, 1.2));
      }
    }
  }

  (function popLoop() {
    if (!document.hidden) blocks(home ? Math.ceil(rnd(0, 3)) : 1);
    // now and then a bigger window into the video, on its own
    if (!document.hidden && window.videoWindow && Math.random() < 0.3) {
      const w = rnd(90, Math.min(340, innerWidth * 0.6)), h = rnd(40, w * 0.6);
      window.videoWindow(rnd(0, innerWidth - w), rnd(0, innerHeight - h), w, h, rnd(250, 900));
    }
    setTimeout(popLoop, home ? rnd(350, 1500) : rnd(2500, 7000));
  })();

  function jolt(ms = 140) {
    document.documentElement.classList.add("gl-jolt");
    setTimeout(() => document.documentElement.classList.remove("gl-jolt"), ms);
  }

  // ---- random bursts: often and loud on the home page, rarer and quieter in the games ----
  function burst() {
    if (!document.hidden) {
      if (home) {
        if (Math.random() < 0.7) glitchLogo();
        for (const t of texts) if (Math.random() < 0.35) glitchText(t);
        if (Math.random() < 0.6) tear(Math.ceil(rnd(0, 4)));
        if (Math.random() < 0.5) blocks(Math.ceil(rnd(1, 4)), Math.random() < 0.3);
        if (Math.random() < 0.15) jolt();
      } else {
        for (const t of texts) if (Math.random() < 0.5) glitchText(t);
        if (Math.random() < 0.3) tear(Math.ceil(rnd(0, 2)));
      }
    }
    setTimeout(burst, home ? rnd(900, 3500) : rnd(4000, 11000));
  }
  setTimeout(burst, home ? 600 : 2500);

  // a music video switching to the next clip ("mv-switch"): a big glitch
  addEventListener("mv-switch", () => { glitchLogo(450, true); tear(5, true); blocks(5, true); jolt(250); });

  // clicking a link on the home page: one big glitch, then go
  if (home) {
    for (const a of document.querySelectorAll(".scatter")) {
      a.addEventListener("click", (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
        e.preventDefault();
        glitchText(a, 400); glitchLogo(400, true); tear(6, true); blocks(6, true); jolt(300);
        setTimeout(() => { location.href = a.href; }, 320);
      });
    }
  }
})();
