"use strict";
// Glitch effects for the home page and the games: scanlines, RGB-split bursts on the logo, titles and links,
// scrambled letters, inverted "screen tear" strips and, on the home page, a whole-screen jolt now and then.
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
        if (Math.random() < 0.15) jolt();
      } else {
        for (const t of texts) if (Math.random() < 0.5) glitchText(t);
        if (Math.random() < 0.3) tear(Math.ceil(rnd(0, 2)));
      }
    }
    setTimeout(burst, home ? rnd(900, 3500) : rnd(4000, 11000));
  }
  setTimeout(burst, home ? 600 : 2500);

  // clicking a link on the home page: one big glitch, then go
  if (home) {
    for (const a of document.querySelectorAll(".scatter")) {
      a.addEventListener("click", (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
        e.preventDefault();
        glitchText(a, 400); glitchLogo(400, true); tear(6, true); jolt(300);
        setTimeout(() => { location.href = a.href; }, 320);
      });
    }
  }
})();
