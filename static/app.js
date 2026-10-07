"use strict";

const $ = (sel) => document.querySelector(sel);
const POLL_MS = 60_000;
const PAGE = 50;
const TIER_ORDER = ["official", "expert", "reputable", "state", "unknown", "low"];
const TRUSTED = ["official", "expert", "reputable"];
const LEVEL_LABEL = {
  confirmed: "Confirmed", corroborated: "Corroborated", single_source: "Single trusted source", unverified: "Unverified",
};
const STATUS_LABEL = {
  no_activity: "No activity", isolated_cases: "Isolated cases", active_outbreak: "Active outbreak",
  escalating: "Escalating", declining: "Declining", unclear: "Unclear",
};

const state = { topics: [], current: null, offset: 0, lastSeen: null, trust: {}, mode: "api", health: {} };

// ---- helpers --------------------------------------------------------------------------

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) if (c != null && c !== false) node.append(c);
  return node;
}

function ago(iso) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

function tierBadge(tier) {
  const info = state.trust[tier] || { label: tier };
  return el("span", { className: `tier tier-${tier}`, textContent: info.label, title: info.description || "" });
}

// Wrap every topic keyword in <mark>, building DOM nodes (never innerHTML) so headlines stay inert.
function highlight(text, keywords) {
  const frag = document.createDocumentFragment();
  const words = keywords.filter((k) => k.length > 2).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!words.length) { frag.append(text); return frag; }
  const re = new RegExp(`(${words.join("|")})`, "gi");
  let last = 0;
  for (const m of text.matchAll(re)) {
    frag.append(text.slice(last, m.index), el("mark", { textContent: m[0] }));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

// ---- data sources: live API (python -m tracker) or a static export (Vercel / Pages) ----

async function http(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = store.get("tracker-token");
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`api${path}`, { ...opts, headers });
  if (res.status === 401) {
    const t = prompt("This tracker is write-protected. Enter the access token:");
    if (t) { store.set("tracker-token", t); return http(path, opts); }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const apiSource = {
  topics: () => http("/topics"),
  trust: () => http("/trust"),
  timeline: (id, days) => http(`/topics/${id}/timeline?days=${days}`),
  breakdown: (id) => http(`/topics/${id}/breakdown`),
  insights: (id) => http(`/topics/${id}/insights`),
  analysis: (id) => http(`/topics/${id}/analysis`),
  runs: (id) => http(`/topics/${id}/runs`),
  articles: (id, f) => {
    const qs = new URLSearchParams({ limit: f.limit, offset: f.offset, q: f.q, lang: f.lang, trust: f.trust });
    return http(`/topics/${id}/articles?${qs}`);
  },
  refresh: (id) => http(`/topics/${id}/refresh`, { method: "POST" }),
  analyze: (id) => http(`/topics/${id}/analyze`, { method: "POST" }),
  save: (id, body) => http(id ? `/topics/${id}` : "/topics", { method: id ? "PUT" : "POST", body: JSON.stringify(body) }),
  remove: (id) => http(`/topics/${id}`, { method: "DELETE" }),
};

const staticSource = (() => {
  let site = null;
  const cache = {};
  const load = async (url) => { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(r.statusText); return r.json(); };
  const topicData = async (id) => (cache[id] ??= await load(`data/topic-${id}.json`));
  return {
    async init() { site = await load("data/site.json"); return site; },
    site: () => site,
    async hasNewData() { const s = await load("data/site.json"); return s.generated_at !== site.generated_at; },
    reset() { for (const k of Object.keys(cache)) delete cache[k]; return this.init(); },
    topics: async () => site.topics,
    trust: async () => site.trust,
    timeline: async (id, days) => (await topicData(id)).timeline.slice(-days),
    breakdown: async (id) => (await topicData(id)).breakdown,
    insights: async (id) => (await topicData(id)).insights,
    analysis: async (id) => (await topicData(id)).analysis,
    runs: async (id) => (await topicData(id)).runs,
    async articles(id, f) {
      let items = (await topicData(id)).articles;
      const q = f.q.toLowerCase();
      if (q) items = items.filter((a) => `${a.title} ${a.summary} ${a.source}`.toLowerCase().includes(q));
      if (f.lang) items = items.filter((a) => a.lang === f.lang);
      if (f.trust) {
        const tiers = f.trust === "trusted" ? TRUSTED : f.trust.split(",");
        items = items.filter((a) => tiers.includes(a.trust));
      }
      return { total: items.length, items: items.slice(f.offset, f.offset + f.limit) };
    },
  };
})();

let ds = apiSource;

async function detectMode() {
  try {
    const r = await fetch("api/health", { cache: "no-store" });
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) {
      state.health = await r.json();
      return;
    }
  } catch { /* fall through to static */ }
  const site = await staticSource.init();
  ds = staticSource;
  state.mode = "static";
  state.health = { ai: false, static: true };
  document.body.classList.add("static");
}

// ---- topics sidebar -------------------------------------------------------------------

async function loadTopics() {
  state.topics = await ds.topics();
  const list = $("#topic-list");
  list.replaceChildren(...state.topics.map((t) => {
    const badge = el("span", { className: `badge${t.stats.spike ? " hot" : ""}`, textContent: `${t.stats.last24h} / 24h` });
    const li = el("li", { title: t.description || t.name, tabIndex: 0 }, el("span", { textContent: t.name }), badge);
    if (state.current && t.id === state.current.id) li.classList.add("active");
    li.onclick = () => selectTopic(t.id);
    li.onkeydown = (e) => { if (e.key === "Enter") selectTopic(t.id); };
    return li;
  }));
  $("#empty").classList.toggle("hidden", state.topics.length > 0);
  $("#topic").classList.toggle("hidden", state.topics.length === 0);
  if (!state.topics.length) return;

  const wanted = state.current?.id ?? Number(location.hash.slice(1));
  const t = state.topics.find((x) => x.id === wanted) || state.topics[0];
  if (!state.current || state.current.id !== t.id) return selectTopic(t.id);
  state.current = t;
  renderHeader();
}

async function selectTopic(id) {
  const t = state.topics.find((x) => x.id === id);
  if (!t) return;
  if (state.current?.id !== id) {
    state.lastSeen = store.get(`seen-${id}`);
    store.set(`seen-${id}`, new Date().toISOString());
    $("#search").value = "";
    $("#lang-filter").value = "";
  }
  state.current = t;
  history.replaceState(null, "", `#${id}`);
  document.querySelectorAll("#topic-list li").forEach((li, i) => li.classList.toggle("active", state.topics[i].id === id));
  renderHeader();
  await loadTopicData();
}

const loadTopicData = () => Promise.all([loadChart(), loadBreakdown(), loadInsights(), loadAnalysis(), loadArticles(true), loadRuns()]);

function renderHeader() {
  const t = state.current;
  const s = t.stats;
  $("#t-name").textContent = t.name;
  $("#t-desc").textContent = t.description || "";
  $("#s-24h").textContent = s.last24h;
  $("#s-24h-sub").textContent = `${s.trusted24h} trusted · avg ${s.daily_avg_prev7d}/day before`;
  $("#s-trusted").textContent = s.total ? `${Math.round((100 * s.trusted) / s.total)}%` : "–";
  $("#s-trusted-sub").textContent = `${s.trusted} of ${s.total} articles`;
  $("#s-official").textContent = s.latest_official ? ago(s.latest_official) : "none yet";
  $("#s-run").textContent = t.collecting ? "collecting…" : `last check ${ago(t.last_run_at)}`;
  $("#btn-refresh").disabled = t.collecting;
  const alert = $("#alert");
  alert.classList.toggle("hidden", !s.spike);
  alert.textContent = s.spike
    ? `⚠ Coverage spike: ${s.last24h} articles in the last 24 h (${s.trusted24h} from trusted sources) vs. ${s.daily_avg_prev7d}/day the week before.`
    : "";
}

// ---- chart (stacked by trust tier) ----------------------------------------------------

async function loadChart() {
  const days = Number($("#days").value);
  const data = await ds.timeline(state.current.id, days);
  const W = Math.max(280, $("#chart").clientWidth || 640), H = 220, pad = { l: 28, r: 4, t: 8, b: 22 };
  const max = Math.max(1, ...data.map((d) => d.count));
  const bw = (W - pad.l - pad.r) / data.length;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Articles per day, stacked by source trust");
  const add = (name, attrs, text, parent = svg) => {
    const n = document.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    parent.append(n);
    return n;
  };
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  for (const v of [...new Set([0, Math.ceil(max / 2), max])]) {
    add("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) });
    add("text", { x: pad.l - 5, y: y(v) + 3, "text-anchor": "end" }, v);
  }
  const labelEvery = Math.ceil(data.length / Math.max(3, Math.floor(W / 80)));
  data.forEach((d, i) => {
    const x = pad.l + i * bw;
    const g = add("g", {});
    const tiers = d.tiers || { unknown: d.count };
    let acc = 0;
    // Most trusted at the bottom of each bar.
    for (const tier of TIER_ORDER) {
      const n = tiers[tier] || 0;
      if (!n) continue;
      add("rect", { class: `seg seg-${tier}`, x: x + bw * 0.12, width: Math.max(1, bw * 0.76), y: y(acc + n), height: y(acc) - y(acc + n) }, null, g);
      acc += n;
    }
    const tip = TIER_ORDER.filter((t) => tiers[t]).map((t) => `${state.trust[t]?.label || t}: ${tiers[t]}`).join("\n");
    add("title", {}, `${d.day} — ${d.count} articles${tip ? `\n${tip}` : ""}`, g);
    if (i % labelEvery === 0) add("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle" }, d.day.slice(5));
  });
  $("#chart").replaceChildren(svg);
  $("#chart-legend").replaceChildren(...TIER_ORDER.map((t) => el("span", { className: "chip" },
    el("span", { className: `swatch seg-${t}` }), state.trust[t]?.label || t)));
}

async function loadBreakdown() {
  const { sources, languages } = await ds.breakdown(state.current.id);
  const max = Math.max(1, ...sources.map((s) => s.count));
  $("#sources").replaceChildren(...sources.map((s) => {
    const li = el("li", {}, el("span", {}, tierBadge(s.trust), " ", s.source), el("span", { className: "muted", textContent: s.count }));
    li.style.setProperty("--w", `${(s.count / max) * 100}%`);
    return li;
  }));
  if (!sources.length) $("#sources").append(el("li", { className: "muted", textContent: "Nothing yet" }));
  $("#langs").replaceChildren(...languages.map((l) => el("span", { className: "chip", textContent: `${l.lang} · ${l.count}` })));

  const sel = $("#lang-filter");
  const keep = sel.value;
  sel.replaceChildren(el("option", { value: "", textContent: "All languages" }),
    ...languages.filter((l) => l.lang !== "?").map((l) => el("option", { value: l.lang, textContent: l.lang })));
  sel.value = keep;
}

// ---- insights: trend, confidence levels, regions, figures, official updates -----------

async function loadInsights() {
  const ins = await ds.insights(state.current.id);
  const tr = ins.trend;
  const arrow = { rising: "↑ Rising", falling: "↓ Falling", stable: "→ Stable", quiet: "Quiet", new: "New activity" };
  $("#s-trend").textContent = arrow[tr.direction] || tr.direction;
  $("#s-trend").className = `value trend-${tr.direction}`;
  $("#s-trend-sub").textContent = `${tr.recent_daily_avg}/day vs ${tr.previous_daily_avg}/day`;

  // Source mix bar
  const total = Object.values(ins.tier_counts).reduce((a, b) => a + b, 0) || 1;
  const bar = el("div", { className: "mixbar" });
  const rows = el("ul", { className: "mixlist" });
  for (const t of TIER_ORDER) {
    const n = ins.tier_counts[t] || 0;
    if (!n) continue;
    const seg = el("span", { className: `seg-${t}`, title: `${state.trust[t]?.label}: ${n}` });
    seg.style.width = `${(100 * n) / total}%`;
    bar.append(seg);
    rows.append(el("li", {}, tierBadge(t), el("span", { className: "muted", textContent: `${n} · ${Math.round((100 * n) / total)}%` })));
  }
  $("#mix").replaceChildren(bar, rows);

  // Confidence levels + stories
  $("#levels").replaceChildren(...Object.entries(LEVEL_LABEL).map(([k, label]) =>
    el("div", { className: `level level-${k}`, title: ins.level_text[k] },
      el("strong", { textContent: ins.levels[k] || 0 }), el("span", { textContent: label }))));
  const groups = {};
  for (const s of ins.stories) (groups[s.level] ??= []).push(s);
  const nodes = [];
  for (const [level, label] of Object.entries(LEVEL_LABEL)) {
    const list = groups[level];
    if (!list) continue;
    const ul = el("ul", { className: "stories" }, ...list.map((s) => el("li", {},
      el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", className: "title", textContent: s.title }),
      el("div", { className: "meta" },
        el("span", { className: `lvl lvl-${s.level}`, textContent: LEVEL_LABEL[s.level] }),
        tierBadge(s.lead_trust),
        el("span", { textContent: s.lead_source }),
        el("span", { textContent: `${s.n_sources} source${s.n_sources > 1 ? "s" : ""}, ${s.n_articles} article${s.n_articles > 1 ? "s" : ""}` }),
        el("span", { textContent: s.first_seen === s.last_seen ? fmtDay(s.last_seen) : `${fmtDay(s.first_seen)} – ${fmtDay(s.last_seen)}` })))));
    const det = el("details", { open: level !== "unverified" }, el("summary", { textContent: `${label} (${list.length}) — ${ins.level_text[level]}` }), ul);
    nodes.push(det);
  }
  if (!nodes.length) nodes.push(el("p", { className: "muted", textContent: "No stories in the last 14 days." }));
  $("#stories").replaceChildren(...nodes);

  // Regions
  $("#facets").replaceChildren(...ins.facets.map((f) => el("tr", {},
    el("td", { textContent: f.name }), el("td", { textContent: f.count }),
    el("td", { textContent: f.trusted, className: f.trusted ? "strong" : "muted" }),
    el("td", { textContent: f.official, className: f.official ? "strong" : "muted" }),
    el("td", { textContent: ago(f.last_seen), className: "muted" }))));
  if (!ins.facets.length) {
    $("#facets").append(el("tr", {}, el("td", { colSpan: 5, className: "muted",
      textContent: (state.current.facets && Object.keys(state.current.facets).length) ? "No region mentioned recently." : "Add regions in Edit → Regions / facets." })));
  }

  // Figures
  $("#figures").replaceChildren(...ins.figures.map((f) => el("li", {},
    el("div", {}, el("strong", { textContent: `${f.value} ${f.what}` }), " ", tierBadge(f.trust), " ",
      el("a", { href: f.url, target: "_blank", rel: "noopener noreferrer", textContent: f.source }),
      el("span", { className: "muted", textContent: ` · ${fmtDay(f.published_at)}` })),
    el("p", { className: "muted", textContent: f.snippet }))));
  if (!ins.figures.length) $("#figures").append(el("li", { className: "muted", textContent: "No numbers found in trusted reports yet." }));

  // Latest updates: what the tracker found most recently
  const t = state.current;
  const runStart = t.last_run_started;
  $("#latest-sub").textContent = !t.last_run_at ? "waiting for the first update"
    : t.last_run_added ? `${t.last_run_added} new in the last update, ${ago(t.last_run_at)}`
      : `no new articles in the last update, ${ago(t.last_run_at)}`;
  $("#latest").replaceChildren(...(ins.latest || []).map((a) => {
    const li = articleItem(a);
    const meta = li.querySelector(".meta");
    if (t.last_run_added && runStart && a.fetched_at >= runStart && !meta.querySelector(".new")) {
      meta.prepend(el("span", { className: "new", textContent: "NEW" }));
    }
    meta.append(el("span", { className: "found", textContent: `found ${ago(a.fetched_at)}` }));
    return li;
  }));
  if (!(ins.latest || []).length) $("#latest").append(el("li", { className: "muted", textContent: "Nothing collected yet." }));

  // Official updates
  $("#official").replaceChildren(...ins.official_updates.map(articleItem));
  if (!ins.official_updates.length) $("#official").append(el("li", { className: "muted", textContent: "No official reports in the last 14 days." }));
}

// ---- AI situation brief ---------------------------------------------------------------

let analysisTimer;

function cite(ids, cited) {
  const span = el("span", { className: "cites" });
  for (const id of ids || []) {
    const c = cited[String(id)];
    if (!c) continue;
    span.append(el("a", { href: c.url, target: "_blank", rel: "noopener noreferrer", className: `cite tier-${c.trust}`,
      textContent: c.source, title: c.title }));
  }
  return span;
}

async function loadAnalysis() {
  clearTimeout(analysisTimer);
  const a = await ds.analysis(state.current.id);
  const btn = $("#btn-analyze");
  btn.classList.toggle("hidden", !a.available);
  btn.disabled = a.running;
  btn.textContent = a.running ? "Analysing…" : a.latest ? "Update brief" : "Generate brief";
  const body = $("#ai-body");
  if (a.running) analysisTimer = setTimeout(loadAnalysis, 5000);
  if (!a.latest) {
    body.replaceChildren(el("p", { className: "muted", textContent: a.running
      ? "Claude is reading the latest articles…"
      : state.mode === "static"
        ? "No AI brief yet. Add an ANTHROPIC_API_KEY secret to the GitHub repository to generate one on every update."
        : a.available ? "No brief yet — generate one, or wait for the next collection with new articles."
          : "AI briefs are off. Install the 'anthropic' package and set ANTHROPIC_API_KEY to enable them. The trust grouping below works without it." }));
    return;
  }
  const r = a.latest.result;
  const cited = r.cited || {};
  const section = (title, items, render) => items?.length ? el("div", { className: "ai-section" }, el("h4", { textContent: title }), el("ul", {}, ...items.map(render))) : null;
  body.replaceChildren(
    el("div", { className: "ai-head" },
      el("span", { className: `status status-${r.status}`, textContent: STATUS_LABEL[r.status] || r.status }),
      el("span", { className: "muted", textContent: `confidence: ${r.confidence} · ${a.latest.n_articles} articles · ${ago(a.latest.created_at)}` })),
    el("p", { className: "ai-summary", textContent: r.summary }),
    section("Confirmed", r.confirmed_facts, (f) => el("li", {}, f.fact, " ", cite(f.ids, cited))),
    section("Key figures", r.key_figures, (f) => el("li", {}, el("strong", { textContent: `${f.label}: ` }), f.value, " ", cite(f.ids, cited))),
    section("Unverified — treat with caution", r.unverified_claims, (c) => el("li", {}, c.claim, " ",
      el("span", { className: "muted", textContent: `(${c.why})` }), " ", cite(c.ids, cited))),
    section("Watch next", r.watch_next, (w) => el("li", { textContent: w })),
    r.background ? el("details", {}, el("summary", { textContent: "Background" }), el("p", { textContent: r.background })) : null,
    el("p", { className: "muted small", textContent: "Generated by AI from the collected headlines. Follow the source links before relying on it." }),
  );
}

// ---- articles -------------------------------------------------------------------------

function articleItem(a) {
  const keywords = (state.current.match || []).flat();
  const isNew = state.lastSeen && a.fetched_at > state.lastSeen;
  const link = el("a", { className: "title", href: a.url, target: "_blank", rel: "noopener noreferrer" });
  link.append(highlight(a.title, keywords));
  const meta = el("div", { className: "meta" },
    isNew ? el("span", { className: "new", textContent: "NEW" }) : null,
    tierBadge(a.trust || "unknown"),
    el("span", { textContent: a.source }),
    el("span", { textContent: fmtDate(a.published_at), title: `found ${fmtDate(a.fetched_at)}` }),
    a.lang ? el("span", { textContent: a.lang }) : null,
    el("span", { textContent: a.origin.replace("_", " ") }));
  const summary = a.summary ? el("p") : null;
  if (summary) summary.append(highlight(a.summary, keywords));
  return el("li", {}, link, meta, summary);
}

async function loadArticles(reset) {
  if (reset) state.offset = 0;
  const { total, items } = await ds.articles(state.current.id, {
    q: $("#search").value.trim(), lang: $("#lang-filter").value, trust: $("#trust-filter").value,
    limit: PAGE, offset: state.offset,
  });
  const nodes = items.map(articleItem);
  if (reset) $("#articles").replaceChildren(...nodes); else $("#articles").append(...nodes);
  if (reset && !items.length) {
    $("#articles").append(el("li", { className: "muted", textContent:
      state.current.last_run_at ? "No matching articles." : "First collection is running — articles will appear shortly." }));
  }
  state.offset += items.length;
  $("#a-count").textContent = `(${total})`;
  $("#more").classList.toggle("hidden", state.offset >= total);
}

async function loadRuns() {
  const runs = await ds.runs(state.current.id);
  $("#runs").replaceChildren(...runs.map((r) => el("tr", {},
    el("td", { textContent: fmtDate(r.started_at) }),
    el("td", { textContent: r.source }),
    el("td", { textContent: r.fetched ?? "" }),
    el("td", { textContent: r.found }),
    el("td", { textContent: r.added }),
    el("td", { className: r.ok ? "ok" : "err", textContent: r.ok ? "ok" : r.error }))));
}

async function loadTrust() {
  const legend = await ds.trust();
  state.trust = Object.fromEntries(legend.map((t) => [t.tier, t]));
  $("#trust-legend").replaceChildren(...legend.map((t) => el("li", {}, tierBadge(t.tier), el("p", { textContent: t.description }))));
  const sel = $("#trust-filter");
  sel.append(...legend.map((t) => el("option", { value: t.tier, textContent: `${t.label} only` })));
}

// ---- topic form -----------------------------------------------------------------------

const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function openForm(topic) {
  const f = $("#topic-form");
  f.reset();
  $("#form-error").textContent = "";
  $("#dlg-title").textContent = topic ? "Edit topic" : "New topic";
  $("#btn-delete").classList.toggle("hidden", !topic);
  f.dataset.id = topic ? topic.id : "";
  if (topic) {
    f.name.value = topic.name;
    f.description.value = topic.description;
    f.queries.value = topic.queries.map((q) => `${q.lang}: ${q.q}`).join("\n");
    f.who.checked = !!topic.who;
    f.gdelt.value = topic.gdelt.join("\n");
    f.feeds.value = topic.feeds.join("\n");
    f.match.value = topic.match.map((g) => g.join(", ")).join("\n");
    f.exclude.value = topic.exclude.join(", ");
    f.facets.value = Object.entries(topic.facets || {}).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\n");
    f.interval_minutes.value = topic.interval_minutes;
    f.enabled.checked = topic.enabled;
  }
  $("#dlg").showModal();
}

$("#topic-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const body = {
    name: f.name.value,
    description: f.description.value,
    queries: lines(f.queries.value).map((l) => {
      const m = l.match(/^([a-z]{2}):\s*(.+)$/i);
      return m ? { lang: m[1].toLowerCase(), q: m[2] } : { lang: "en", q: l };
    }),
    who: f.who.checked,
    gdelt: lines(f.gdelt.value),
    feeds: lines(f.feeds.value),
    match: lines(f.match.value).map((l) => l.split(",").map((x) => x.trim()).filter(Boolean)),
    exclude: f.exclude.value,
    facets: Object.fromEntries(lines(f.facets.value).map((l) => {
      const i = l.indexOf(":");
      return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).split(",").map((x) => x.trim()).filter(Boolean)] : [l, [l]];
    })),
    interval_minutes: Number(f.interval_minutes.value),
    enabled: f.enabled.checked,
  };
  try {
    const saved = await ds.save(f.dataset.id, body);
    $("#dlg").close();
    state.current = null;
    location.hash = `#${saved.id}`;
    await loadTopics();
  } catch (e) {
    $("#form-error").textContent = e.message;
  }
});

