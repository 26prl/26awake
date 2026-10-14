"use strict";
// Moving the site to a new domain without losing anyone's player.
//
// Each browser keeps its player (number + secret key), best score, unfinished games and settings in localStorage,
// which belongs to one domain. So the old domain doesn't redirect on the server; instead this script (first thing on
// every page) sends the visitor to the same page on NEW_HOST and takes those saved things along in the part of the
// address after "#", which browsers never send to any server. On NEW_HOST the same script saves them and cleans the
// address bar. Then everything carries on as before: same player number, nickname, rankings, unfinished games.
//
// Before leaving, the old domain loads our logo from NEW_HOST; only if that works (the new domain is up and serving
// this site) does it send the visitor over, otherwise they simply stay (and it isn't tried again this session).
// Switched off while NEW_HOST is empty. Keep the old domain attached to the Vercel project as a normal domain (not
// as a Vercel redirect, or this script never gets to run on it).

(() => {
  const NEW_HOST = "26awake.net";
  const OLD_HOSTS = ["twenty6.net", "www.twenty6.net", "www.26awake.net"];
  const KEYS = ["player-2048", "best-2048", "game-2048", "pending-2048", "mines-diff", "mines-game",
    "sudoku-diff", "sudoku-game", "visitor", "banner-next"];
  const TAG = "#26move=";
  if (!NEW_HOST) return;

  const ls = (() => { try { return window.localStorage; } catch { return null; } })();
  const host = location.hostname.toLowerCase();

  // ---- old domain: check the new one is up, then pack and go ----
  if (OLD_HOSTS.includes(host) && host !== NEW_HOST) {
    const go = () => {
      const data = {};
      if (ls) for (const k of KEYS) { const v = ls.getItem(k); if (v !== null) data[k] = v; }
      let hash = location.hash;
      if (Object.keys(data).length) {
        const packed = btoa(unescape(encodeURIComponent(JSON.stringify(data))))
          .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        hash = TAG + packed + (location.hash ? "&h=" + encodeURIComponent(location.hash.slice(1)) : "");
      }
      location.replace(`https://${NEW_HOST}${location.pathname}${location.search}${hash}`);
    };
    let down = false;
    try { down = sessionStorage.getItem("move-down") === "1"; } catch { /* private mode */ }
    if (!down) {
      // only leave if the new domain is really up and serving this site: load our logo from it first
      document.documentElement.style.visibility = "hidden";           // nothing flashes while checking/leaving
      const show = () => { document.documentElement.style.visibility = ""; };
      const ping = new Image();
      const timer = setTimeout(() => { ping.onload = ping.onerror = null; fail(); }, 3000);
      const fail = () => { clearTimeout(timer); try { sessionStorage.setItem("move-down", "1"); } catch { /* */ } show(); };
      ping.onload = () => { clearTimeout(timer); go(); };
      ping.onerror = fail;
      ping.src = `https://${NEW_HOST}/icons/logo-26awake-net.png?up=${Math.floor(Date.now() / 36e5)}`;
    }
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
