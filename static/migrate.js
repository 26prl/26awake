"use strict";
// Moving the site to a new domain without losing anyone's player.
//
// Each browser keeps its player (number + secret key), best score, unfinished games and settings in localStorage,
// which belongs to one domain. So the old domain doesn't redirect on the server; instead this script (first thing on
// every page) sends the visitor to the same page on NEW_HOST and takes those saved things along in the part of the
// address after "#", which browsers never send to any server. On NEW_HOST the same script saves them and cleans the
// address bar. Then everything carries on as before: same player number, nickname, rankings, unfinished games.
//
// Switched off while NEW_HOST is empty. To move: set NEW_HOST, deploy, and keep the old domain attached to the
// project as a normal domain (not as a Vercel redirect, or this script never gets to run on it).

(() => {
  const NEW_HOST = "";                                  // e.g. "newdomain.com"
  const OLD_HOSTS = ["twenty6.net", "www.twenty6.net"];
  const KEYS = ["player-2048", "best-2048", "game-2048", "pending-2048", "mines-diff", "mines-game",
    "sudoku-diff", "sudoku-game", "visitor", "banner-next"];
  const TAG = "#26move=";
  if (!NEW_HOST) return;

  const ls = (() => { try { return window.localStorage; } catch { return null; } })();
  const host = location.hostname.toLowerCase();

  // ---- old domain: pack and go ----
  if (OLD_HOSTS.includes(host) && host !== NEW_HOST) {
    const data = {};
    if (ls) for (const k of KEYS) { const v = ls.getItem(k); if (v !== null) data[k] = v; }
    let hash = location.hash;
    if (Object.keys(data).length) {
      const packed = btoa(unescape(encodeURIComponent(JSON.stringify(data))))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      hash = TAG + packed + (location.hash ? "&h=" + encodeURIComponent(location.hash.slice(1)) : "");
    }
    location.replace(`https://${NEW_HOST}${location.pathname}${location.search}${hash}`);
    document.documentElement.style.display = "none";   // nothing flashes while leaving
    return;
  }

  // ---- new domain: unpack what came along ----
  if (location.hash.startsWith(TAG)) {
    const [packed, rest] = location.hash.slice(TAG.length).split("&h=");
    try {
      const b64 = packed.replace(/-/g, "+").replace(/_/g, "/");
      const data = JSON.parse(decodeURIComponent(escape(atob(b64 + "===".slice((b64.length + 3) % 4)))));
      if (ls) {
        for (const k of KEYS) {
          if (typeof data[k] !== "string") continue;
          const here = ls.getItem(k);
          if (k === "best-2048") {                       // keep the higher best score
            if (here === null || Number(data[k]) > Number(here)) ls.setItem(k, data[k]);
          } else if (here === null) {                    // never overwrite what this browser already has here
            ls.setItem(k, data[k]);
          }
        }
      }
    } catch { /* damaged or cut-off address: just carry on */ }
    history.replaceState(null, "", location.pathname + location.search + (rest ? "#" + decodeURIComponent(rest) : ""));
  }
})();
