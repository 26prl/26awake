"use strict";
// The banner slot on the game pages (#ad-slot): plays the parody ads in banners/ one after another, each one PLAYS
// times in a row, then the next, looping through all of them; each new page picks up with the next one.
// Clickable-looking, goes nowhere. To add one: put the file in banners/ and add it below with the length of one play
// in milliseconds.
//
// Each banner is downloaded once; every time it's shown it gets a fresh object URL, so its animation always starts
// from the first frame (browsers otherwise share an animation's progress between uses of the same file).

(() => {
  const BANNERS = [
    ["course.webp", 11190], ["bank.webp", 9190], ["ex.webp", 10740], ["pyramid.webp", 8430], ["giveaway.webp", 8310],
  ];
  const PLAYS = 3;
  const slot = document.getElementById("ad-slot");
  if (!slot) return;

  const blobs = new Map();
  const load = (name) => {
    if (!blobs.has(name)) blobs.set(name, fetch(`banners/${name}`).then((r) => (r.ok ? r.blob() : null)).catch(() => null));
    return blobs.get(name);
  };

  let i = 0, shownUrl = null, timer = null;
  try { i = (Number(localStorage.getItem("banner-next")) || 0) % BANNERS.length; } catch { i = Math.floor(Math.random() * BANNERS.length); }

  async function show() {
    const [name, ms] = BANNERS[i];
    const next = (i + 1) % BANNERS.length;
    try { localStorage.setItem("banner-next", String(next)); } catch { /* private mode */ }  // next visit starts with the next one
    const blob = await load(name);
    load(BANNERS[next][0]);                                   // fetch the next one in the background
    clearTimeout(timer);
    if (blob) {
      const url = URL.createObjectURL(blob);
      slot.onload = () => { if (shownUrl && shownUrl !== url) URL.revokeObjectURL(shownUrl); shownUrl = url; };
      slot.src = url;
    }
    i = next;
    timer = setTimeout(show, blob ? ms * PLAYS : 1000);
  }
  show();
})();
