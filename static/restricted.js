"use strict";
// "restricted" page: password, then a chat with your own model in Ollama on this computer (the browser talks to
// Ollama directly: messages never leave the computer), following the rules written here (saved on the server,
// behind the password). If an online model is set up on the server, it can be picked instead.
// Chats and the model settings stay in this browser (localStorage).

(() => {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  let token = store.get("agent-token", null);
  let chat = store.get("agent-chat", []); // [{role, content}]
  let sending = false, serverModel = null;
  const cfg = Object.assign({ source: "ollama", url: "http://localhost:11434", model: "" }, store.get("agent-cfg", {}));
  const saveCfg = () => store.set("agent-cfg", cfg);

  const auth = () => ({ Authorization: `Bearer ${token}` });
  function show(view) {
    for (const v of ["r-off", "r-lock", "r-room"]) $(v).hidden = v !== view;
    dispatchEvent(new Event("relayout"));
  }
  function logout() { token = null; store.set("agent-token", null); show("r-lock"); }

  // ---- lock ----------------------------------------------------------------------------

  $("r-login").onsubmit = async (e) => {
    e.preventDefault();
    $("r-lock-msg").textContent = "…";
    try {
      const r = await fetch("api/agent", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", password: $("r-pass").value }) });
      const d = await r.json();
      if (!r.ok || !d.token) { $("r-lock-msg").textContent = d.error || "Couldn't log in."; return; }
      token = d.token; store.set("agent-token", token);
      $("r-pass").value = ""; $("r-lock-msg").textContent = "";
      open();
    } catch {
      $("r-lock-msg").textContent = "Couldn't reach the server.";
    }
  };

  // ---- room ----------------------------------------------------------------------------

  async function open() {
    let d;
    try {
      const r = await fetch("api/agent", { headers: auth(), cache: "no-store" });
      if (!(r.headers.get("content-type") || "").includes("json")) { show("r-off"); return; }
      d = await r.json();
      if (d.configured === false) { show("r-off"); return; }
      if (r.status === 401) { logout(); return; }
    } catch { show("r-off"); return; }
    $("r-rules").value = d.rules || "";
    serverModel = d.server ? d.model : null;
    if (!serverModel) cfg.source = "ollama";
    setupModels();
    $("r-rules-note").textContent = d.saved ? "" : "No database connected: rules can't be saved.";
    show("r-room");
    draw();
  }

  $("r-save").onclick = async () => {
    $("r-rules-note").textContent = "saving…";
    const r = await fetch("api/agent", { method: "POST", headers: { "Content-Type": "application/json", ...auth() },
      body: JSON.stringify({ action: "rules", rules: $("r-rules").value }) }).catch(() => null);
    if (r?.status === 401) return logout();
    const d = r ? await r.json().catch(() => ({})) : {};
    $("r-rules-note").textContent = r?.ok ? "saved" : d.error || "couldn't save";
  };

  // ---- model: Ollama on this computer (default) or the server's online model ----------

  async function listOllama() {
    const sel = $("r-ollama-model"), note = $("r-ollama-note");
    note.textContent = "looking for Ollama…";
    try {
      const r = await fetch(`${cfg.url.replace(/\/+$/, "")}/api/tags`, { cache: "no-store" });
      const names = ((await r.json()).models || []).map((m) => m.name);
      sel.replaceChildren(...names.map((n) => Object.assign(document.createElement("option"), { value: n, textContent: n })));
      if (!names.length) { note.textContent = "Ollama is running but has no models yet: run  ollama pull <model>  first."; return; }
      if (!names.includes(cfg.model)) cfg.model = names[0];
      sel.value = cfg.model; saveCfg();
      note.textContent = `connected · ${names.length} model${names.length > 1 ? "s" : ""}`;
    } catch {
      sel.replaceChildren();
      note.textContent = `Can't reach Ollama on this computer. Make sure it's running and was started with OLLAMA_ORIGINS=${location.origin} — and if the browser asks to access your local network, allow it.`;
    }
    $("r-model").textContent = cfg.source === "server" ? serverModel : cfg.model || "none";
  }

  function setupModels() {
    $("r-source-server").hidden = !serverModel;
    $("r-source-server-label").textContent = serverModel ? `online: ${serverModel}` : "";
    for (const r of document.querySelectorAll('input[name="r-source"]')) r.checked = r.value === cfg.source;
    $("r-ollama").hidden = cfg.source !== "ollama";
    $("r-ollama-url").value = cfg.url;
    $("r-model").textContent = cfg.source === "server" ? serverModel : cfg.model || "none";
    if (cfg.source === "ollama") listOllama();
  }
  document.querySelectorAll('input[name="r-source"]').forEach((r) => {
    r.onchange = () => { cfg.source = r.value; saveCfg(); setupModels(); };
  });
  $("r-ollama-model").onchange = (e) => { cfg.model = e.target.value; saveCfg(); $("r-model").textContent = cfg.model; };
  $("r-ollama-url").onchange = (e) => { cfg.url = e.target.value.trim() || "http://localhost:11434"; saveCfg(); listOllama(); };
  $("r-ollama-refresh").onclick = listOllama;

  function bubble(m) {
    const div = document.createElement("div");
    div.className = `msg ${m.role}`;
    div.textContent = m.content;
    return div;
  }
  function draw() {
    const log = $("r-log");
    log.replaceChildren(...chat.map(bubble));
    if (!chat.length) log.append(Object.assign(document.createElement("p"), { className: "muted small", textContent: "Nothing here yet." }));
    log.scrollTop = log.scrollHeight;
  }

  async function sendMessage() {
    const text = $("r-input").value.trim();
    if (!text || sending) return;
    sending = true; $("r-send").disabled = true;
    chat.push({ role: "user", content: text });
    $("r-input").value = "";
    const reply = { role: "assistant", content: "" };
    chat.push(reply);
    draw();
    const live = $("r-log").lastElementChild;
    try {
      let r;
      if (cfg.source === "ollama") {
        if (!cfg.model) throw new Error("Pick a model first (my rules & model → model).");
        // straight to Ollama on this computer (its OpenAI-compatible endpoint)
        const rules = $("r-rules").value.trim();
        r = await fetch(`${cfg.url.replace(/\/+$/, "")}/v1/chat/completions`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: cfg.model, stream: true,
            messages: [...(rules ? [{ role: "system", content: rules }] : []), ...chat.slice(0, -1).slice(-40)] }),
        }).catch(() => { throw new Error("Can't reach Ollama on this computer."); });
      } else {
        r = await fetch("api/agent", { method: "POST", headers: { "Content-Type": "application/json", ...auth() },
          body: JSON.stringify({ action: "chat", messages: chat.slice(0, -1) }) });
        if (r.status === 401) { chat.splice(-2); logout(); return; }
      }
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error || `error ${r.status}`);
      // OpenAI-style stream: lines "data: {json}" with choices[0].delta.content, ending with "data: [DONE]"
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          const m = line.match(/^data:\s*(.*)$/);
          if (!m || m[1] === "[DONE]") continue;
          try {
            const delta = JSON.parse(m[1]).choices?.[0]?.delta?.content;
            if (delta) { reply.content += delta; live.textContent = reply.content; $("r-log").scrollTop = $("r-log").scrollHeight; }
          } catch { /* keep-alive or partial line */ }
        }
      }
      if (!reply.content) reply.content = "(no answer)";
    } catch (e) {
      reply.content = `⚠ ${e.message}`;
    }
    live.textContent = reply.content;
    store.set("agent-chat", chat);
    sending = false; $("r-send").disabled = false;
    $("r-input").focus();
  }

  $("r-send").onclick = sendMessage;
  $("r-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  $("r-clear").onclick = () => { if (!chat.length || confirm("Clear this chat?")) { chat = []; store.set("agent-chat", chat); draw(); } };
  $("r-logout").onclick = logout;

  if (token) open(); else show("r-lock");
})();
