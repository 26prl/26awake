"use strict";
// The banner slot on the game pages (#ad-slot). One of the parody ads in banners/ is picked at random when the browser
// session starts and stays the same while browsing (sessionStorage); after a browser restart a different one is picked.
// The banners are clickable-looking but go nowhere. To add one: put the file in banners/ and add its name below.

(() => {
  const BANNERS = ["course.webp", "bank.webp", "ex.webp", "pyramid.webp", "giveaway.webp"];
  const slot = document.getElementById("ad-slot");
  if (!slot) return;
  const get = (s, k) => { try { return s.getItem(k); } catch { return null; } };
  const set = (s, k, v) => { try { s.setItem(k, v); } catch { /* private mode */ } };
  let pick = get(sessionStorage, "banner");
  if (!BANNERS.includes(pick)) {
    const last = get(localStorage, "banner-last");   // not the same one as last time
    const choices = BANNERS.filter((b) => b !== last);
    pick = choices[Math.floor(Math.random() * choices.length)];
    set(sessionStorage, "banner", pick);
    set(localStorage, "banner-last", pick);
  }
  slot.src = `banners/${pick}`;
})();
