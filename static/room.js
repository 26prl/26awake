"use strict";
// The game pages are the rooms behind the corridor's doors (the look is in site.css, under .room): a little film
// grain, the light overhead dipping now and then (slowly — never more than a couple of times a second), a fade in
// when you arrive and a fade out when you go back.

(() => {
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.body.append(Object.assign(document.createElement("div"), { className: "room-grain" }));
  const dark = Object.assign(document.createElement("div"), { className: "room-dark" });
  document.body.append(dark);

  // the light dips: once, or twice in a row, every 8-25 seconds
  if (!calm) (function dip() {
    setTimeout(() => {
      if (!document.hidden) {
        const n = Math.random() < .35 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          setTimeout(() => dark.classList.add("on"), i * 450);
          setTimeout(() => dark.classList.remove("on"), i * 450 + 90 + Math.random() * 120);
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
    document.body.classList.add("leaving");
    setTimeout(() => { location.href = back.href; }, 330);
  });
  // coming back to this page from the browser's history: don't stay faded out
  addEventListener("pageshow", (e) => { if (e.persisted) document.body.classList.remove("leaving"); });
})();
