"use strict";
// Counts every page view for the "N visits" line on the home page (api/visits.js), which also logs the view
// (page + where the visitor came from). The browser id sent along is random and anonymous; it isn't linked to
// the game player number.
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

  const json = (r) => ((r.headers.get("content-type") || "").includes("json") ? r.json() : null);
  fetch("/api/visits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: id, p: location.pathname, r: document.referrer }), cache: "no-store" })
    .then(json)
    // if recording the visit failed, still show the count
    .then((d) => (d && d.total != null ? d : fetch("/api/visits", { cache: "no-store" }).then(json)))
    .then((d) => {
      const box = document.getElementById("visits");
      if (!box || !d || !d.configured) return;
      const n = (x) => Number(x || 0).toLocaleString();
      box.textContent = `${n(d.total)} ${d.total === 1 ? "visit" : "visits"}`;
      box.hidden = false;
      dispatchEvent(new Event("relayout"));
    })
    .catch(() => { /* no counter on this host */ });
})();
