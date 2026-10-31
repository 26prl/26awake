"use strict";
// The home page: an endless corridor on the 26th floor, at night, seen from inside (first person).
//  * Walk with W / ↑ (S / ↓ back), the mouse wheel, or by holding the mouse button down.
//  * Right wall: doors, 2048 → minesweeper → sudoku, again and again forever. Click a door to go in.
//  * Left wall: one long window onto the city at night. The music video plays on a giant screen on a far tower;
//    it's so far away it never gets closer, but the further you walk the louder the music gets.
//  * Coming back from a game puts you back where you were (sessionStorage), without the "enter" screen.
// Drawn on two canvases with a hand-rolled perspective projection: #out (sky, city, under the video) and #hall
// (the corridor, over the video, with the window cut out). The camera only ever moves straight ahead, so walls,
// floor and ceiling are single quads; fog is one radial gradient around the vanishing point.

(() => {
  const grain = document.querySelector(".hall-grain");
  const out = document.getElementById("out"), hall = document.getElementById("hall"), screenBox = document.getElementById("screen");
  const ox = out.getContext("2d"), hx = hall.getContext("2d");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
               set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } } };

  // ---- the world, in metres; X right, Y down, Z ahead; the eye is at height 0 ----
  const HW = 1.4, CEIL = -1.1, FLOOR = 1.5;          // corridor half-width, ceiling and floor
  const WT = -0.85, WB = 0.7;                         // the window, top and bottom
  const NEAR = 0.12, FAR = 90;
  const DOOR0 = 4, DS = 5, DW = 1.05, DTOP = FLOOR - 2.15;   // first door, spacing, width, top
  const LS = 4;                                       // a ceiling light every LS metres
  const GAMES = [["2048", "2048.html"], ["mine", "minesweeper.html"], ["sudoku", "sudoku.html"]];
  const MAXV = 4.2;                                   // walking speed, m/s

  let W = 0, H = 0, dpr = 1, f = 1, vx = 0, vy = 0, bob = 0;
  let camZ = Math.max(0, Number(ss.get("corridor-z")) || 0), vel = 0;
  let mouse = { x: -1, y: -1, down: false, onDoor: false }, keys = new Set(), wheel = 0;
  let hover = -1, opening = null, doorsOnScreen = [];
  let vid = { x: 0, y: 0, w: 320, h: 180 };
  const bg = document.createElement("canvas"), bx = bg.getContext("2d");   // the still part of the outside

  const P = (X, Y, Z) => { const d = Z - camZ; return [vx + f * X / d, vy + bob + f * Y / d]; };
  const poly = (x, pts) => { x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); };
  const hash = (n) => { let h = (n * 374761393) ^ 0x5bd1e995; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const zn = () => camZ + NEAR, zf = () => camZ + FAR;

  // ---- the game symbols on the door plaques ----
  function icon(x, kind, s) {
    if (kind === "2048") {
      x.fillStyle = "#edc22e"; x.fillRect(-s / 2, -s / 2, s, s);
      x.fillStyle = "#fff"; x.font = `800 ${s * .3}px Arial, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText("2048", 0, s * .02);
    } else if (kind === "mine") {
      x.fillStyle = "#c0c0c0"; x.fillRect(-s / 2, -s / 2, s, s);
      x.fillStyle = "#111"; x.beginPath(); x.arc(0, 0, s * .22, 0, 7); x.fill();
      x.strokeStyle = "#111"; x.lineWidth = s * .07;
      for (let a = 0; a < 4; a++) { const c = Math.cos(a * Math.PI / 4) * s * .36, d = Math.sin(a * Math.PI / 4) * s * .36; x.beginPath(); x.moveTo(c, d); x.lineTo(-c, -d); x.stroke(); }
      x.fillStyle = "#fff"; x.fillRect(-s * .1, -s * .1, s * .07, s * .07);
    } else {
      x.fillStyle = "#f4f1ea"; x.fillRect(-s / 2, -s / 2, s, s);
      x.strokeStyle = "#222"; x.lineWidth = Math.max(1, s * .04);
      for (let i = 1; i < 3; i++) { x.beginPath(); x.moveTo(-s / 2 + i * s / 3, -s / 2); x.lineTo(-s / 2 + i * s / 3, s / 2); x.moveTo(-s / 2, -s / 2 + i * s / 3); x.lineTo(s / 2, -s / 2 + i * s / 3); x.stroke(); }
      x.strokeRect(-s / 2, -s / 2, s, s);
      x.fillStyle = "#222"; x.font = `${s * .22}px Georgia, serif`; x.textAlign = "center"; x.textBaseline = "middle";
      for (const [i, j, n] of [[0, 0, "5"], [2, 0, "3"], [1, 1, "7"], [0, 2, "9"], [2, 2, "1"]]) x.fillText(n, -s / 2 + (i + .5) * s / 3, -s / 2 + (j + .5) * s / 3);
    }
  }
  // draw something (a unit square, centred) onto the right wall: affine map from three projected corners
  function onWall(x, z0, z1, y0, y1, draw) {
    const a = P(HW, y0, z1), b = P(HW, y0, z0), c = P(HW, y1, z1);   // facing the wall, "left to right" runs from far to near
    x.save(); x.transform(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1], a[0], a[1]); x.translate(.5, .5); draw(); x.restore();
  }

  // ---- the city ----
  const cityLights = [];
  for (let i = 0; i < 700; i++) {
    const X = -HW - (15 + Math.random() ** 1.6 * 420);
    const ground = Math.random() < .35;
    const Y = ground ? 82 : 82 - Math.random() * Math.min(70, Math.abs(X) * .35);
    const warm = Math.random() < .75;
    cityLights.push({ X, Y, z: Math.random() * 600, s: .25 + Math.random() * .5,
      c: warm ? `255,${160 + Math.random() * 70 | 0},${70 + Math.random() * 60 | 0}` : "205,220,255", a: .35 + Math.random() * .6 });
  }
  for (const X of [-HW - 70, -HW - 150, -HW - 260]) for (let z = 0; z < 600; z += 22) cityLights.push({ X, Y: 82, z, s: .6, c: "255,170,80", a: .9 });   // street lamps in rows
  const cars = [];
  for (let i = 0; i < 26; i++) cars.push({ X: [-HW - 72, -HW - 152][i % 2], z: Math.random() * 600, v: (i % 4 < 2 ? 1 : -1) * (8 + Math.random() * 8), red: Math.random() < .5 });

  // where the video goes: inside the window, as big as fits (at least 200 px wide)
  function placeVideo() {
    const slopeT = -WT / HW, slopeB = WB / HW, margin = 22, below = 18;
    let best = null;
    for (let vw = 264; vw >= 200; vw -= 4) {
      const vh = vw * 9 / 16, xr = vx - Math.max((vh + below) / slopeT, below / slopeB) - margin;
      if (xr - vw >= margin) { best = { w: vw, h: vh, x: xr - vw, y: vy - (vh - below) - 6 }; break; }
    }
    vid = best || { w: 200, h: 112.5, x: margin, y: vy - 100 };
    Object.assign(screenBox.style, { left: `${vid.x}px`, top: `${vid.y}px`, width: `${vid.w}px`, height: `${vid.h}px` });
    // the grain over the page leaves the video alone
    const v = vid, pad = 6;
    if (grain) grain.style.clipPath = `path(evenodd, "M0 0H${W}V${H}H0Z M${v.x - pad} ${v.y - pad}h${v.w + 2 * pad}v${v.h + 2 * pad}h${-v.w - 2 * pad}Z")`;
  }

  function paintSky() {
    bg.width = W * dpr; bg.height = H * dpr; bx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let g = bx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#03040a"); g.addColorStop(.42, "#0b1020"); g.addColorStop(.55, "#1d1820"); g.addColorStop(.75, "#0b0a0e"); g.addColorStop(1, "#040405");
    bx.fillStyle = g; bx.fillRect(0, 0, W, H);
    // city glow on the low clouds
    g = bx.createRadialGradient(vx * .4, vy + 40, 0, vx * .4, vy + 40, W * .6);
    g.addColorStop(0, "rgba(255,130,60,.16)"); g.addColorStop(1, "rgba(255,130,60,0)"); bx.fillStyle = g; bx.fillRect(0, 0, W, H);
    for (let i = 0; i < 120; i++) { bx.fillStyle = `rgba(220,225,255,${Math.random() * .35})`; bx.fillRect(Math.random() * vx, Math.random() * vy * .8, 1, 1); }
    // the moon, left of the tower
    const mx = Math.max(60, vid.x - 90), my = vy - (vx - mx) * (-WT / HW) + 70;
    g = bx.createRadialGradient(mx, my, 0, mx, my, 120); g.addColorStop(0, "rgba(220,225,245,.35)"); g.addColorStop(1, "rgba(220,225,245,0)");
    bx.fillStyle = g; bx.fillRect(mx - 120, my - 120, 240, 240);
    bx.fillStyle = "#d8dae6"; bx.beginPath(); bx.arc(mx, my, 13, 0, 7); bx.fill();
    // the far skyline, over dark ground
    bx.fillStyle = "#060608"; bx.fillRect(0, vy + 22, W, H);
    for (let x = 0; x < vx; x += 6 + Math.random() * 22) {
      const bh = 8 + Math.random() ** 2 * 70, top = vy + 22 - bh;
      bx.fillStyle = "#07070a"; bx.fillRect(x, top, 8 + Math.random() * 26, H);
      for (let k = 0; k < bh / 6; k++) if (Math.random() < .3) { bx.fillStyle = `rgba(255,${170 + Math.random() * 60 | 0},90,${.3 + Math.random() * .5})`; bx.fillRect(x + 2 + Math.random() * 10, top + 3 + k * 6, 1.5, 1.5); }
    }
    // the tower with the screen on top
    bx.fillStyle = "#050507"; bx.fillRect(vid.x + vid.w * .18, vid.y + vid.h, vid.w * .64, H);
    bx.fillRect(vid.x - 6, vid.y - 6, vid.w + 12, vid.h + 12);
    g = bx.createRadialGradient(vid.x + vid.w / 2, vid.y + vid.h / 2, vid.w * .3, vid.x + vid.w / 2, vid.y + vid.h / 2, vid.w * 1.1);
    g.addColorStop(0, "rgba(255,180,120,.14)"); g.addColorStop(1, "rgba(255,180,120,0)");
    bx.fillStyle = g; bx.fillRect(0, 0, W, H);
    bx.fillStyle = "#050507"; bx.fillRect(vid.x - 6, vid.y - 6, vid.w + 12, vid.h + 12);
  }

  function drawOutside(t) {
    ox.setTransform(1, 0, 0, 1, 0, 0); ox.clearRect(0, 0, out.width, out.height);
    ox.drawImage(bg, 0, bob * dpr);
    ox.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lit = (L, z) => {
      const d = ((z - camZ) % 600 + 600) % 600;
      if (d < 2) return;
      const x = vx + f * L.X / d, y = vy + bob + f * L.Y / d;
      if (x < -4 || x > vx || y > H) return;
      const r = Math.max(.6, Math.min(4, f * L.s / d));
      ox.fillStyle = `rgba(${L.c},${L.a * Math.min(1, 40 / d + .25)})`; ox.fillRect(x - r / 2, y - r / 2, r, r);
    };
    for (const L of cityLights) lit(L, L.z);
    for (const c of cars) lit({ X: c.X, Y: 82, s: .5, c: c.red ? "255,40,30" : "255,245,220", a: 1 }, c.z + c.v * t / 1000);
    // the aviation lights on the tower, slow
    if (Math.floor(t / 1400) % 2) { ox.fillStyle = "rgba(255,30,30,.9)"; ox.fillRect(vid.x - 4, vid.y - 12 + bob, 3, 3); ox.fillRect(vid.x + vid.w + 1, vid.y - 12 + bob, 3, 3); }
  }

  // ---- the corridor ----
  function light(k, t) {          // how bright ceiling light k is right now (0..1); a few are broken
    const r = hash(k + 7);
    if (r < .08) return 0;                                            // dead
    if (r < .2) { const s = Math.floor(t / 340 + k * 13); return hash(s) < .3 ? .15 : 1; }   // flickering, slowly (≤ 3 a second)
    return 1;
  }

  function drawHall(t) {
    const x = hx;
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    const a = zn(), b = zf();
    // surfaces
    poly(x, [P(-HW, CEIL, a), P(HW, CEIL, a), P(HW, CEIL, b), P(-HW, CEIL, b)]); x.fillStyle = "#6c6a5b"; x.fill();
    poly(x, [P(-HW, FLOOR, a), P(HW, FLOOR, a), P(HW, FLOOR, b), P(-HW, FLOOR, b)]); x.fillStyle = "#352d1c"; x.fill();
    poly(x, [P(HW, CEIL, a), P(HW, FLOOR, a), P(HW, FLOOR, b), P(HW, CEIL, b)]); x.fillStyle = "#6b6038"; x.fill();
    poly(x, [P(-HW, CEIL, a), P(-HW, FLOOR, a), P(-HW, FLOOR, b), P(-HW, CEIL, b)]); x.fillStyle = "#615733"; x.fill();
    // lines that slide past: ceiling tiles, carpet seams, wall panels
    x.lineWidth = 1;
    const step = (s, fn) => { for (let z = Math.ceil(a / s) * s; z < Math.min(b, camZ + 40); z += s) fn(z); };
    x.strokeStyle = "rgba(0,0,0,.22)";
    step(1.2, (z) => { x.beginPath(); x.moveTo(...P(-HW, CEIL, z)); x.lineTo(...P(HW, CEIL, z)); x.stroke(); });
    x.strokeStyle = "rgba(0,0,0,.18)";
    step(2.4, (z) => { x.beginPath(); x.moveTo(...P(-HW, FLOOR, z)); x.lineTo(...P(HW, FLOOR, z)); x.stroke(); });
    step(1.25, (z) => { x.beginPath(); x.moveTo(...P(HW, CEIL, z)); x.lineTo(...P(HW, FLOOR, z)); x.stroke(); });
    x.strokeStyle = "rgba(0,0,0,.35)";
    for (const [X, Y] of [[HW, FLOOR - .12], [-HW, FLOOR - .12], [HW, CEIL + .05], [-HW, CEIL + .05]]) { x.beginPath(); x.moveTo(...P(X, Y, a)); x.lineTo(...P(X, Y, b)); x.stroke(); }
    // the logo, painted on the wall at the start
    if (logo.complete && logo.naturalWidth && camZ < 3) onWall(x, 1.1, 3.1, -.55, .1, () => { x.globalAlpha = .55; x.globalCompositeOperation = "multiply"; x.drawImage(logo, -.5, -.5, 1, 1); });
    // doors
    doorsOnScreen = [];
    const first = Math.max(0, Math.floor((a - DOOR0 - DW) / DS) + 1);
    for (let k = Math.min(first + 14, Math.floor((camZ + 60 - DOOR0) / DS)); k >= first; k--) {
      const z0 = DOOR0 + k * DS, z1 = z0 + DW, game = GAMES[k % 3];
      if (z1 <= a) continue;
      const c0 = Math.max(z0, a + .01);
      poly(x, [P(HW, DTOP - .08, c0), P(HW, FLOOR, c0), P(HW, FLOOR, z1 + .08), P(HW, DTOP - .08, z1 + .08)]); x.fillStyle = "#2b2116"; x.fill();   // frame
      const open = opening && opening.k === k ? Math.min(1, (t - opening.t) / 420) : 0;
      const zh = z0 + (z1 - z0) * open;                                                        // the panel swings in
      poly(x, [P(HW, DTOP, c0), P(HW, FLOOR, c0), P(HW, FLOOR, z1), P(HW, DTOP, z1)]); x.fillStyle = "#000"; x.fill();
      if (zh < z1) { poly(x, [P(HW, DTOP, Math.max(zh, c0)), P(HW, FLOOR, Math.max(zh, c0)), P(HW, FLOOR, z1), P(HW, DTOP, z1)]); x.fillStyle = hover === k ? "#6b5434" : "#5a4529"; x.fill(); }
      // light under the door, and the gap at its edge
      poly(x, [P(HW, FLOOR - .02, c0), P(HW, FLOOR, c0), P(HW, FLOOR, z1), P(HW, FLOOR - .02, z1)]); x.fillStyle = "rgba(255,200,120,.55)"; x.fill();
      if (!open && z0 > a) {
        onWall(x, z0 + .3, z0 + .75, -.42, .03, () => { x.scale(1 / 110, 1 / 110); icon(x, game[0], 100); });   // plaque
        poly(x, [P(HW, .1, z1 - .12), P(HW, .16, z1 - .12), P(HW, .16, z1 - .04), P(HW, .1, z1 - .04)]); x.fillStyle = "#c9b27a"; x.fill();   // handle
      }
      if (z0 - camZ < 26) doorsOnScreen.push({ k, pts: [P(HW, DTOP, c0), P(HW, FLOOR, c0), P(HW, FLOOR, z1), P(HW, DTOP, z1)] });
    }
    // ceiling lights and the light they throw
    for (let k = Math.max(0, Math.floor((a - .6) / LS)); k * LS + 2 < Math.min(b, camZ + 70); k++) {
      const z = k * LS + 2, on = light(k, t), d = z - camZ;
      if (z + .6 <= a) continue;
      poly(x, [P(-.32, CEIL, Math.max(z - .6, a)), P(.32, CEIL, Math.max(z - .6, a)), P(.32, CEIL, z + .6), P(-.32, CEIL, z + .6)]);
      x.fillStyle = on ? "#fffbe2" : "#3a382e"; x.fill();
      if (on && d > .4) {
        const [cx, cy] = P(0, FLOOR, z), r = f * 1.6 / d, ry = Math.max(2, (P(0, FLOOR, Math.max(z - 1.6, a + .05))[1] - P(0, FLOOR, z + 1.6)[1]) / 2);
        x.save(); x.translate(cx, cy); x.scale(1, ry / r);
        let g = x.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, `rgba(255,240,190,${.22 * on})`); g.addColorStop(1, "rgba(255,240,190,0)");
        x.fillStyle = g; x.beginPath(); x.arc(0, 0, r, 0, 7); x.fill(); x.restore();
        const [lx, ly] = P(0, CEIL, z), R = f * 2.2 / d;
        g = x.createRadialGradient(lx, ly, 0, lx, ly, R); g.addColorStop(0, `rgba(255,245,200,${.16 * on})`); g.addColorStop(1, "rgba(255,245,200,0)");
        x.fillStyle = g; x.fillRect(lx - R, ly - R, R * 2, R * 2);
        for (const X of [-HW, HW]) {          // and on the walls
          const [wx, wy] = P(X, 0, z), Rw = f * 2 / d;
          g = x.createRadialGradient(wx, wy, 0, wx, wy, Rw); g.addColorStop(0, `rgba(255,240,190,${.1 * on})`); g.addColorStop(1, "rgba(255,240,190,0)");
          x.fillStyle = g; x.fillRect(wx - Rw, wy - Rw, Rw * 2, Rw * 2);
        }
      }
    }
    // fog: darker the further away, one radial gradient around the vanishing point (only over what's drawn)
    const Rmax = Math.hypot(W, H);
    const g = x.createRadialGradient(vx, vy + bob, 0, vx, vy + bob, Rmax);
    for (const d of [80, 40, 24, 16, 11, 8, 6, 4.5, 3.2, 2.2, 1.4, .8]) {
      const r = Math.min(1, f * HW / d / Rmax);
      g.addColorStop(r, `rgba(2,2,3,${Math.min(.985, 1 - Math.exp(-d / 9))})`);
    }
    g.addColorStop(1, "rgba(2,2,3,0)");
    x.globalCompositeOperation = "source-atop"; x.fillStyle = g; x.fillRect(0, 0, W, H);
    const vg = x.createRadialGradient(vx, vy, Math.min(W, H) * .35, vx, vy, Math.hypot(W, H) * .6);   // vignette
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,.6)"); x.fillStyle = vg; x.fillRect(0, 0, W, H);
    // the window: cut out, then a faint tint on the glass (not over the video), and the frame
    x.globalCompositeOperation = "destination-out";
    poly(x, [P(-HW, WT, a), P(-HW, WT, b), P(-HW, WB, b), P(-HW, WB, a)]); x.fillStyle = "#000"; x.fill();
    x.globalCompositeOperation = "source-over";
    x.save();
    poly(x, [P(-HW, WT, a), P(-HW, WT, b), P(-HW, WB, b), P(-HW, WB, a)]);
    x.rect(vid.x, vid.y + bob, vid.w, vid.h);              // a hole where the video is
    x.fillStyle = "rgba(120,130,150,.05)"; x.fill("evenodd");
    x.restore();
    x.fillStyle = "#1a1712";
    for (const [y0, y1] of [[WT - .06, WT], [WB, WB + .09]]) { poly(x, [P(-HW, y0, a), P(-HW, y0, b), P(-HW, y1, b), P(-HW, y1, a)]); x.fill(); }
  }

  // ---- size ----
  const logo = new Image(); logo.src = "icons/logo-26awake-net.png";
  function resize() {
    W = innerWidth; H = innerHeight; dpr = Math.min(devicePixelRatio || 1, 1.5);
    for (const c of [out, hall]) { c.width = W * dpr; c.height = H * dpr; }
    f = H * .8; vx = W / 2; vy = H * .47;
    placeVideo(); paintSky();
  }
  addEventListener("resize", resize); resize();

  // ---- input ----
  const inDoor = (px, py) => {
    for (let i = doorsOnScreen.length - 1; i >= 0; i--) {         // nearest last-drawn first
      const p = doorsOnScreen[i].pts; let inside = false;
      for (let a = 0, b = p.length - 1; a < p.length; b = a++)
        if ((p[a][1] > py) !== (p[b][1] > py) && px < (p[b][0] - p[a][0]) * (py - p[a][1]) / (p[b][1] - p[a][1]) + p[a][0]) inside = !inside;
      if (inside) return doorsOnScreen[i].k;
    }
    return -1;
  };
  hall.addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  hall.addEventListener("pointerdown", (e) => {
    if (e.button) return;
    const k = inDoor(e.clientX, e.clientY);
    if (k >= 0) enterDoor(k); else mouse.down = true;
  });
  addEventListener("pointerup", () => { mouse.down = false; });
  addEventListener("blur", () => { mouse.down = false; keys.clear(); });
  addEventListener("wheel", (e) => { wheel += Math.max(-120, Math.min(120, e.deltaY)) * (e.deltaMode ? 30 : 1); }, { passive: true });
  addEventListener("keydown", (e) => {
    const k = { ArrowUp: "f", KeyW: "f", ArrowDown: "b", KeyS: "b" }[e.code];
    if (k) { keys.add(k); e.preventDefault(); }
    if ((e.code === "Enter" || e.code === "Space") && hover >= 0) enterDoor(hover);
  });
  addEventListener("keyup", (e) => { keys.delete({ ArrowUp: "f", KeyW: "f", ArrowDown: "b", KeyS: "b" }[e.code]); });

  function enterDoor(k) {
    if (opening) return;
    opening = { k, t: performance.now() };
    ss.set("corridor-z", String(Math.max(0, DOOR0 + k * DS - 3.2)));     // come back standing by this door
    saveMusic();
    // the door swings open, then you walk through it into the dark
    const d = doorsOnScreen.find((o) => o.k === k), pts = d ? d.pts : [[vx, vy]];
    const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    setTimeout(() => {
      if (!calm) for (const el of [out, hall, screenBox]) {
        const r = el.getBoundingClientRect();
        Object.assign(el.style, { transformOrigin: `${cx - r.left}px ${cy - r.top}px`, transition: "transform .6s ease-in", transform: "scale(2.6)" });
      }
      fade.classList.add("on");
    }, 280);
    setTimeout(() => { location.href = GAMES[k % 3][1]; }, 880);
  }

  // ---- the loop ----
  const hint = document.getElementById("hint");
  let last = performance.now(), walked = 0;
  function frame(t) {
    const dt = Math.min(.05, (t - last) / 1000); last = t;
    let push = 0;
    if (keys.has("f") || mouse.down) push += 1;
    if (keys.has("b")) push -= 1;
    if (!opening) {
      vel += push * 9 * dt + wheel * .004; wheel = 0;
      vel *= Math.pow(push ? .35 : .08, dt);
      vel = Math.max(-MAXV, Math.min(MAXV, vel));
      camZ = Math.max(0, camZ + vel * dt);
      if (camZ === 0 && vel < 0) vel = 0;
      walked += Math.abs(vel * dt);
    } else vel = 0;
    bob = calm ? 0 : Math.sin(camZ * 3.1) * Math.min(1, Math.abs(vel) / 2) * 2.5;
    if (!opening) screenBox.style.transform = `translateY(${bob}px)`;
    drawOutside(t); drawHall(t);
    if (!opening) {
      hover = mouse.x < 0 ? -1 : inDoor(mouse.x, mouse.y);
      hall.style.cursor = hover >= 0 ? "pointer" : "default";
    }
    if (hint && walked > 2) hint.classList.add("gone");
    volume();
    requestAnimationFrame(frame);
  }

  // ---- the music: the giant screen; quiet at the start, louder the further in ----
  const Q = window.MV, PLAYING = 1, ENDED = 0;
  let player = null, fails = 0, soundOn = false, lastVol = -1;
  const volFor = (z) => Math.round(6 + 94 * (1 - Math.exp(-z / 110)));
  function volume() {
    if (!player || !player.setVolume) return;
    const v = volFor(camZ);
    if (Math.abs(v - lastVol) >= 1) { player.setVolume(v); lastVol = v; }
  }
  const saveMusic = () => { if (Q && player && player.getCurrentTime) Q.save(player.getCurrentTime()); };
  function sound() {           // after a click or key press: the browser allows sound now
    soundOn = true; if (Q) { Q.sound = true; saveMusic(); }
    if (player && player.unMute) { player.unMute(); player.playVideo(); }
  }
  function startMusic() {
    const clip = Q.first();
    const q = new URLSearchParams({ autoplay: 1, mute: 1, playsinline: 1, fs: 0, rel: 0, modestbranding: 1, iv_load_policy: 3, controls: 0, disablekb: 1, enablejsapi: 1, origin: location.origin });
    if (clip.startSeconds) q.set("start", Math.floor(clip.startSeconds));
    if (clip.endSeconds) q.set("end", Math.ceil(clip.endSeconds));
    const fr = Object.assign(document.createElement("iframe"), {
      src: `https://www.youtube-nocookie.com/embed/${clip.videoId}?${q}`, title: "music video",
      allow: "autoplay; encrypted-media; picture-in-picture", referrerPolicy: "strict-origin-when-cross-origin", tabIndex: -1,
    });
    screenBox.append(fr);
    window.onYouTubeIframeAPIReady = () => {
      player = new YT.Player(fr, {
        events: {
          onReady: (e) => { lastVol = -1; volume(); if (soundOn) { e.target.unMute(); } else e.target.mute(); e.target.playVideo(); },
          onStateChange: (e) => {
            if (e.data === PLAYING) { fails = 0; if (soundOn && player.isMuted()) player.unMute(); }
            if (e.data === ENDED) { const c = Q.next(); Q.save(0); player.loadVideoById(c); }   // one clip: it just starts again
          },
          onError: () => { if (++fails < Q.clips.length) { player.loadVideoById(Q.next()); } },
        },
      });
    };
    const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.append(s);
  }
  setInterval(saveMusic, 2000);
  addEventListener("pagehide", () => { saveMusic(); ss.set("corridor-z", String(camZ)); });
  if (Q) Q.load().then((ok) => { if (ok) startMusic(); }).catch(() => {});

  // ---- the way in ----
  const gate = document.getElementById("gate");
  const fade = Object.assign(document.createElement("div"), { className: "hall-fade" });
  document.body.append(fade);
  if (ss.get("corridor-in")) {
    gate.remove();
    fade.classList.add("on", "now");                                      // back from a room: out of the dark
    requestAnimationFrame(() => requestAnimationFrame(() => fade.classList.remove("on", "now")));
    addEventListener("pointerdown", sound, { once: true });
    addEventListener("keydown", sound, { once: true });
  } else {
    const go = () => { ss.set("corridor-in", "1"); gate.classList.add("gone"); setTimeout(() => gate.remove(), 1200); sound(); };
    gate.addEventListener("click", go);
    addEventListener("keydown", function k(e) { if (document.body.contains(gate) && (e.code === "Enter" || e.code === "Space")) { removeEventListener("keydown", k); go(); } });
  }

  requestAnimationFrame(frame);
})();
