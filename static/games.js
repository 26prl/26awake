"use strict";
// Two small canvas games for the home page. Best scores are kept in localStorage (per device).

(() => {
  const best = {
    get: (k) => { try { return Number(localStorage.getItem(`best-${k}`)) || 0; } catch { return 0; } },
    set: (k, v) => { try { localStorage.setItem(`best-${k}`, String(v)); } catch { /* private mode */ } },
  };
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // Canvas pixels → board coordinates, whatever size CSS draws it at.
  function boardPoint(canvas, e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  }

  // ====================================================================================
  // Bonk! — whack the moles, avoid the bombs. 30-second rounds.
  // ====================================================================================
  (() => {
    const canvas = document.getElementById("ff-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const overlay = document.getElementById("ff-overlay");
    const msg = document.getElementById("ff-msg");
    const scoreEl = document.getElementById("ff-score");
    const bestEl = document.getElementById("ff-best");
    const timeEl = document.getElementById("ff-time");
    const N = 3, CELL = canvas.width / N, ROUND = 30_000;
    let holes, score, started, running = false, nextSpawn, pops, raf;
    bestEl.textContent = best.get("ff");

    const reset = () => {
      holes = Array.from({ length: N * N }, () => null); // { kind: "mole" | "bomb", until, hit }
      score = 0; pops = []; started = performance.now(); nextSpawn = started + 400;
      scoreEl.textContent = 0;
    };

    function spawn(now) {
      const free = holes.map((h, i) => (h ? -1 : i)).filter((i) => i >= 0);
      if (!free.length) return;
      const i = free[Math.floor(Math.random() * free.length)];
      const progress = (now - started) / ROUND; // gets faster over the round
      holes[i] = { kind: Math.random() < 0.16 ? "bomb" : "mole", born: now, until: now + 1000 - 450 * progress, hit: false };
      nextSpawn = now + 650 - 380 * progress + Math.random() * 200;
    }

    function drawMole(x, y, s) {
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = "#6d4c3d"; ctx.beginPath(); ctx.ellipse(0, 4 * s, 22 * s, 26 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#c9a38b"; ctx.beginPath(); ctx.ellipse(0, 12 * s, 13 * s, 12 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1b120d"; ctx.beginPath(); ctx.arc(-8 * s, -6 * s, 3 * s, 0, Math.PI * 2); ctx.arc(8 * s, -6 * s, 3 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-7 * s, -7 * s, 1 * s, 0, Math.PI * 2); ctx.arc(9 * s, -7 * s, 1 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f08aa0"; ctx.beginPath(); ctx.ellipse(0, 2 * s, 5 * s, 3.6 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillRect(-3 * s, 7 * s, 2.6 * s, 4 * s); ctx.fillRect(0.4 * s, 7 * s, 2.6 * s, 4 * s);
      ctx.fillStyle = "rgb(255 143 163 / .55)"; ctx.beginPath(); ctx.ellipse(-14 * s, 4 * s, 4.5 * s, 2.4 * s, 0, 0, Math.PI * 2); ctx.ellipse(14 * s, 4 * s, 4.5 * s, 2.4 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    function drawBomb(x, y, s, t) {
      ctx.save(); ctx.translate(x, y);
      ctx.fillStyle = "#24262b"; ctx.beginPath(); ctx.arc(0, 6 * s, 20 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgb(255 255 255 / .25)"; ctx.beginPath(); ctx.arc(-7 * s, -1 * s, 5 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4a4d55"; ctx.fillRect(-5 * s, -18 * s, 10 * s, 8 * s);
      ctx.strokeStyle = "#a0805a"; ctx.lineWidth = 2.5 * s; ctx.beginPath(); ctx.moveTo(0, -18 * s); ctx.quadraticCurveTo(8 * s, -28 * s, 14 * s, -24 * s); ctx.stroke();
      const flick = 0.6 + 0.4 * Math.sin(t / 60);
      ctx.fillStyle = `rgb(255 ${Math.round(140 + 80 * flick)} 40)`; ctx.beginPath(); ctx.arc(15 * s, -25 * s, 4 * s * flick + 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    function draw(now) {
      ctx.fillStyle = css("--panel") || "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < N * N; i++) {
        const cx = (i % N) * CELL + CELL / 2, cy = Math.floor(i / N) * CELL + CELL / 2 + 18;
        ctx.fillStyle = "#6b4a2e"; ctx.beginPath(); ctx.ellipse(cx, cy + 22, 44, 14, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#2e1f14"; ctx.beginPath(); ctx.ellipse(cx, cy + 22, 36, 10, 0, 0, Math.PI * 2); ctx.fill();
        const h = holes?.[i];
        if (h && !h.hit) {
          const rise = Math.min(1, (now - h.born) / 120);
          ctx.save(); ctx.beginPath(); ctx.rect(cx - 50, cy - 60, 100, 82); ctx.clip();
          if (h.kind === "mole") drawMole(cx, cy + 2 + (1 - rise) * 40, 1.15);
          else drawBomb(cx, cy + 4 + (1 - rise) * 40, 1.1, now);
          ctx.restore();
        }
      }
      for (const p of pops) {
        const a = 1 - (now - p.t) / 700;
        ctx.globalAlpha = Math.max(0, a); ctx.fillStyle = p.good ? "#12b76a" : "#e0453a";
        ctx.font = "bold 22px system-ui, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(p.text, p.x, p.y - (1 - a) * 30); ctx.globalAlpha = 1;
      }
    }

    function loop(now) {
      const left = ROUND - (now - started);
      timeEl.textContent = Math.max(0, Math.ceil(left / 1000));
      if (left <= 0) return end();
      if (now >= nextSpawn) spawn(now);
      holes.forEach((h, i) => { if (h && now > h.until) holes[i] = null; });
      pops = pops.filter((p) => now - p.t < 700);
      draw(now);
      raf = requestAnimationFrame(loop);
    }

    function end() {
      running = false;
      cancelAnimationFrame(raf);
      draw(performance.now());
      const b = best.get("ff");
      if (score > b) { best.set("ff", score); bestEl.textContent = score; }
      msg.innerHTML = "";
      msg.append(`Time! You scored `, Object.assign(document.createElement("strong"), { textContent: `${score}` }), ` points.`,
        score > b ? " New best! 🎉" : "");
      overlay.hidden = false;
      document.getElementById("ff-start").textContent = "Play again";
    }

    canvas.addEventListener("pointerdown", (e) => {
      if (!running) return;
      const { x, y } = boardPoint(canvas, e);
      const i = Math.min(N - 1, Math.floor(y / CELL)) * N + Math.min(N - 1, Math.floor(x / CELL));
      const h = holes[i];
      if (!h || h.hit) return;
      h.hit = true; h.until = 0;
      const good = h.kind === "mole";
      score = Math.max(0, score + (good ? 1 : -3));
      scoreEl.textContent = score;
      pops.push({ x, y, t: performance.now(), good, text: good ? "+1" : "BOOM −3" });
    });

    document.getElementById("ff-start").onclick = () => {
      overlay.hidden = true; reset(); running = true; raf = requestAnimationFrame(loop);
    };
    reset(); draw(performance.now());
  })();

  // ====================================================================================
  // Snake — eat the apples, don't hit the walls or yourself.
  // ====================================================================================
  (() => {
    const canvas = document.getElementById("ps-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const overlay = document.getElementById("ps-overlay");
    const msg = document.getElementById("ps-msg");
    const scoreEl = document.getElementById("ps-score");
    const bestEl = document.getElementById("ps-best");
    const G = 18, C = canvas.width / G;
    const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    let snake, dir, queue, apple, score, running = false, timer, speed;
    bestEl.textContent = best.get("ps");

    const placeApple = () => {
      do apple = [Math.floor(Math.random() * G), Math.floor(Math.random() * G)];
      while (snake.some(([x, y]) => x === apple[0] && y === apple[1]));
    };
    const reset = () => {
      snake = [[8, 9], [7, 9], [6, 9]]; dir = "right"; queue = []; score = 0; speed = 130;
      scoreEl.textContent = 0; placeApple();
    };

    function turn(d) {
      const last = queue.length ? queue[queue.length - 1] : dir;
      const [lx, ly] = DIRS[last], [nx, ny] = DIRS[d];
      if (lx + nx === 0 && ly + ny === 0) return; // no reversing into yourself
      if (d !== last && queue.length < 3) queue.push(d);
    }

    function draw() {
      const dark = matchMedia("(prefers-color-scheme: dark)").matches;
      ctx.fillStyle = css("--panel") || "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = dark ? "rgb(255 255 255 / .03)" : "rgb(0 0 0 / .03)";
      for (let x = 0; x < G; x++) for (let y = 0; y < G; y++) if ((x + y) % 2) ctx.fillRect(x * C, y * C, C, C);
      // apple
      const [px, py] = apple, cx = px * C + C / 2, cy = py * C + C / 2 + 1;
      ctx.fillStyle = "#e0453a"; ctx.beginPath(); ctx.arc(cx - C * 0.13, cy, C * 0.3, 0, Math.PI * 2); ctx.arc(cx + C * 0.13, cy, C * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "rgb(255 255 255 / .35)"; ctx.beginPath(); ctx.arc(cx - C * 0.18, cy - C * 0.1, C * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#6b4a2e"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy - C * 0.22); ctx.lineTo(cx + 1, cy - C * 0.42); ctx.stroke();
      ctx.fillStyle = "#3aa655"; ctx.beginPath(); ctx.ellipse(cx + C * 0.12, cy - C * 0.38, C * 0.12, C * 0.06, -0.5, 0, Math.PI * 2); ctx.fill();
      // snake (head drawn last)
      snake.slice().reverse().forEach(([x, y], i, arr) => {
        const head = i === arr.length - 1;
        ctx.fillStyle = head ? "#2f8f46" : `hsl(${130 + (i % 4) * 3} 45% ${dark ? 45 : 40}%)`;
        ctx.beginPath(); ctx.roundRect(x * C + 1.5, y * C + 1.5, C - 3, C - 3, head ? 7 : 5); ctx.fill();
        if (head) {
          const [dx, dy] = DIRS[dir];
          ctx.fillStyle = "#fff";
          for (const s of [-1, 1]) {
            const ex = x * C + C / 2 + dx * 4 + (dy ? s * 4.5 : 0), ey = y * C + C / 2 + dy * 4 + (dx ? s * 4.5 : 0);
            ctx.beginPath(); ctx.arc(ex, ey, 2.6, 0, Math.PI * 2); ctx.fill();
          }
        }
      });
    }

    function step() {
      if (queue.length) dir = queue.shift();
      const [dx, dy] = DIRS[dir];
      const [hx, hy] = snake[0];
      const next = [hx + dx, hy + dy];
      const ate = next[0] === apple[0] && next[1] === apple[1];
      const body = ate ? snake : snake.slice(0, -1);
      if (next[0] < 0 || next[1] < 0 || next[0] >= G || next[1] >= G || body.some(([x, y]) => x === next[0] && y === next[1])) {
        return end();
      }
      snake.unshift(next);
      if (ate) {
        score++; scoreEl.textContent = score; placeApple();
        speed = Math.max(65, speed - 3);
      } else snake.pop();
      draw();
      timer = setTimeout(step, speed);
    }

    function end() {
      running = false; clearTimeout(timer); draw();
      const b = best.get("ps");
      if (score > b) { best.set("ps", score); bestEl.textContent = score; }
      msg.innerHTML = "";
      msg.append("Ouch! ", Object.assign(document.createElement("strong"), { textContent: `${score}` }),
        ` apple${score === 1 ? "" : "s"} eaten.`, score > b ? " New best! 🎉" : "");
      overlay.hidden = false;
      document.getElementById("ps-start").textContent = "Play again";
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
      overlay.hidden = true; reset(); running = true; draw(); canvas.focus({ preventScroll: true });
      timer = setTimeout(step, speed);
    };
    reset(); draw();
  })();
})();
