"use strict";
// Sound for the corridor and the rooms, all made in the browser with the Web Audio API (no sound files):
// the buzz of the ceiling lights, room tone, footsteps on carpet, doors creaking and slamming, knocks behind doors,
// the zap of a dying tube, a locked handle rattling, someone else's steps. Browsers only allow sound after a click or
// a key press, so it wakes up on the first one. M switches it off and on (remembered).
//
// window.SFX: start(), hum(level 0..1), tone(kind), step(), creak(), latch(), slam(pan, far), knock(pan, far),
// zap(), rattle(), steps(n, pan, far), thud(), on (getter)

window.SFX = (() => {
  let ctx = null, master = null, noise = null, humGain = null, toneGain = null, toneFilter = null;
  let off = false;
  try { off = localStorage.getItem("sfx-off") === "1"; } catch { /* private mode */ }
  const rnd = (a, b) => a + Math.random() * (b - a);

  function start() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = off ? 0 : .9;
    const comp = ctx.createDynamicsCompressor(); master.connect(comp); comp.connect(ctx.destination);
    // two seconds of noise, used by almost everything
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // the light buzz: mains hum and its harmonics, a little noise, wobbling
    humGain = ctx.createGain(); humGain.gain.value = 0; humGain.connect(master);
    for (const [fr, g] of [[50, .5], [100, .9], [150, .25], [200, .35], [300, .08]]) {
      const o = ctx.createOscillator(); o.frequency.value = fr; o.type = fr === 100 ? "sawtooth" : "sine";
      const og = ctx.createGain(); og.gain.value = g * (o.type === "sawtooth" ? .05 : .12);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
      o.connect(lp); lp.connect(og); og.connect(humGain); o.start();
    }
    const hn = src(true), hbp = ctx.createBiquadFilter(); hbp.type = "bandpass"; hbp.frequency.value = 4200; hbp.Q.value = 2;
    const hng = ctx.createGain(); hng.gain.value = .012; hn.connect(hbp); hbp.connect(hng); hng.connect(humGain); hn.start();
    // room tone: a low rumble of the building and the city far away
    toneGain = ctx.createGain(); toneGain.gain.value = 0; toneGain.connect(master);
    toneFilter = ctx.createBiquadFilter(); toneFilter.type = "lowpass"; toneFilter.frequency.value = 220;
    const tn = src(true); tn.connect(toneFilter); toneFilter.connect(toneGain); tn.start();
    const rumble = ctx.createOscillator(); rumble.frequency.value = 38; const rg = ctx.createGain(); rg.gain.value = .05;
    rumble.connect(rg); rg.connect(toneGain); rumble.start();
    toneGain.gain.setTargetAtTime(.22, ctx.currentTime, 1.5);
  }
  function src(loop) { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = !!loop; if (loop) s.loopStart = Math.random(); return s; }
  const ready = () => ctx && ctx.state === "running";

  // one short sound: noise or a tone, through a filter, an envelope, a panner (pan -1..1) and distance (0 near .. 1 far)
  function hit({ freq = 800, q = 1, type = "bandpass", dur = .12, gain = .3, attack = .004, pan = 0, far = 0, tone = 0, at = 0, glide = 0 }) {
    if (!ready()) return;
    const t = ctx.currentTime + at;
    const s = tone ? ctx.createOscillator() : src(false);
    if (tone) { s.type = typeof tone === "string" ? tone : "sine"; s.frequency.setValueAtTime(freq, t); if (glide) s.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + dur); }
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = tone ? 20000 : freq * (1 - far * .6); fl.Q.value = q;
    if (tone) fl.type = "lowpass", fl.frequency.value = 6000 * (1 - far * .8);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain * (1 - far * .75), t + attack); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    s.connect(fl); fl.connect(g);
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(master); } else g.connect(master);
    if (tone) s.start(t); else s.start(t, Math.random() * 1.5);
    s.stop(t + dur + .05);
  }

  return {
    get on() { return !off; },
    start,
    toggle() {
      off = !off; try { localStorage.setItem("sfx-off", off ? "1" : ""); } catch { /* */ }
      if (master) master.gain.setTargetAtTime(off ? 0 : .9, ctx.currentTime, .1);
      return !off;
    },
    hum(level) { if (humGain) humGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * .55, ctx.currentTime, .15); },
    tone(kind) {           // "hall" (open, city behind glass) or "room" (closed, quieter, darker)
      if (!toneGain) return;
      toneFilter.frequency.setTargetAtTime(kind === "room" ? 140 : 260, ctx.currentTime, .5);
      toneGain.gain.setTargetAtTime(kind === "room" ? .16 : .24, ctx.currentTime, .8);
    },
    step() {               // a footstep on carpet: a soft thump and a scuff
      hit({ freq: rnd(90, 130), type: "lowpass", dur: .14, gain: .5, q: .7 });
      hit({ freq: rnd(900, 1400), q: .8, dur: .09, gain: .05, at: .02 });
    },
    steps(n = 4, pan = 0, far = .5, gap = .55) {   // someone else walking
      for (let i = 0; i < n; i++) {
        hit({ freq: rnd(80, 120), type: "lowpass", dur: .16, gain: .45, pan, far, at: i * gap * rnd(.92, 1.08) });
        hit({ freq: rnd(800, 1300), q: .8, dur: .08, gain: .04, pan, far, at: i * gap + .02 });
      }
    },
    creak() {              // a door hinge: a scraping tone wobbling up and down
      if (!ready()) return;
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain(), bp = ctx.createBiquadFilter();
      o.type = "sawtooth"; bp.type = "bandpass"; bp.Q.value = 9;
      o.frequency.setValueAtTime(rnd(160, 220), t);
      for (let i = 1; i <= 8; i++) o.frequency.linearRampToValueAtTime(rnd(120, 340), t + i * .07);
      bp.frequency.setValueAtTime(900, t); bp.frequency.linearRampToValueAtTime(1600, t + .55);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.09, t + .05); g.gain.setValueAtTime(.09, t + .45); g.gain.exponentialRampToValueAtTime(.0001, t + .65);
      o.connect(bp); bp.connect(g); g.connect(master); o.start(t); o.stop(t + .7);
    },
    latch() { hit({ freq: 2600, q: 4, dur: .05, gain: .25 }); hit({ freq: 1200, q: 3, dur: .06, gain: .18, at: .07 }); },
    slam(pan = 0, far = 0) {
      hit({ freq: 70, type: "lowpass", dur: .5, gain: .9, pan, far });
      hit({ freq: 600, q: .7, dur: .18, gain: .25, pan, far });
      hit({ freq: 140, type: "lowpass", dur: .9, gain: .15, pan, far: Math.min(1, far + .4), at: .12 });   // the echo down the hall
    },
    thud() { hit({ freq: 60, type: "lowpass", dur: .35, gain: .55 }); hit({ freq: 500, q: .8, dur: .1, gain: .1 }); },
    knock(pan = .6, far = .3, n = 3) {
      for (let i = 0; i < n; i++) {
        hit({ freq: 180, type: "lowpass", dur: .12, gain: .7, pan, far, at: i * rnd(.28, .34) });
        hit({ freq: 1100, q: 2, dur: .04, gain: .12, pan, far, at: i * .31 });
      }
    },
    zap() {                // a fluorescent tube giving up
      for (let i = 0; i < 4; i++) hit({ freq: rnd(2500, 6000), q: 1.5, dur: rnd(.02, .06), gain: .18, at: i * rnd(.03, .09) });
      hit({ freq: 100, tone: "square", dur: .25, gain: .05 });
    },
    rattle() { for (let i = 0; i < 5; i++) hit({ freq: rnd(1500, 2600), q: 5, dur: .04, gain: .2, at: i * .06 }); hit({ freq: 140, type: "lowpass", dur: .15, gain: .3, at: .1 }); },
  };
})();

// wake the sound on the first click or key press; M switches it off and on
(() => {
  const wake = () => window.SFX.start();
  addEventListener("pointerdown", wake); addEventListener("keydown", wake);
  addEventListener("keydown", (e) => {
    if (e.code !== "KeyM" || e.target.closest && e.target.closest("input, textarea")) return;
    window.SFX.toggle();
  });
})();
