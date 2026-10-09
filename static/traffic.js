"use strict";
// restricted.html: password lock (api/agent.js), then the site's traffic from the visit log (api/visits.js):
// totals, top pages, sources, countries, browsers/devices, and the latest visits with IP addresses.

(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids) if (k != null && k !== false) n.append(k);
    return n;
  };
  const store = {
    get(k, f) { try { return JSON.parse(localStorage.getItem(k)) ?? f; } catch { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  let token = store.get("agent-token", null);
  let visits = [], range = "1";

  function show(view) {
    for (const v of ["r-off", "r-lock", "r-room"]) $(v).hidden = v !== view;
    dispatchEvent(new Event("relayout"));
  }
  function logout() { token = null; store.set("agent-token", null); show("r-lock"); }

  $("r-login").onsubmit = async (e) => {
    e.preventDefault();
    $("r-lock-msg").textContent = "…";
    try {
      const r = await fetch("api/agent", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", password: $("r-pass").value }) });
      const d = await r.json();
      if (d.configured === false) return show("r-off");
      if (!r.ok || !d.token) { $("r-lock-msg").textContent = d.error || "Couldn't log in."; return; }
      token = d.token; store.set("agent-token", token);
      $("r-pass").value = ""; $("r-lock-msg").textContent = "";
      load();
    } catch {
      $("r-lock-msg").textContent = "Couldn't reach the server.";
    }
  };
  $("r-logout").onclick = logout;
  $("t-reload").onclick = () => load();
  document.querySelectorAll(".t-range button").forEach((b) => {
    b.onclick = () => { range = b.dataset.range; draw(); };
  });

  async function load() {
    try {
      const r = await fetch("api/agent?traffic", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!(r.headers.get("content-type") || "").includes("json")) return show("r-off");
      const d = await r.json();
      if (d.configured === false) return show("r-off");
      if (r.status === 401) return logout();
      visits = d.visits || [];
    } catch { return show("r-off"); }
    show("r-room");
    draw();
  }

  // ---- reading a visit -----------------------------------------------------------------

  const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|python|curl|wget|httpclient/i;
  function browser(ua) {
    if (!ua) return "unknown";
    if (BOT.test(ua)) return "bot";
    const b = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /YaBrowser/.test(ua) ? "Yandex" :
      /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "other";
    const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" :
      /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "other";
    return `${b} · ${os}`;
  }
  function source(ref) {
    if (!ref) return "direct / unknown";
    try {
      const h = new URL(ref).hostname.replace(/^www\./, "");
      return h === location.hostname.replace(/^www\./, "") ? "(this site)" : h;
    } catch { return "unknown"; }
  }
  const page = (p) => (!p || p === "/" ? "/ (home)" : p.replace(/\.html$/, ""));
  const place = (v) => [v.city, v.rg, v.c].filter(Boolean).join(", ") || "unknown";
  const flag = (cc) => (/^[A-Z]{2}$/.test(cc || "") ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "");
  const when = (t) => new Date(t).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  // ---- drawing -------------------------------------------------------------------------

  function top(list, key, n = 8) {
    const counts = new Map();
    for (const v of list) { const k = key(v); counts.set(k, (counts.get(k) || 0) + 1); }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, n);
  }
  function topBox(title, rows, total) {
    return el("div", { className: "t-box" }, el("h3", { textContent: title }),
      rows.length ? el("table", { className: "t-top" }, el("tbody", {}, ...rows.map(([k, n]) => el("tr", {},
        el("td", { textContent: k }), el("td", { className: "n", textContent: n }),
        el("td", { className: "bar" }, el("i", { style: `width:${Math.round((100 * n) / total)}%` }))))))
        : el("p", { className: "muted small", textContent: "nothing yet" }));
  }

  function draw() {
    document.querySelectorAll(".t-range button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === range)));
    const since = range === "all" ? 0 : Date.now() - Number(range) * 864e5;
    const list = visits.filter((v) => v.t >= since);
    const people = new Set(list.map((v) => v.v)).size;
    const humans = list.filter((v) => browser(v.ua) !== "bot");
    $("t-sum").replaceChildren(
      el("div", {}, el("b", { textContent: list.length }), el("span", { textContent: "page views" })),
      el("div", {}, el("b", { textContent: people }), el("span", { textContent: "visitors" })),
      el("div", {}, el("b", { textContent: new Set(list.map((v) => v.ip).filter(Boolean)).size }), el("span", { textContent: "IP addresses" })),
      el("div", {}, el("b", { textContent: list.length - humans.length }), el("span", { textContent: "bot views" })));
    $("t-tops").replaceChildren(
      topBox("pages", top(list, (v) => page(v.p)), list.length),
      topBox("came from", top(list, (v) => source(v.r)), list.length),
      topBox("countries", top(list, (v) => `${flag(v.c)} ${v.c || "unknown"}`.trim()), list.length),
      topBox("cities", top(list, place), list.length),
      topBox("browser · device", top(list, (v) => browser(v.ua)), list.length),
      topBox("language", top(list, (v) => v.lang || "unknown"), list.length));
    const recent = list.slice(0, 200);
    $("t-log").replaceChildren(recent.length
      ? el("table", { className: "g8-table t-table" },
        el("thead", {}, el("tr", {}, ...["time", "page", "from", "where", "IP", "browser · device"].map((h) => el("th", { textContent: h })))),
        el("tbody", {}, ...recent.map((v) => el("tr", { title: v.ua || "" },
          el("td", { textContent: when(v.t) }), el("td", { textContent: page(v.p) }), el("td", { textContent: source(v.r) }),
          el("td", { textContent: `${flag(v.c)} ${place(v)}`.trim() }), el("td", { className: "ip", textContent: v.ip || "–" }),
          el("td", { textContent: browser(v.ua) })))))
      : el("p", { className: "muted small", textContent: "No visits in this period." }));
    $("t-note").textContent = `${visits.length} page views kept in total (the newest 5,000).`;
    dispatchEvent(new Event("relayout"));
  }

  if (token) load(); else show("r-lock");
})();
