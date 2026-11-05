"use strict";
// The home page: buttons left and right, the logo at the bottom, and the middle shows one section at a time.
// The address says which (#info, #blog, #blog/<post id>, #games, …), so the back button and links to a section work.
// Blog posts are in posts.json — to write one, add {"id", "title", "date": "YYYY-MM-DD", "body"} to the top of the
// list (body: paragraphs separated by a blank line). Section texts are in SECTIONS below.

(() => {
  const view = document.getElementById("view");
  const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const para = (text) => text.split(/\n\s*\n/).map((p) => el("p", { textContent: p.trim() }));

  const SECTIONS = {
    "": () => [],                                                       // home: nothing in the middle yet
    info: () => [el("h1", { textContent: "info" }), ...para("Nothing here yet.")],
    games: () => [el("h1", { textContent: "games" }),
      el("ul", { className: "base-list" }, ...[["2048", "2048.html"], ["minesweeper", "minesweeper.html"], ["sudoku", "sudoku.html"]]
        .map(([t, h]) => el("li", {}, el("a", { href: h, textContent: t }))))],
    music: () => [el("h1", { textContent: "music" }), ...para("Nothing here yet.")],
    links: () => [el("h1", { textContent: "links" }), ...para("Nothing here yet.")],
    contact: () => [el("h1", { textContent: "contact" }), ...para("Nothing here yet.")],
  };

  let posts = null;
  const loadPosts = () => posts || (posts = fetch("posts.json", { cache: "no-cache" }).then((r) => r.json()).then((d) => d.posts || []).catch(() => []));
  const date = (d) => { const t = new Date(`${d}T12:00:00`); return isNaN(t) ? d : t.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }); };

  async function blog(id) {
    const list = await loadPosts();
    if (id) {
      const p = list.find((x) => x.id === id);
      if (!p) return [el("h1", { textContent: "blog" }), el("p", { className: "muted", textContent: "That post isn't here." }), el("p", {}, el("a", { href: "#blog", textContent: "← all posts" }))];
      return [el("p", { className: "base-date", textContent: date(p.date) }), el("h1", { textContent: p.title }), ...para(p.body || ""),
        el("p", { className: "base-back" }, el("a", { href: "#blog", textContent: "← all posts" }))];
    }
    if (!list.length) return [el("h1", { textContent: "blog" }), el("p", { className: "muted", textContent: "No posts yet." })];
    return [el("h1", { textContent: "blog" }), el("ul", { className: "base-posts" }, ...list.map((p) =>
      el("li", {}, el("a", { href: `#blog/${encodeURIComponent(p.id)}`, textContent: p.title }), el("span", { className: "base-date", textContent: date(p.date) }))))];
  }

  async function show() {
    const [name, sub] = decodeURIComponent(location.hash.slice(1)).split("/");
    const kids = name === "blog" ? await blog(sub) : (SECTIONS[name] || SECTIONS[""])();
    view.replaceChildren(...kids);
    view.classList.toggle("empty-view", !kids.length);
    for (const a of document.querySelectorAll(".base-side a")) a.classList.toggle("on", a.getAttribute("href") === `#${name}`);
    if (name) view.focus({ preventScroll: true });
  }
  addEventListener("hashchange", show);
  show();
})();
