"use strict";
// The game pages are the rooms behind the corridor's doors (corridor.js), drawn the same way: you stand in the
// doorway, the game hangs flat on the back wall (so it stays sharp and playable), walls, carpet and ceiling tiles
// run back to it in perspective, one light buzzes overhead. The ranking is a sheet of paper pinned to the left wall
// when there's room for it, the music player is a TV in the corner (site.css, under .room).
// Each room is lit a little differently. The light dips now and then (slowly, never more than a couple of times a
// second); the page fades in when you arrive and out when you go back. Phones get the plain dark look, no room.

(() => {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const phone = window.isPhone && window.isPhone();
  const body = document.body;
  body.append(Object.assign(document.createElement("div"), { className: "room-grain" }));
  const dark = Object.assign(document.createElement("div"), { className: "room-dark" });
  body.append(dark);

  // ---- the room ----
  const col = document.querySelector(".g8, .ms, .sd");
  const rank = col && col.querySelector(".g8-rank");
  const LAMP = { g8: "255,226,160", ms: "205,225,255", sd: "225,240,200" }[col ? col.className.split(" ")[0] : "g8"] || "255,226,160";
  let cv = null, x = null, flick = 1;

  function layout() {             // the ranking goes on the side wall if there's room beside the game
    if (!rank) return;
    body.classList.remove("wide");
    const r = col.getBoundingClientRect();
    body.classList.toggle("wide", !phone && r.left > 330 && innerHeight > 560);
  }

  function draw() {
    if (!cv) return;
    const de = document.documentElement;
    const W = de.clientWidth, H = Math.max(de.scrollHeight, innerHeight), dpr = Math.min(devicePixelRatio || 1, 1.5);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = `${W}px`; cv.style.height = `${H}px`; }
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    // the back wall: around the game, in page coordinates
    const r = col.getBoundingClientRect(), sy = scrollY, pad = 44;
    const B = { x0: Math.max(24, r.left - pad), y0: Math.max(24, r.top + sy - pad), x1: Math.min(W - 24, r.right + pad), y1: Math.min(H - 24, r.bottom + sy + pad) };
    const O = { x0: 0, y0: 0, x1: W, y1: H };
    const R = (s) => ({ x0: O.x0 + (B.x0 - O.x0) * s, y0: O.y0 + (B.y0 - O.y0) * s, x1: O.x1 + (B.x1 - O.x1) * s, y1: O.y1 + (B.y1 - O.y1) * s });
    const poly = (pts, fill) => { x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); x.fillStyle = fill; x.fill(); };
    // surfaces (the corridor's colours)
    poly([[0, 0], [W, 0], [B.x1, B.y0], [B.x0, B.y0]], "#4c4a3f");                 // ceiling
    poly([[0, H], [W, H], [B.x1, B.y1], [B.x0, B.y1]], "#211b11");                 // carpet
    poly([[0, 0], [B.x0, B.y0], [B.x0, B.y1], [0, H]], "#3e3720");                 // left wall
    poly([[W, 0], [B.x1, B.y0], [B.x1, B.y1], [W, H]], "#463e24");                 // right wall
    poly([[B.x0, B.y0], [B.x1, B.y0], [B.x1, B.y1], [B.x0, B.y1]], "#3a3320");     // back wall
    // depth lines: ceiling tiles, carpet seams, wall panels (perspective spacing)
    const N = 7, depth = (k) => (1 - 1 / (1 + k * .45)) / (1 - 1 / (1 + N * .45));
    x.lineWidth = 1; x.strokeStyle = "rgba(0,0,0,.2)";
    for (let k = 1; k < N; k++) {
      const q = R(depth(k));
      x.beginPath(); x.moveTo(q.x0, q.y0); x.lineTo(q.x1, q.y0); x.moveTo(q.x0, q.y1); x.lineTo(q.x1, q.y1);
      x.moveTo(q.x0, q.y0); x.lineTo(q.x0, q.y1); x.moveTo(q.x1, q.y0); x.lineTo(q.x1, q.y1); x.stroke();
    }
    for (let i = 1; i < 6; i++) {          // ceiling tile rows running back
      const t = i / 6; x.beginPath(); x.moveTo(W * t, 0); x.lineTo(B.x0 + (B.x1 - B.x0) * t, B.y0); x.stroke();
    }
    x.strokeStyle = "rgba(0,0,0,.4)"; x.lineWidth = 2;                          // skirting and corners
    x.beginPath(); x.moveTo(0, H); x.lineTo(B.x0, B.y1); x.lineTo(B.x1, B.y1); x.lineTo(W, H);
    x.moveTo(0, 0); x.lineTo(B.x0, B.y0); x.lineTo(B.x1, B.y0); x.lineTo(W, 0); x.stroke();
    // the light: a panel halfway in, its glow on the ceiling, the back wall and the carpet
    const l0 = R(.38), l1 = R(.56), cx = (B.x0 + B.x1) / 2, hw0 = (l0.x1 - l0.x0) * .13, hw1 = (l1.x1 - l1.x0) * .13;
    poly([[cx - hw0, l0.y0], [cx + hw0, l0.y0], [cx + hw1, l1.y0], [cx - hw1, l1.y0]], flick > .5 ? `rgb(${LAMP})` : "#3a382e");
    const glow = (gx, gy, rad, a, sx = 1) => {
      x.save(); x.translate(gx, gy); x.scale(sx, 1);
      const g = x.createRadialGradient(0, 0, 0, 0, 0, rad); g.addColorStop(0, `rgba(${LAMP},${a * flick})`); g.addColorStop(1, `rgba(${LAMP},0)`);
      x.fillStyle = g; x.fillRect(-rad, -rad, rad * 2, rad * 2); x.restore();
    };
    glow(cx, (l0.y0 + l1.y0) / 2, Math.max(W, H) * .35, .16);
    glow(cx, B.y0 + 20, (B.x1 - B.x0) * .7, .1);
    const f0 = R(.45); glow(cx, f0.y1, (f0.x1 - f0.x0) * .35, .14, 1);
    // darkness: the corners and the edges, the doorway you came through
    const g = x.createRadialGradient(cx, (B.y0 + B.y1) / 2, Math.min(B.x1 - B.x0, B.y1 - B.y0) * .5, cx, (B.y0 + B.y1) / 2, Math.hypot(W, H) * .65);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.72)");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(0, 0, W, 6); x.fillRect(0, 0, 6, H); x.fillRect(W - 6, 0, 6, H);   // the door frame
  }

  if (col && !phone) {
    body.classList.add("drawn");
    cv = Object.assign(document.createElement("canvas"), { className: "room-canvas" });
    cv.setAttribute("aria-hidden", "true");
    body.prepend(cv);
    x = cv.getContext("2d");
    let queued = false;
    const redraw = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; draw(); }); } };
    layout(); draw();
    addEventListener("resize", () => { layout(); redraw(); });
    new ResizeObserver(redraw).observe(col);
    new ResizeObserver(redraw).observe(document.documentElement);
    if (document.fonts) document.fonts.ready.then(redraw);
    window.roomRedraw = redraw;
  }

  // the light dips: once, or twice in a row, every 8-25 seconds
  if (!calm) (function dip() {
    setTimeout(() => {
      if (!document.hidden) {
        const n = Math.random() < .35 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          setTimeout(() => { dark.classList.add("on"); flick = .2; draw(); }, i * 450);
          setTimeout(() => { dark.classList.remove("on"); flick = 1; draw(); }, i * 450 + 90 + Math.random() * 120);
        }
      }
      dip();
    }, 8000 + Math.random() * 17000);
  })();

  // going back: fade out first
  const back = document.querySelector(".back");
  if (back && !calm) back.addEventListener("click", (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
    e.preventDefault();
    body.classList.add("leaving");
    setTimeout(() => { location.href = back.href; }, 330);
  });
  // coming back to this page from the browser's history: don't stay faded out
  addEventListener("pageshow", (e) => { if (e.persisted) body.classList.remove("leaving"); });
})();
