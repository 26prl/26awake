"use strict";
// The banner slot on the game pages (#ad-slot): the parody ads in banners/ in a random order, like the music clips —
// each one once per round (playing PLAYS times in a row before the next), a new shuffle every round, never the same
// one twice in a row. The order and the place in it are kept in localStorage, so each new page carries on with the
// next banner. Clickable-looking, goes nowhere. To add one: put the file in banners/ and add it below with the
// length of one play in milliseconds.
//
// Each banner is downloaded once; every time it's shown it gets a fresh object URL, so its animation always starts
// from the first frame (browsers otherwise share an animation's progress between uses of the same file).

(() => {
  const BANNERS = [
    ["course.webp", 11190], ["bank.webp", 9190], ["ex.webp", 10740], ["pyramid.webp", 8430], ["giveaway.webp", 8310],
    ["doctors.webp", 8580], ["scratch.webp", 8530], ["signals.webp", 8810], ["calc.webp", 8340],
    ["terminal.webp", 8010],
  ];
  const PLAYS = 3, KEY = "banner-queue";
  const slot = document.getElementById("ad-slot");
  if (!slot) return;

  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const names = BANNERS.map((b) => b[0]);
  const ms = Object.fromEntries(BANNERS);

  // the queue: {order: [names], at: index of the one to show next}
  let q = null;
  try { q = JSON.parse(localStorage.getItem(KEY)); } catch { /* private mode */ }
  const valid = q && Array.isArray(q.order) && q.order.length === names.length && names.every((n) => q.order.includes(n))
    && Number.isInteger(q.at) && q.at >= 0;
  if (!valid) q = { order: shuffle(names.slice()), at: 0 };

  function take() {                                // the next banner, reshuffling at the end of a round
    if (q.at >= q.order.length) {
      const last = q.order[q.order.length - 1];
      do shuffle(q.order); while (q.order.length > 1 && q.order[0] === last);
      q.at = 0;
    }
    const name = q.order[q.at++];
    try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* private mode */ }
    return name;
  }

  const blobs = new Map();
  const load = (name) => {
    if (!blobs.has(name)) blobs.set(name, fetch(`/banners/${name}`).then((r) => (r.ok ? r.blob() : null)).catch(() => null));
    return blobs.get(name);
  };

  let shownUrl = null, timer = null;
  async function show() {
    const name = take();
    const blob = await load(name);
    if (q.at < q.order.length) load(q.order[q.at]);            // fetch the next one in the background
    clearTimeout(timer);
    if (blob) {
      const url = URL.createObjectURL(blob);
      slot.onload = () => { if (shownUrl && shownUrl !== url) URL.revokeObjectURL(shownUrl); shownUrl = url; };
      slot.src = url;
    }
    timer = setTimeout(show, blob ? ms[name] * PLAYS : 1000);
  }
  show();
})();
