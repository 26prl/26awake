"use strict";
// Two small canvas games for the home page. Best scores are kept in localStorage (per device).

(() => {
  const best = {
    get: (k) => { try { return Number(localStorage.getItem(`best-${k}`)) || 0; } catch { return 0; } },
    set: (k, v) => { try { localStorage.setItem(`best-${k}`, String(v)); } catch { /* private mode */ } },
  };
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);

  // Canvas pixels → board coordinates, whatever size CSS draws it at.
  function boardPoint(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  }

  // Only animate a board while it's on screen.
  function onScreen(canvas) {
    const state = { visible: true };
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => { state.visible = e.isIntersecting; }).observe(canvas);
    }
    return state;
  }

  function glowDot(ctx, x, y, r, rgb, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgb(${rgb} / ${alpha})`);
    g.addColorStop(0.25, `rgb(${rgb} / ${alpha * 0.55})`);
    g.addColorStop(1, `rgb(${rgb} / 0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  function endMessage(msg, lead, score, unit, isBest) {
    msg.replaceChildren(lead, document.createElement("br"),
      Object.assign(document.createElement("strong"), { textContent: String(score) }), ` ${unit}`,
      isBest ? Object.assign(document.createElement("em"), { textContent: "  · a new best" }) : "");
  }

  // ====================================================================================
  // Fireflies — tap the warm lights before they fade, leave the dark ones be. 30 s.
  // ====================================================================================
  (() => {
    const canvas = document.getElementById("ff-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const view = onScreen(canvas);
    const overlay = document.getElementById("ff-overlay");
    const msg = document.getElementById("ff-msg");
    const scoreEl = document.getElementById("ff-score");
    const bestEl = document.getElementById("ff-best");
    const timeEl = document.getElementById("ff-time");
    const ROUND = 30_000, HIT = 70;
    const motes = Array.from({ length: 40 }, () => ({ x: rand(0, W), y: rand(0, H), r: rand(1, 2.6), v: rand(4, 14), p: rand(0, TAU) }));
    const grass = Array.from({ length: 70 }, (_, i) => ({ x: (i / 70) * W + rand(-6, 6), h: rand(30, 110), lean: rand(-18, 18) }));
    let flies, sparks, score, started, nextSpawn, running = false, raf;
    bestEl.textContent = best.get("ff");

    const reset = () => {
      flies = []; sparks = []; score = 0; scoreEl.textContent = 0;
      started = performance.now(); nextSpawn = started + 300;
    };

    const flyPos = (f, now) => [f.x + Math.sin(now / 500 + f.phase) * 10, f.y + Math.cos(now / 650 + f.phase) * 8];

    function spawn(now) {
      const progress = (now - started) / ROUND; // shorter lives and more of them as the round goes on
      const dark = Math.random() < 0.18;
      flies.push({
        dark, x: rand(80, W - 80), y: rand(70, H - 150), born: now, life: (dark ? 2600 : 1700) - 700 * progress,
        vx: rand(-14, 14), vy: rand(-12, 6), phase: rand(0, TAU),
      });
      nextSpawn = now + 620 - 360 * progress + rand(0, 220);
    }

    function background(now) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#120f1c"); g.addColorStop(0.6, "#1f1a2e"); g.addColorStop(1, "#2c2238");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      glowDot(ctx, W * 0.5, H * 1.05, W * 0.75, "232 169 196", 0.22);
      for (const m of motes) {
        const y = (m.y - (now / 1000) * m.v) % H;
        ctx.fillStyle = `rgb(236 230 242 / ${0.08 + 0.08 * Math.sin(now / 900 + m.p)})`;
        ctx.beginPath(); ctx.arc(m.x + Math.sin(now / 2000 + m.p) * 8, y < 0 ? y + H : y, m.r, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = "rgb(10 8 16 / .9)"; ctx.lineWidth = 3; ctx.lineCap = "round";
      for (const b of grass) {
        const sway = Math.sin(now / 1400 + b.x / 60) * 6;
        ctx.beginPath(); ctx.moveTo(b.x, H + 4); ctx.quadraticCurveTo(b.x + b.lean * 0.3, H - b.h * 0.6, b.x + b.lean + sway, H - b.h); ctx.stroke();
      }
    }

    function draw(now) {
      background(now);
      for (const f of flies) {
        const age = (now - f.born) / f.life;
        const a = Math.min(1, age * 6) * (1 - Math.max(0, (age - 0.7) / 0.3)); // fade in, hold, fade out
        const [x, y] = flyPos(f, now);
        const flicker = 0.75 + 0.25 * Math.sin(now / 90 + f.phase);
        if (f.dark) {
          glowDot(ctx, x, y, 64, "120 90 160", 0.35 * a);
          ctx.fillStyle = `rgb(8 6 14 / ${0.9 * a})`; ctx.beginPath(); ctx.arc(x, y, 15, 0, TAU); ctx.fill();
          ctx.strokeStyle = `rgb(168 140 210 / ${0.5 * a})`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 21 + 3 * flicker, 0, TAU); ctx.stroke();
        } else {
          glowDot(ctx, x, y, 90, "255 214 140", 0.45 * a * flicker);
          glowDot(ctx, x, y, 26, "255 246 220", 0.95 * a);
        }
      }
      for (const s of sparks) {
        const t = (now - s.t) / 900;
        if (s.text) {
          ctx.fillStyle = `rgb(${s.rgb} / ${1 - t})`; ctx.font = "italic 300 34px 'Cormorant Garamond', Georgia, serif";
          ctx.textAlign = "center"; ctx.fillText(s.text, s.x, s.y - t * 50);
        } else glowDot(ctx, s.x + s.vx * t * 60, s.y + s.vy * t * 60, 10, s.rgb, 1 - t);
      }
    }

    function loop(now) {
      const left = ROUND - (now - started);
      timeEl.textContent = Math.max(0, Math.ceil(left / 1000));
      if (left <= 0) return end();
      if (now >= nextSpawn) spawn(now);
      flies = flies.filter((f) => now - f.born < f.life);
      for (const f of flies) { f.x += f.vx / 60; f.y += f.vy / 60; }
      sparks = sparks.filter((s) => now - s.t < 900);
      draw(now);
      raf = requestAnimationFrame(loop);
    }

    // Between rounds the meadow keeps breathing quietly.
    function idle(now) {
      if (running) return;
      if (view.visible) draw(now);
      raf = requestAnimationFrame(idle);
    }

    function end() {
      running = false; cancelAnimationFrame(raf);
      const b = best.get("ff");
      if (score > b) { best.set("ff", score); bestEl.textContent = score; }
      endMessage(msg, "The lights went out.", score, score === 1 ? "firefly caught" : "fireflies caught", score > b);
      overlay.hidden = false;
      document.getElementById("ff-start").textContent = "again";
      raf = requestAnimationFrame(idle);
    }

    canvas.addEventListener("pointerdown", (e) => {
      if (!running) return;
      const now = performance.now(), p = boardPoint(canvas, e);
      let hit = null, nearest = HIT;
      for (const f of flies) {
        const [x, y] = flyPos(f, now), d = Math.hypot(x - p.x, y - p.y);
        if (d < nearest) { nearest = d; hit = f; }
      }
      if (!hit) return;
      flies = flies.filter((f) => f !== hit);
      score = Math.max(0, score + (hit.dark ? -3 : 1));
      scoreEl.textContent = score;
      const rgb = hit.dark ? "168 140 210" : "255 230 170";
      for (let i = 0; i < 9; i++) { const a = rand(0, TAU); sparks.push({ x: p.x, y: p.y, vx: Math.cos(a), vy: Math.sin(a), t: now, rgb }); }
      sparks.push({ x: p.x, y: p.y - 30, t: now, rgb, text: hit.dark ? "−3" : "+1" });
    });

    document.getElementById("ff-start").onclick = () => {
      cancelAnimationFrame(raf); overlay.hidden = true; reset(); running = true; raf = requestAnimationFrame(loop);
    };
    reset();
    raf = requestAnimationFrame(idle);
  })();

  // ====================================================================================
  // Afterglow — snake, in an empty pool at night. Gather the lights, don't cross your trail.
  // ====================================================================================
  (() => {
    const canvas = document.getElementById("ps-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const view = onScreen(canvas);
    const overlay = document.getElementById("ps-overlay");
    const msg = document.getElementById("ps-msg");
    const scoreEl = document.getElementById("ps-score");
    const bestEl = document.getElementById("ps-best");
    const G = 18, C = W / G;
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    let snake, prev, dir, queue, light, score, running = false, timer, speed, lastStep, crashed = false;
    bestEl.textContent = best.get("ps");

    const placeLight = () => {
      do light = [Math.floor(Math.random() * G), Math.floor(Math.random() * G)];
      while (snake.some(([x, y]) => x === light[0] && y === light[1]));
    };
    const reset = () => {
      snake = [[8, 9], [7, 9], [6, 9], [5, 9]]; prev = snake.map((p) => p.slice());
      dir = "right"; queue = []; score = 0; speed = 140; crashed = false;
      scoreEl.textContent = 0; placeLight(); lastStep = performance.now();
    };

    function turn(d) {
      const last = queue.length ? queue[queue.length - 1] : dir;
      const [lx, ly] = DIRS[last], [nx, ny] = DIRS[d];
      if (lx + nx === 0 && ly + ny === 0) return; // no reversing into yourself
      if (d !== last && queue.length < 3) queue.push(d);
    }

    function pool(now) {
      const g = ctx.createLinearGradient(0, 0, W, W);
      g.addColorStop(0, "#0f2a33"); g.addColorStop(1, "#1a1f38");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, W);
      // tiles, with slow light ripples running across them
      for (let x = 0; x < G; x++) for (let y = 0; y < G; y++) {
        const ripple = 0.5 + 0.5 * Math.sin(now / 1300 + x * 0.55 + Math.sin(now / 2100 + y * 0.4) * 2);
        ctx.fillStyle = `rgb(168 220 208 / ${0.025 + 0.045 * ripple})`;
        ctx.fillRect(x * C + 1, y * C + 1, C - 2, C - 2);
      }
      ctx.strokeStyle = "rgb(168 220 208 / .07)"; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= G; i++) { ctx.moveTo(i * C + 0.5, 0); ctx.lineTo(i * C + 0.5, W); ctx.moveTo(0, i * C + 0.5); ctx.lineTo(W, i * C + 0.5); }
      ctx.stroke();
      glowDot(ctx, W * 0.2, -W * 0.1, W * 0.7, "159 184 232", 0.12); // light from somewhere above
    }

    function draw(now) {
      pool(now);
      // the light to collect
      const [lx, ly] = light, cx = lx * C + C / 2, cy = ly * C + C / 2, beat = 0.8 + 0.2 * Math.sin(now / 260);
      glowDot(ctx, cx, cy, C * 2.2 * beat, "255 214 140", 0.35);
      glowDot(ctx, cx, cy, C * 0.5, "255 248 228", 1);

      // the snake: a ribbon of light, eased between grid steps
      const t = running ? Math.min(1, (now - lastStep) / speed) : 1;
      const pts = snake.map(([x, y], i) => {
        const [px, py] = prev[i] || [x, y];
        return [(px + (x - px) * t) * C + C / 2, (py + (y - py) * t) * C + C / 2];
      });
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.shadowColor = "rgb(255 214 170 / .8)"; ctx.shadowBlur = 22;
      for (let i = pts.length - 1; i > 0; i--) {
        const k = i / pts.length; // 0 at the head, ~1 at the tail
        ctx.strokeStyle = crashed ? `hsl(330 60% 70% / ${0.9 - 0.6 * k})` : `hsl(${(40 + 250 * k) % 360} 85% ${78 - 10 * k}% / ${1 - 0.7 * k})`;
        ctx.lineWidth = C * (0.62 - 0.25 * k);
        ctx.beginPath(); ctx.moveTo(...pts[i - 1]); ctx.lineTo(...pts[i]); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      const [hx, hy] = pts[0];
      glowDot(ctx, hx, hy, C * 1.3, "255 236 200", 0.5);
      ctx.fillStyle = "#fff8ec"; ctx.beginPath(); ctx.arc(hx, hy, C * 0.26, 0, TAU); ctx.fill();
    }

    function frame(now) {
      if (view.visible) draw(now);
      requestAnimationFrame(frame);
    }

    function step() {
      if (queue.length) dir = queue.shift();
      const [dx, dy] = DIRS[dir];
      const [hx, hy] = snake[0];
      const next = [hx + dx, hy + dy];
      const ate = next[0] === light[0] && next[1] === light[1];
      const body = ate ? snake : snake.slice(0, -1);
      if (next[0] < 0 || next[1] < 0 || next[0] >= G || next[1] >= G || body.some(([x, y]) => x === next[0] && y === next[1])) {
        return end();
      }
      prev = snake.map((p) => p.slice());
      snake.unshift(next);
      if (ate) {
        score++; scoreEl.textContent = score; placeLight();
        speed = Math.max(70, speed - 3);
      } else snake.pop();
      lastStep = performance.now();
      timer = setTimeout(step, speed);
    }

    function end() {
      running = false; clearTimeout(timer); crashed = true; prev = snake.map((p) => p.slice());
      const b = best.get("ps");
      if (score > b) { best.set("ps", score); bestEl.textContent = score; }
      endMessage(msg, "You drifted into the wall.", score, score === 1 ? "light gathered" : "lights gathered", score > b);
      overlay.hidden = false;
      document.getElementById("ps-start").textContent = "again";
    }

    const KEYS = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right",
                   W: "up", S: "down", A: "left", D: "right" };
    document.addEventListener("keydown", (e) => {
      if (!running || !KEYS[e.key]) return;
      e.preventDefault(); // don't scroll the page while playing
      turn(KEYS[e.key]);
    });
    let touch = null;
    canvas.addEventListener("touchstart", (e) => { touch = e.touches[0]; }, { passive: true });
    canvas.addEventListener("touchmove", (e) => { if (running) e.preventDefault(); }, { passive: false });
    canvas.addEventListener("touchend", (e) => {
      if (!touch || !running) return;
      const t = e.changedTouches[0], dx = t.clientX - touch.clientX, dy = t.clientY - touch.clientY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 20) turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
      touch = null;
    });
    document.querySelectorAll(".dpad button").forEach((b) => { b.onclick = () => running && turn(b.dataset.dir); });

    document.getElementById("ps-start").onclick = () => {
      overlay.hidden = true; reset(); running = true; canvas.focus({ preventScroll: true });
      timer = setTimeout(step, speed);
    };
    reset();
    requestAnimationFrame(frame);
  })();
})();