$("#btn-delete").onclick = async () => {
  if (!confirm("Delete this topic and all collected articles?")) return;
  await ds.remove($("#topic-form").dataset.id);
  $("#dlg").close();
  state.current = null;
  history.replaceState(null, "", "#");
  await loadTopics();
};

// ---- wiring ---------------------------------------------------------------------------

$("#btn-new").onclick = () => openForm(null);
$("#btn-edit").onclick = () => openForm(state.current);
$("#btn-cancel").onclick = () => $("#dlg").close();
$("#days").onchange = loadChart;
$("#more").onclick = () => loadArticles(false);
$("#lang-filter").onchange = () => loadArticles(true);
$("#trust-filter").onchange = () => loadArticles(true);
let searchTimer;
$("#search").oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadArticles(true), 250); };
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.current) loadChart(); }, 200);
});

$("#btn-refresh").onclick = async () => {
  $("#btn-refresh").disabled = true;
  try { await ds.refresh(state.current.id); } catch (e) { alert(e.message); }
  $("#s-run").textContent = "collecting…";
  setTimeout(refreshAll, 8000);
};

$("#btn-analyze").onclick = async () => {
  $("#btn-analyze").disabled = true;
  try { await ds.analyze(state.current.id); } catch (e) { alert(e.message); }
  loadAnalysis();
};

