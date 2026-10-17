"use strict";
// The game pages are the rooms behind the corridor's doors (corridor.js), drawn the same way: you stand in the
// doorway, the game hangs flat on the back wall (so it stays sharp and playable), walls, carpet and ceiling tiles
// run back to it in perspective, one light buzzes overhead. The ranking is a sheet of paper pinned to the left wall
// when there's room for it, the music player is a TV in the corner (site.css, under .room).
// Each room is lit and furnished differently: an armchair, a rug and a floor lamp with 2048; a desk with an old
// monitor and a filing cabinet with minesweeper; a bookshelf, a little table lamp and papers on the floor with sudoku.
// Sounds (sfx.js): the light's buzz, the room's tone, and now and then someone knocks on the door behind you, walks
// past outside, a door slams somewhere; rarely the light cuts out for a moment. The light dips now and then (slowly,
// never more than a couple of times a second); the page fades in when you arrive and out when you go back.
// Phones get the plain dark look, no room.

(() => {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const phone = window.isPhone && window.isPhone();
  const body = document.body;
  body.append(Object.assign(document.createElement("div"), { className: "room-grain" }));
  const dark = Object.assign(document.createElement("div"), { className: "room-dark" });
  body.append(dark);

  // ---- the room ----
  const col = document.querySelector(".g8, .ms, .sd");
  const rank = col && col.querySelector(".g8-rank");
  const KIND = col ? col.className.split(" ")[0] : "g8";
  const LAMP = { g8: "255,226,160", ms: "205,225,255", sd: "225,240,200" }[KIND] || "255,226,160";
  const SFX = window.SFX || new Proxy({}, { get: () => () => {} });
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
    props(R, B, W, H, poly, glow);
    // darkness: the corners and the edges, the doorway you came through
    const g = x.createRadialGradient(cx, (B.y0 + B.y1) / 2, Math.min(B.x1 - B.x0, B.y1 - B.y0) * .5, cx, (B.y0 + B.y1) / 2, Math.hypot(W, H) * .65);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.72)");
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = "rgba(0,0,0,.35)"; x.fillRect(0, 0, W, 6); x.fillRect(0, 0, 6, H); x.fillRect(W - 6, 0, 6, H);   // the door frame
  }

  // ---- furniture: boxes standing on the carpet, in metres (the room is 3.6 m wide and 2.6 m high) ----
  function props(R, B, W, H, poly, glow) {
    const F = (u, s) => { const nx = W * u, fx = B.x0 + (B.x1 - B.x0) * u; return [nx + (fx - nx) * s, H + (B.y1 - H) * s]; };
    const hs = (s) => { const q = R(s); return (q.y1 - q.y0) / 2.6; };          // pixels per metre at depth s
    const up = (p, s, m) => [p[0], p[1] - m * hs(s)];
    const shade = (pts, fill, k = .45) => {          // a face: its colour, darker towards the floor
      poly(pts, fill);
      const ys = pts.map((q) => q[1]), g = x.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
      g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${k})`); poly(pts, g);
    };
    // a box from (u0..u1) wide, (s0..s1) deep, standing from h0 to h1 metres; it leaves a soft shadow on the carpet
    function box(u0, u1, s0, s1, h0, h1, front, top, side) {
      const fl = F(u0, s0), fr = F(u1, s0), bl = F(u0, s1), br = F(u1, s1);
      if (h0 === 0) {
        const c = F((u0 + u1) / 2, (s0 + s1) / 2), rw = (fr[0] - fl[0]) * .75 + 10, rh = (fl[1] - bl[1]) * .9 + 6;
        const g = x.createRadialGradient(c[0], c[1], 0, c[0], c[1], rw); g.addColorStop(0, "rgba(0,0,0,.45)"); g.addColorStop(1, "rgba(0,0,0,0)");
        x.save(); x.translate(c[0], c[1]); x.scale(1, rh / rw); x.translate(-c[0], -c[1]); x.fillStyle = g; x.fillRect(c[0] - rw, c[1] - rw, rw * 2, rw * 2); x.restore();
      }
      const [n, b] = (u0 + u1) / 2 < .5 ? [fr, br] : [fl, bl];          // the side facing the middle of the room
      shade([up(n, s0, h0), up(n, s0, h1), up(b, s1, h1), up(b, s1, h0)], side, .55);
      if (h1 < 1.5) poly([up(fl, s0, h1), up(fr, s0, h1), up(br, s1, h1), up(bl, s1, h1)], top);
      shade([up(fl, s0, h0), up(fr, s0, h0), up(fr, s0, h1), up(fl, s0, h1)], front);
      return { fl, fr };
    }
    const flat = (u0, u1, s0, s1, fill) => poly([F(u0, s0), F(u1, s0), F(u1, s1), F(u0, s1)], fill);
    const lampAt = (u, s0, h, shadeCol, wM, h0 = 0) => {   // a lamp: thin pole, a glowing shade, light around it
      const base = F(u, s0), k = hs(s0), t0 = up(base, s0, h - .32), t1 = up(base, s0, h), wb = wM * k, wt = wM * .6 * k;
      poly([up(base, s0, h0), up([base[0] + 3, base[1]], s0, h0), up([base[0] + 3, base[1]], s0, h - .3), up(base, s0, h - .3)], "#120e0a");
      glow(t0[0], t0[1], 7 * wb, .55);
      poly([[t1[0] - wt, t1[1]], [t1[0] + wt, t1[1]], [t0[0] + wb, t0[1]], [t0[0] - wb, t0[1]]], shadeCol);
    };
    // everything stays in the corners, beside the game, never behind it
    if (KIND === "g8") {
      flat(.28, .72, .04, .62, "#2a1511"); flat(.31, .69, .08, .58, "#351b15");                    // a rug
      box(0, .15, .28, .4, 0, .4, "#3b211a", "#4a2a20", "#2a1712");                                 // armchair
      box(0, .15, .38, .42, .4, .95, "#33201a", "#40271f", "#24140f");
      box(0, .03, .28, .38, .4, .6, "#2e1a14", "#3d241c", "#22130e");
      box(.12, .15, .28, .38, .4, .6, "#2e1a14", "#3d241c", "#22130e");
      lampAt(.94, .36, 1.8, "#e9c98a", .2);                                                          // floor lamp
    } else if (KIND === "ms") {
      box(0, .11, .3, .42, 0, 1.25, "#45474a", "#55585b", "#323437");                               // filing cabinet
      const c0 = F(0, .3), c1 = F(.11, .3);
      for (let i = 1; i < 4; i++) { const y = c0[1] - i * .31 * hs(.3); poly([[c0[0], y], [c1[0], y], [c1[0], y + 2], [c0[0], y + 2]], "#25272a"); }
      box(.005, .1, .32, .4, 1.25, 1.62, "#b7b09c", "#cfc8b4", "#9e9886");                         // an old monitor on top
      const sa = F(.015, .32), sb = F(.09, .32), scr = [up(sa, .32, 1.3), up(sb, .32, 1.3), up(sb, .32, 1.57), up(sa, .32, 1.57)];
      glow((scr[0][0] + scr[1][0]) / 2, (scr[0][1] + scr[2][1]) / 2, 4 * (scr[1][0] - scr[0][0]), .4);
      poly(scr, "#a9c6ef");
      x.fillStyle = "rgba(0,0,40,.25)"; for (let y = scr[2][1]; y < scr[0][1]; y += 3) x.fillRect(scr[0][0], y, scr[1][0] - scr[0][0], 1);
      box(.9, 1, .24, .44, 0, 1.95, "#4a4d50", "#5a5d60", "#3a3c3f");                              // a metal locker
    } else {
      box(.9, 1, .18, .55, 0, 2.05, "#2e2418", "#3a2e20", "#3a2c1c");                               // bookshelf, its long side to you
      const s0 = .18, s1 = .55, a0 = F(.9, s0), a1 = F(.9, s1);
      const cols = ["#6b2b22", "#2f4a5a", "#7a6a3a", "#3e5a34", "#5a3a5a", "#8a7a5a", "#2a2a2a"];
      const at = (tt) => [a0[0] + (a1[0] - a0[0]) * ((tt - s0) / (s1 - s0)), a0[1] + (a1[1] - a0[1]) * ((tt - s0) / (s1 - s0))];
      for (let sh = 0; sh < 5; sh++) {
        const h0 = .12 + sh * .38;
        for (let i = 0; i < 16; i++) {
          const ta = s0 + (s1 - s0) * ((i + .1) / 16), tb = s0 + (s1 - s0) * ((i + .85) / 16), hh = h0 + .3 - (((i * 7 + sh * 3) % 5) * .035);
          if ((i * 5 + sh) % 9 === 0) continue;                                                   // a gap
          shade([up(at(ta), ta, h0), up(at(tb), tb, h0), up(at(tb), tb, hh), up(at(ta), ta, hh)], cols[(i * 3 + sh) % cols.length], .3);
        }
      }
      box(0, .12, .3, .4, 0, .68, "#3a2d20", "#4b3a2a", "#2c2218");                                 // little table
      lampAt(.06, .35, 1.08, "#6f8a4a", .1, .68);                                                         // its lamp
      for (const [u, s1, r] of [[.33, .08, .2], [.4, .14, -.3], [.48, .06, .5], [.6, .12, -.1]]) {  // papers on the floor
        const p = F(u, s1), w = .21 * hs(s1) * 1.4, h = .14 * hs(s1);
        x.save(); x.translate(p[0], p[1]); x.rotate(r); x.fillStyle = "#cfc6ae"; x.fillRect(-w / 2, -h / 2, w, h);
        x.fillStyle = "rgba(40,30,20,.35)"; for (let i = 0; i < 4; i++) x.fillRect(-w * .38, -h * .3 + i * h * .17, w * .7, 1); x.restore();
      }
    }
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

  // ---- sound: the room's buzz and tone, from the first click or key press ----
  const wake = () => { SFX.start(); SFX.tone("room"); SFX.hum(.45); };
  addEventListener("pointerdown", wake, { once: true }); addEventListener("keydown", wake, { once: true });
  // ---- events: knocks on the door behind you, someone walking past, a door far off, the light cutting out ----
  if (!calm) (function ev() {
    setTimeout(() => {
      if (!document.hidden && SFX.on) {
        const r = Math.random();
        if (r < .3) SFX.knock(rnd(-.15, .15), .15, Math.random() < .3 ? 2 : 3);
        else if (r < .6) SFX.steps(7, rnd(-.6, .6), .75, .58);
        else if (r < .85) SFX.slam(rnd(-.5, .5), .9);
        else {                                              // the light goes out for a moment
          SFX.zap(); SFX.hum(0); flick = 0; dark.classList.add("out"); draw();
          setTimeout(() => { flick = 1; dark.classList.remove("out"); SFX.hum(.45); draw(); }, 1200);
        }
      }
      ev();
    }, rnd(22000, 50000));
  })();

  // the light dips: once, or twice in a row, every 8-25 seconds
  if (!calm) (function dip() {
    setTimeout(() => {
      if (!document.hidden) {
        const n = Math.random() < .35 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          setTimeout(() => { dark.classList.add("on"); flick = .2; SFX.hum(.1); draw(); }, i * 450);
          setTimeout(() => { dark.classList.remove("on"); flick = 1; SFX.hum(.45); draw(); }, i * 450 + 90 + Math.random() * 120);
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
    SFX.latch(); SFX.creak();
    body.classList.add("leaving");
    setTimeout(() => { location.href = back.href; }, 330);
  });
  // coming back to this page from the browser's history: don't stay faded out
  addEventListener("pageshow", (e) => { if (e.persisted) body.classList.remove("leaving"); });
})();
