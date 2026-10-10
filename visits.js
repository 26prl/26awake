"use strict";
// Counts this browser once a day for the "people here today" line on the home page (api/visits.js), and logs the
// page view (page + where the visitor came from) for the owner's traffic page.
// The id is random and anonymous; it isn't linked to the game player number.
// A page with an element #visits shows the counts there.

(() => {
  let id = null;
  try {
    id = localStorage.getItem("visitor");
    if (!/^[a-f0-9]{32}$/.test(id || "")) {
      id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("visitor", id);
    }
  } catch { /* private mode: count without remembering */ }
  if (!id) id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

  fetch("api/visits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: id, p: location.pathname, r: document.referrer }), cache: "no-store" })
    .then((r) => ((r.headers.get("content-type") || "").includes("json") ? r.json() : null))
    .then((d) => {
      const box = document.getElementById("visits");
      if (!box || !d || !d.configured) return;
      const n = (x) => Number(x || 0).toLocaleString();
      box.textContent = `${n(d.today)} ${d.today === 1 ? "person" : "people"} here today · ${n(d.total)} all time`;
      box.hidden = false;
      dispatchEvent(new Event("relayout"));
    })
    .catch(() => { /* no counter on this host */ });
})();