// ---- update timer -------------------------------------------------------------------

function fmtCountdown(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mmss = `${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
  return h ? `${h}:${mmss}` : mmss;
}

// When will fresh data appear? Returns { at: Date|null, collecting: bool, lastUpdate: iso }.
function nextUpdate() {
  if (state.mode === "static") {
    const site = staticSource.site();
    const sched = site?.schedule;
    if (!sched) return { at: null, lastUpdate: site?.generated_at };
    // The first scheduled run after the data we have, plus time to run and publish.
    const gen = new Date(site.generated_at);
    const slot = new Date(gen);
    slot.setUTCSeconds(0, 0);
    for (let i = 0; i < 24 * 60; i++) {
      slot.setUTCMinutes(slot.getUTCMinutes() + 1);
      if (sched.minutes.includes(slot.getUTCMinutes())) break;
    }
    return { at: new Date(slot.getTime() + sched.publish_delay_minutes * 60_000), lastUpdate: site.generated_at };
  }
  const t = state.current;
  if (!t) return { at: null };
  if (t.collecting) return { at: null, collecting: true, lastUpdate: t.last_run_at };
  if (!t.enabled) return { at: null, disabled: true, lastUpdate: t.last_run_at };
  const at = t.last_run_at ? new Date(new Date(t.last_run_at).getTime() + t.interval_minutes * 60_000) : new Date();
  return { at, lastUpdate: t.last_run_at };
}

let lastDueCheck = 0;

function tick() {
  const n = nextUpdate();
  $("#updated").textContent = n.lastUpdate ? `Updated ${ago(n.lastUpdate)}` : "";
  const next = $("#next-update");
  const pulse = el("span", { className: "pulse" });
  next.classList.remove("due");
  if (n.collecting) {
    next.replaceChildren(pulse, "Updating now…");
    next.classList.add("due");
  } else if (n.disabled) {
    next.replaceChildren("Updates paused");
  } else if (!n.at) {
    next.replaceChildren();
  } else {
    const left = n.at.getTime() - Date.now();
    if (left > 0) {
      next.replaceChildren(pulse, `Next update in ${fmtCountdown(left)}`);
      next.title = `Expected around ${n.at.toLocaleTimeString()}`;
    } else {
      // Due: the scheduler can run a few minutes late, so keep checking for new data.
      next.replaceChildren(pulse, state.mode === "static" && left < -15 * 60_000 ? "Update running late…" : "Updating…");
      next.classList.add("due");
    }
  }
  const due = n.collecting || (n.at && n.at.getTime() <= Date.now());
  if (due && Date.now() - lastDueCheck > (state.mode === "static" ? 60_000 : 15_000)) {
    lastDueCheck = Date.now();
    checkForNewData();
  }
}

async function checkForNewData() {
  try {
    if (state.mode === "static") {
      if (await staticSource.hasNewData()) await refreshAll();
    } else {
      await refreshAll();
    }
  } catch (e) {
    console.error(e);
  }
}

async function refreshAll() {
  try {
    if (state.mode === "static") await staticSource.reset();
    await loadTopics();
    if (state.current) await loadTopicData();
  } catch (e) {
    console.error(e);
  }
}

(async () => {
  try {
    await detectMode();
    await loadTrust();
    await loadTopics();
  } catch (e) {
    $("#main").prepend(el("div", { className: "alert", textContent: `Cannot load tracker data: ${e.message}` }));
  }
  tick();
  setInterval(tick, 1000);
  if (state.mode === "api") setInterval(() => { if (!document.hidden) refreshAll(); }, POLL_MS);
})();
