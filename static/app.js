"use strict";

const $ = (sel) => document.querySelector(sel);
const POLL_MS = 60_000;
const PAGE = 50;

const state = { topics: [], current: null, offset: 0, lastSeen: null };

// ---- helpers --------------------------------------------------------------------------

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = store.get("tracker-token");
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { ...opts, headers });
  if (res.status === 401) {
    const t = prompt("This tracker is write-protected. Enter the access token:");
    if (t) { store.set("tracker-token", t); return api(path, opts); }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) if (c != null) node.append(c);
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

// ---- topics sidebar -------------------------------------------------------------------

async function loadTopics() {
  state.topics = await api("/topics");
  const list = $("#topic-list");
  list.replaceChildren(...state.topics.map((t) => {
    const badge = el("span", { className: `badge${t.stats.spike ? " hot" : ""}`, textContent: `${t.stats.last24h} / 24h` });
    const li = el("li", { title: t.description || t.name }, el("span", { textContent: t.name }), badge);
    if (state.current && t.id === state.current.id) li.classList.add("active");
    li.onclick = () => selectTopic(t.id);
    return li;
  }));
  $("#empty").classList.toggle("hidden", state.topics.length > 0);
  $("#topic").classList.toggle("hidden", state.topics.length === 0);
  if (!state.topics.length) return;

  const wanted = state.current?.id ?? Number(location.hash.slice(1)) ?? null;
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
  await Promise.all([loadChart(), loadBreakdown(), loadArticles(true), loadRuns()]);
}

function renderHeader() {
  const t = state.current;
  $("#t-name").textContent = t.name;
  $("#t-desc").textContent = t.description || "";
  $("#s-24h").textContent = t.stats.last24h;
  $("#s-avg").textContent = t.stats.daily_avg_prev7d;
  $("#s-total").textContent = t.stats.total;
  $("#s-run").textContent = t.collecting ? "collecting…" : ago(t.last_run_at);
  $("#btn-refresh").disabled = t.collecting;
  const alert = $("#alert");
  alert.classList.toggle("hidden", !t.stats.spike);
  alert.textContent = t.stats.spike
    ? `⚠ Coverage spike: ${t.stats.last24h} articles in the last 24 h vs. ${t.stats.daily_avg_prev7d}/day the week before.`
    : "";
}

// ---- chart ----------------------------------------------------------------------------

async function loadChart() {
  const days = $("#days").value;
  const data = await api(`/topics/${state.current.id}/timeline?days=${days}`);
  const W = Math.max(280, $("#chart").clientWidth || 640), H = 220, pad = { l: 28, r: 4, t: 8, b: 22 };
  const max = Math.max(1, ...data.map((d) => d.count));
  const bw = (W - pad.l - pad.r) / data.length;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const add = (name, attrs, text) => {
    const n = document.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (text != null) n.textContent = text;
    svg.append(n);
    return n;
  };
  const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  for (const v of [0, Math.ceil(max / 2), max]) {
    add("line", { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) });
    add("text", { x: pad.l - 5, y: y(v) + 3, "text-anchor": "end" }, v);
  }
  const labelEvery = Math.ceil(data.length / Math.max(3, Math.floor(W / 80)));
  data.forEach((d, i) => {
    const x = pad.l + i * bw;
    const r = add("rect", { class: "bar", x: x + bw * 0.12, width: bw * 0.76, y: y(d.count), height: Math.max(0, y(0) - y(d.count)), rx: 2 });
    r.append(Object.assign(document.createElementNS(ns, "title"), { textContent: `${d.day}: ${d.count}` }));
    if (i % labelEvery === 0) add("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle" }, d.day.slice(5));
  });
  $("#chart").replaceChildren(svg);
}

