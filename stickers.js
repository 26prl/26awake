"use strict";
// GIF stickers placed around the dashboard, listed in static/stickers.json:
//   { "stickers": [ { "slot": "sidebar", "src": "gifs/marmot.gif", "alt": "…", "captions": ["…"], "size": "md" } ] }
// Slots: header, sidebar, latest, trust, map, official, articles, footer. Sizes: xs, sm, md (default). Click a sticker for its next caption.
// With no stickers.json (or an empty list) nothing is shown.

(() => {
  const KEY = "stickers-off";
  const prefs = {
    get() { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } },
    set(v) { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ } },
  };

  function sticker(def) {
    if (!def.src) return null;
    const box = document.createElement("figure");
    box.className = `sticker sticker-${def.size || "md"}`;
    const img = document.createElement("img");
    img.src = def.src;
    img.alt = def.alt || "";
    img.loading = "lazy";
    img.decoding = "async";
    box.append(img);
    const captions = (def.captions || []).filter(Boolean);
    if (!captions.length) return box;
    let i = Math.floor(Math.random() * captions.length);
    const bubble = document.createElement("figcaption");
    bubble.className = "sticker-bubble";
    bubble.textContent = captions[i];
    box.append(bubble);
    if (captions.length > 1) {
      box.tabIndex = 0;
      box.setAttribute("role", "button");
      box.setAttribute("aria-label", `${def.alt || "Sticker"} — show the next caption`);
      const next = () => {
        i = (i + 1) % captions.length;
        bubble.textContent = captions[i];
        box.classList.remove("pop");
        void box.offsetWidth; // restart the pop animation
        box.classList.add("pop");
      };
      box.addEventListener("click", next);
      box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); next(); } });
    }
    return box;
  }

  async function load() {
    try {
      const res = await fetch("stickers.json", { cache: "no-cache" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.stickers) ? data.stickers : [];
    } catch {
      return [];
    }
  }

  function apply(off) {
    document.body.classList.toggle("no-stickers", off);
    const btn = document.getElementById("sticker-toggle");
    if (btn) {
      btn.textContent = off ? "Show stickers" : "Hide stickers";
      btn.setAttribute("aria-pressed", String(!off));
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const btn = document.getElementById("sticker-toggle");
    let shown = 0;
    for (const def of await load()) {
      const slot = document.querySelector(`[data-sticker-slot="${def.slot}"]`);
      const node = slot && sticker(def);
      if (node) { slot.append(node); shown++; }
    }
    if (!btn) return;
    btn.hidden = shown === 0;
    apply(prefs.get());
    btn.addEventListener("click", () => {
      const off = !document.body.classList.contains("no-stickers");
      prefs.set(off);
      apply(off);
    });
  });
})();
