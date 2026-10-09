"use strict";
// "restricted" page: password, then a chat with the model configured in api/agent.js, following the rules
// written here (saved on the server). Chats stay in this browser (localStorage).

(() => {
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  let token = store.get("agent-token", null);
  let chat = store.get("agent-chat", []); // [{role, content}]
  let sending = false;

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
    $("r-model").textContent = d.model || "";
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
      const r = await fetch("api/agent", { method: "POST", headers: { "Content-Type": "application/json", ...auth() },
        body: JSON.stringify({ action: "chat", messages: chat.slice(0, -1) }) });
      if (r.status === 401) { chat.splice(-2); logout(); return; }
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
