"use strict";
// Anime-style stickers placed around the dashboard. Original drawings (inline SVG + CSS animation),
// so they work offline and carry no copyright baggage. Click a sticker for its next line.
//
// To use your own GIFs instead, put them in static/gifs/ and list them in static/stickers.json:
//   { "stickers": [ { "slot": "sidebar", "src": "gifs/marmot.gif", "alt": "…", "captions": ["…"] } ] }
// Slots: header, sidebar, latest, map, footer.

(() => {
  const ART = {
    // Chibi plague doctor: wide hat, beak mask, sparkly eyes, sweat drop.
    "plague-chan": `
<svg viewBox="0 0 120 140" class="stk-svg" aria-hidden="true">
  <g class="stk-bob">
    <path d="M30 92 L90 92 L100 136 L20 136 Z" fill="#2b2235"/>
    <path d="M52 92 L60 112 L68 92 Z" fill="#4a3d5c"/>
    <circle cx="60" cy="60" r="30" fill="#ffe3d3"/>
    <path d="M31 56 Q34 30 60 30 Q86 30 89 56 Q80 44 70 46 Q64 38 56 46 Q44 42 31 56 Z" fill="#5b3a8c"/>
    <ellipse cx="60" cy="33" rx="46" ry="9" fill="#2b2235"/>
    <path d="M38 33 Q38 6 60 6 Q82 6 82 33 Z" fill="#2b2235"/>
    <rect x="38" y="25" width="44" height="6" fill="#b42318"/>
    <ellipse cx="47" cy="60" rx="7.5" ry="9.5" fill="#3b1f5c"/>
    <ellipse cx="73" cy="60" rx="7.5" ry="9.5" fill="#3b1f5c"/>
    <circle cx="44.5" cy="56.5" r="3" fill="#fff"/><circle cx="70.5" cy="56.5" r="3" fill="#fff"/>
    <circle cx="49.5" cy="64" r="1.4" fill="#fff"/><circle cx="75.5" cy="64" r="1.4" fill="#fff"/>
    <ellipse cx="38" cy="72" rx="6" ry="3" fill="#ff8fa3" opacity=".6"/>
    <ellipse cx="82" cy="72" rx="6" ry="3" fill="#ff8fa3" opacity=".6"/>
    <path d="M51 69 Q60 66 69 69 L60 98 Z" fill="#f3ead7" stroke="#b9a98a" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="57" cy="74" r="1.2" fill="#8a7a5c"/><circle cx="63" cy="74" r="1.2" fill="#8a7a5c"/>
    <path class="stk-drop" d="M93 44 Q97 52 93 55 Q89 52 93 44 Z" fill="#7cc6f5"/>
  </g>
</svg>`,

    // Tarbagan marmot (the real plague reservoir in Altai/Tuva/Mongolia), panicking with a sign.
    "marmot": `
<svg viewBox="0 0 120 140" class="stk-svg" aria-hidden="true">
  <g class="stk-shake">
    <ellipse cx="60" cy="96" rx="36" ry="38" fill="#b58552"/>
    <ellipse cx="60" cy="102" rx="24" ry="27" fill="#ebcb9e"/>
    <circle cx="38" cy="32" r="7" fill="#9a6d40"/><circle cx="82" cy="32" r="7" fill="#9a6d40"/>
    <circle cx="38" cy="32" r="3.5" fill="#e8a6a0"/><circle cx="82" cy="32" r="3.5" fill="#e8a6a0"/>
    <circle cx="60" cy="52" r="28" fill="#b58552"/>
    <ellipse cx="60" cy="62" rx="15" ry="11" fill="#ebcb9e"/>
    <path d="M42 46 L51 51 L42 56" fill="none" stroke="#2b1d12" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M78 46 L69 51 L78 56" fill="none" stroke="#2b1d12" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    <ellipse cx="40" cy="63" rx="5" ry="2.6" fill="#ff8fa3" opacity=".65"/>
    <ellipse cx="80" cy="63" rx="5" ry="2.6" fill="#ff8fa3" opacity=".65"/>
    <ellipse cx="60" cy="58" rx="3.5" ry="2.5" fill="#4a2f1a"/>
    <path d="M54 63 Q60 70 66 63" fill="#7a2e2e"/>
    <rect x="56.5" y="63" width="3" height="4" fill="#fff"/><rect x="60.5" y="63" width="3" height="4" fill="#fff"/>
    <path class="stk-drop" d="M89 36 Q93 44 89 47 Q85 44 89 36 Z" fill="#7cc6f5"/>
    <rect x="22" y="86" width="76" height="30" rx="4" fill="#fff" stroke="#2b1d12" stroke-width="2" transform="rotate(-4 60 101)"/>
    <text x="60" y="106" text-anchor="middle" font-size="13" font-weight="800" fill="#b42318" font-family="system-ui, sans-serif" transform="rotate(-4 60 101)">NOT ME!!</text>
    <ellipse cx="26" cy="99" rx="6" ry="5" fill="#9a6d40"/><ellipse cx="94" cy="99" rx="6" ry="5" fill="#9a6d40"/>
  </g>
</svg>`,

    // A determined flea with sparkly eyes, hopping.
    "flea": `
<svg viewBox="0 0 120 120" class="stk-svg" aria-hidden="true">
  <g class="stk-hop">
    <path d="M40 78 L28 100 M52 82 L46 104 M68 82 L74 104 M80 78 L94 100" stroke="#5a2a1a" stroke-width="4" stroke-linecap="round" fill="none"/>
    <path d="M84 70 Q104 58 106 80" stroke="#5a2a1a" stroke-width="4" stroke-linecap="round" fill="none"/>
    <ellipse cx="60" cy="64" rx="32" ry="24" fill="#8a3b22"/>
    <path d="M36 56 Q60 44 84 56" stroke="#a9563a" stroke-width="3" fill="none"/>
    <path d="M38 66 Q60 56 82 66" stroke="#a9563a" stroke-width="3" fill="none"/>
    <circle cx="44" cy="44" r="16" fill="#8a3b22"/>
    <rect x="29" y="30" width="30" height="6" rx="2" fill="#fff"/>
    <circle cx="58" cy="33" r="3" fill="#b42318"/>
    <ellipse cx="38" cy="45" rx="5" ry="6.5" fill="#1d0f0a"/><ellipse cx="50" cy="45" rx="5" ry="6.5" fill="#1d0f0a"/>
    <circle cx="36.5" cy="42.5" r="2" fill="#fff"/><circle cx="48.5" cy="42.5" r="2" fill="#fff"/>
    <path d="M37 54 Q44 58 51 54" stroke="#1d0f0a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <path class="stk-spark" d="M96 26 L99 34 L107 37 L99 40 L96 48 L93 40 L85 37 L93 34 Z" fill="#ffd166"/>
  </g>
</svg>`,

    // Yersinia pestis as a scared rod-shaped bacterium, chased by an antibiotic capsule.
    "pestis": `
<svg viewBox="0 0 160 110" class="stk-svg" aria-hidden="true">
  <g class="stk-run">
    <rect x="12" y="34" width="78" height="40" rx="20" fill="#9bd36a" stroke="#4e8a2b" stroke-width="3"/>
    <circle cx="28" cy="46" r="3" fill="#6fae44"/><circle cx="74" cy="64" r="3" fill="#6fae44"/><circle cx="56" cy="44" r="2.2" fill="#6fae44"/>
    <ellipse cx="38" cy="54" rx="6" ry="7.5" fill="#1f2d14"/><ellipse cx="58" cy="54" rx="6" ry="7.5" fill="#1f2d14"/>
    <circle cx="36" cy="51" r="2.3" fill="#fff"/><circle cx="56" cy="51" r="2.3" fill="#fff"/>
    <path d="M30 44 L44 47 M66 44 L52 47" stroke="#1f2d14" stroke-width="2.5" stroke-linecap="round"/>
    <ellipse cx="48" cy="67" rx="6" ry="4" fill="#1f2d14"/>
    <path class="stk-drop" d="M86 22 Q90 30 86 33 Q82 30 86 22 Z" fill="#7cc6f5"/>
    <path d="M8 40 L0 36 M8 54 L-2 54 M8 68 L0 72" stroke="#4e8a2b" stroke-width="2.5" stroke-linecap="round"/>
  </g>
  <g class="stk-chase">
    <g transform="rotate(-25 128 58)">
      <rect x="104" y="44" width="48" height="26" rx="13" fill="#fff" stroke="#8a2a20" stroke-width="2.5"/>
      <path d="M104 57 A13 13 0 0 1 117 44 L128 44 L128 70 L117 70 A13 13 0 0 1 104 57 Z" fill="#e0453a"/>
    </g>
    <path d="M150 84 L156 78 M152 92 L160 90" stroke="#8a2a20" stroke-width="2" stroke-linecap="round"/>
  </g>
</svg>`,
  };

  const DEFAULTS = [
    { slot: "header", art: "plague-chan", size: "xs", captions: [
      "Konnichiwa! Only trust verified sources~ ✨",
      "Ara ara… another headline?",
      "Wash your hands, nya~!",
    ] },
    { slot: "sidebar", art: "marmot", captions: [
      "It wasn't me!! (probably…)",
      "Tarbagan marmots carry plague in Altai, Tuva and Mongolia — please don't hunt or eat us! 🥺",
      "*nervous marmot noises*",
    ] },
    { slot: "latest", art: "flea", size: "sm", captions: [
      "Notice me, senpai… I'm the real villain!",
      "Fleas spread bubonic plague. Use repellent in the steppe! 🦟",
      "Hop hop! New headlines incoming!",
    ] },
    { slot: "map", art: "pestis", captions: [
      "Y. pestis-chan here… NOOO, not the antibiotics!! 💊",
      "Plague is treatable with antibiotics if caught early.",
      "Fever after a flea bite or contact with a marmot? See a doctor, baka!",
    ] },
    { slot: "footer", art: "plague-chan", captions: [
      "Stay safe and check the sources, ne~ 💜",
      "Mata ne! The tracker keeps watching for you.",
    ] },
  ];

  const KEY = "stickers-off";
  const prefs = {
    get() { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } },
    set(v) { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* private mode */ } },
  };

  function sticker(def) {
    const box = document.createElement("figure");
    box.className = `sticker sticker-${def.size || "md"}`;
    box.tabIndex = 0;
    box.setAttribute("role", "button");
    box.setAttribute("aria-label", "Anime sticker — click for the next line");
    if (def.src) {
      const img = document.createElement("img");
      img.src = def.src;
      img.alt = def.alt || "";
      img.loading = "lazy";
      box.append(img);
    } else if (ART[def.art]) {
      box.insertAdjacentHTML("beforeend", ART[def.art]); // our own constant markup, not data
    } else {
      return null;
    }
    const captions = def.captions?.length ? def.captions : [""];
    let i = Math.floor(Math.random() * captions.length);
    const bubble = document.createElement("figcaption");
    bubble.className = "sticker-bubble";
    bubble.textContent = captions[i];
    if (captions[i]) box.append(bubble);
    const next = () => {
      i = (i + 1) % captions.length;
      bubble.textContent = captions[i];
      box.classList.remove("pop");
      void box.offsetWidth; // restart the pop animation
      box.classList.add("pop");
    };
    box.addEventListener("click", next);
    box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); next(); } });
    return box;
  }

  function render(defs) {
    for (const slot of document.querySelectorAll("[data-sticker-slot]")) slot.replaceChildren();
    for (const def of defs) {
      const slot = document.querySelector(`[data-sticker-slot="${def.slot}"]`);
      const node = slot && sticker(def);
      if (node) slot.append(node);
    }
  }

  async function load() {
    try {
      const res = await fetch("stickers.json", { cache: "no-cache" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.stickers) && data.stickers.length) return data.stickers;
      }
    } catch { /* fall back to the built-in stickers */ }
    return DEFAULTS;
  }

  function apply(off) {
    document.body.classList.toggle("no-stickers", off);
    const btn = document.getElementById("sticker-toggle");
    if (btn) {
      btn.textContent = off ? "Show anime stickers" : "Hide anime stickers";
      btn.setAttribute("aria-pressed", String(!off));
    }
  }

  document.addEventListener("DOMContentLoaded", async () => {
    apply(prefs.get());
    document.getElementById("sticker-toggle")?.addEventListener("click", () => {
      const off = !document.body.classList.contains("no-stickers");
      prefs.set(off);
      apply(off);
    });
    render(await load());
  });
})();