async function loadBreakdown() {
  const { sources, languages } = await api(`/topics/${state.current.id}/breakdown`);
  const max = Math.max(1, ...sources.map((s) => s.count));
  $("#sources").replaceChildren(...sources.map((s) => {
    const li = el("li", {}, el("span", { textContent: s.source }), el("span", { className: "muted", textContent: s.count }));
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

// ---- articles -------------------------------------------------------------------------

async function loadArticles(reset) {
  if (reset) state.offset = 0;
  const q = encodeURIComponent($("#search").value.trim());
  const lang = encodeURIComponent($("#lang-filter").value);
  const { total, items } = await api(
    `/topics/${state.current.id}/articles?limit=${PAGE}&offset=${state.offset}&q=${q}&lang=${lang}`);
  const keywords = state.current.match.flat();
  const nodes = items.map((a) => {
    const isNew = state.lastSeen && a.fetched_at > state.lastSeen;
    const link = el("a", { className: "title", href: a.url, target: "_blank", rel: "noopener noreferrer" });
    link.append(highlight(a.title, keywords));
    const meta = el("div", { className: "meta" },
      isNew ? el("span", { className: "new", textContent: "NEW" }) : null,
      el("span", { textContent: a.source }),
      el("span", { textContent: fmtDate(a.published_at), title: `found ${fmtDate(a.fetched_at)}` }),
      a.lang ? el("span", { textContent: a.lang }) : null,
      el("span", { textContent: a.origin.replace("_", " ") }));
    const summary = a.summary ? el("p") : null;
    if (summary) summary.append(highlight(a.summary, keywords));
    return el("li", {}, link, meta, summary);
  });
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
  const runs = await api(`/topics/${state.current.id}/runs`);
  $("#runs").replaceChildren(...runs.map((r) => el("tr", {},
    el("td", { textContent: fmtDate(r.started_at) }),
    el("td", { textContent: r.source }),
    el("td", { textContent: r.found }),
    el("td", { textContent: r.added }),
    el("td", { className: r.ok ? "ok" : "err", textContent: r.ok ? "ok" : r.error }))));
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
    f.gdelt.value = topic.gdelt.join("\n");
    f.feeds.value = topic.feeds.join("\n");
    f.match.value = topic.match.map((g) => g.join(", ")).join("\n");
    f.exclude.value = topic.exclude.join(", ");
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
    gdelt: lines(f.gdelt.value),
    feeds: lines(f.feeds.value),
    match: lines(f.match.value).map((l) => l.split(",").map((x) => x.trim()).filter(Boolean)),
    exclude: f.exclude.value,
    interval_minutes: Number(f.interval_minutes.value),
    enabled: f.enabled.checked,
  };
  try {
    const id = f.dataset.id;
    const saved = await api(id ? `/topics/${id}` : "/topics", { method: id ? "PUT" : "POST", body: JSON.stringify(body) });
    $("#dlg").close();
    state.current = null;
    location.hash = `#${saved.id}`;
    await loadTopics();
    await selectTopic(saved.id);
  } catch (e) {
    $("#form-error").textContent = e.message;
  }
});

$("#btn-delete").onclick = async () => {
  const id = $("#topic-form").dataset.id;
  if (!confirm("Delete this topic and all collected articles?")) return;
  await api(`/topics/${id}`, { method: "DELETE" });
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
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if (state.current) loadChart(); }, 200);
});
$("#more").onclick = () => loadArticles(false);
$("#lang-filter").onchange = () => loadArticles(true);
let searchTimer;
$("#search").oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadArticles(true), 250); };

$("#btn-refresh").onclick = async () => {
  $("#btn-refresh").disabled = true;
  try { await api(`/topics/${state.current.id}/refresh`, { method: "POST" }); } catch (e) { alert(e.message); }
  $("#s-run").textContent = "collecting…";
  setTimeout(refreshAll, 8000);
};

async function refreshAll() {
  try {
    await loadTopics();
    if (state.current) await Promise.all([loadChart(), loadBreakdown(), loadArticles(true), loadRuns()]);
  } catch (e) {
    console.error(e);
  }
}

setInterval(() => { $("#clock").textContent = new Date().toLocaleTimeString(); }, 1000);
setInterval(() => { if (!document.hidden) refreshAll(); }, POLL_MS);
loadTopics().catch((e) => { $("#main").prepend(el("div", { className: "alert", textContent: `Cannot reach the tracker API: ${e.message}` })); });
