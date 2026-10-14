"use strict";
// The music-video queue shared by the home page box (video.js) and the mini player on the game pages (music.js):
// the clips from videos.json in a random order, each once per round, and "now playing" (which clip, how far in,
// sound on or off) kept in localStorage, so the music carries on when you move between pages.
//
// videos.json: {"videos": ["https://youtu.be/…", "https://www.youtube.com/watch?v=…", "VIDEO_ID",
//                          {"id": "…or a link", "start": 30, "end": 75}]}   (start/end in seconds: play just that part)

window.MV = (() => {
  const KEY = "mv-now", FRESH = 3 * 60 * 60 * 1000;   // pick up where it was if it's been under 3 hours
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // "https://youtu.be/ID", "…watch?v=ID", "…/embed/ID", "…/shorts/ID" or just "ID" → "ID"
  const idOf = (s) => {
    const m = String(s || "").match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/) || String(s || "").match(/^([\w-]{11})$/);
    return m ? m[1] : null;
  };
  const clipOf = (v, n) => {
    const id = idOf(typeof v === "object" && v ? v.id : v);
    if (!id) return null;
    const c = { videoId: id, n };                      // n: its place in videos.json
    if (v && typeof v === "object") {
      if (Number(v.start) > 0) c.startSeconds = Number(v.start);
      if (Number(v.end) > 0) c.endSeconds = Number(v.end);
    }
    return c;
  };
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };

  const q = {
    clips: [], at: 0, resumeAt: 0, sound: false,

    async load() {
      const d = await fetch("videos.json", { cache: "no-cache" }).then((r) => r.json());
      const all = (d.videos || []).map(clipOf).filter(Boolean);
      const s = read();
      const valid = s && Date.now() - s.saved < FRESH && Array.isArray(s.order) && s.order.length === all.length
        && s.order.every((n) => all.some((c) => c.n === n)) && s.at >= 0 && s.at < all.length;
      if (valid) {
        q.clips = s.order.map((n) => all.find((c) => c.n === n));
        q.at = s.at; q.resumeAt = Math.max(0, Number(s.t) || 0);
      } else {
        q.clips = shuffle(all); q.at = 0; q.resumeAt = 0;
      }
      q.sound = !!(s && s.sound);
      return q.clips.length > 0;
    },

    // the clip to start with, from where it was left
    first() {
      const c = { ...q.clips[q.at] };
      if (q.resumeAt > (c.startSeconds || 0) + 2) c.startSeconds = Math.floor(q.resumeAt);
      return c;
    },

    // move on; after the last clip of a round, shuffle again (not starting with the one that just played)
    next() {
      if (q.at + 1 >= q.clips.length) {
        const last = q.clips[q.clips.length - 1];
        if (q.clips.length > 1) do shuffle(q.clips); while (q.clips[0] === last);
        q.at = 0;
      } else q.at++;
      q.resumeAt = 0;
      return q.clips[q.at];
    },

    save(t) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ order: q.clips.map((c) => c.n), at: q.at, t: Math.max(0, t || 0), sound: q.sound, saved: Date.now() }));
      } catch { /* private mode */ }
    },
  };
  return q;
})();
