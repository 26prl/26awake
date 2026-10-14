"use strict";
// Fake ad banners (.fake-ad) are clickable but go nowhere: a click makes the page glitch hard (glitch.js listens
// for "mv-switch") and pops up a fake old-Windows message next to the banner. OK (or a few seconds) closes it.

(() => {
  const MSGS = [
    ["prize.exe", "Error 404: prize not found."],
    ["26awake.exe", "Prize claimed! It will arrive in 2048 years."],
    ["winner.dll", "You already won. Congrats again, I guess."],
    ["virus.exe", "virus.exe downloaded successfully. (jk)"],
    ["26awake.exe", "Nice try. Now go play."],
    ["prize.exe", "Your free 2048 tile is in another castle."],
    ["lottery.sys", "Out of prizes. Please insert 26 coins."],
    ["26awake.exe", "Are you sure? There was never a prize."],
  ];
  let open = null, last = -1;

  function popup(ad) {
    if (open) open.remove();
    let i; do i = Math.floor(Math.random() * MSGS.length); while (i === last); last = i;
    const [title, text] = MSGS[i];
    const box = document.createElement("div");
    box.className = "ad-pop"; box.setAttribute("role", "alertdialog");
    box.innerHTML = `<div class="ad-pop-bar"><span></span><button type="button" aria-label="close">×</button></div>
      <div class="ad-pop-body"><i>!</i><p></p></div><div class="ad-pop-ok"><button type="button">OK</button></div>`;
    box.querySelector(".ad-pop-bar span").textContent = title;
    box.querySelector("p").textContent = text;
    const r = ad.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(innerWidth - 268, r.left + r.width / 2 - 130 + (Math.random() * 80 - 40)))}px`;
    box.style.top = `${r.bottom + scrollY + 8}px`;
    const close = () => { box.remove(); if (open === box) open = null; };
    box.querySelectorAll("button").forEach((b) => (b.onclick = close));
    setTimeout(close, 5000);
    document.body.append(box);
    open = box;
  }

  for (const ad of document.querySelectorAll(".fake-ad")) {
    ad.tabIndex = 0; ad.setAttribute("role", "button");
    const go = () => { dispatchEvent(new Event("mv-switch")); popup(ad); };
    ad.addEventListener("click", go);
    ad.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  }
})();
