"use strict";
// "nothing" page: coffee link, contacts and a BTC address with its QR code, all from nothing.json:
// {"coffee": {"url": "...", "label": "buy me a coffee"},
//  "contacts": [{"label": "telegram", "value": "@name", "url": "https://t.me/name"}],
//  "btc": {"address": "bc1...", "qr": "btc-qr.svg"}}

(() => {
  const box = document.getElementById("nothing");
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    for (const k of kids) if (k != null && k !== false) n.append(k);
    return n;
  };
  const safe = (url) => /^(https?:|mailto:|tg:)/i.test(url || "") ? url : null; // only real links

  function copyButton(text) {
    const b = el("button", { type: "button", className: "g8-reset", textContent: "copy" });
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = "copied"; } catch { b.textContent = "select and copy it"; }
    };
    return b;
  }

  fetch("nothing.json", { cache: "no-cache" }).then((r) => r.json()).then((d) => {
    const parts = [];
    if (d.coffee?.url && safe(d.coffee.url)) {
      parts.push(el("section", {}, el("a", { className: "coffee", href: d.coffee.url, target: "_blank", rel: "noopener",
        textContent: d.coffee.label || "buy me a coffee" })));
    }
    const contacts = (d.contacts || []).filter((c) => c.value || c.url);
    if (contacts.length) {
      parts.push(el("section", {}, el("h2", { textContent: "contact" }),
        el("ul", { className: "contacts" }, ...contacts.map((c) => el("li", {},
          c.label ? el("span", { className: "muted", textContent: `${c.label} ` }) : null,
          safe(c.url) ? el("a", { href: c.url, target: "_blank", rel: "noopener", textContent: c.value || c.url }) : el("span", { textContent: c.value }))))));
    }
    if (d.btc?.address) {
      parts.push(el("section", { className: "btc" }, el("h2", { textContent: "bitcoin" }),
        d.btc.qr ? el("img", { src: d.btc.qr, alt: "Bitcoin address QR code", width: 220, height: 220 }) : null,
        el("p", {}, el("code", { textContent: d.btc.address }), " ", copyButton(d.btc.address))));
    }
    box.replaceChildren(...(parts.length ? parts : [el("p", { className: "muted", textContent: "there's nothing here. yet." })]));
    dispatchEvent(new Event("relayout"));
  }).catch(() => box.replaceChildren(el("p", { className: "muted", textContent: "there's nothing here." })));
})();
