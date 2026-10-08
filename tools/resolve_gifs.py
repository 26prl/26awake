"""Turn Tenor page links in static/gifs.json into direct media links (run by .github/workflows/gifs.yml).

A Tenor page (tenor.com/view/…-gif-ID) can't be shown as an image; the GIF itself lives on media.tenor.com.
Each page link is replaced with {"src": <gif>, "mp4": <mp4 or null>, "page": <the page link>}. Entries that
are already resolved, or aren't Tenor pages, are left alone. Prints what it did; exit code 0 either way.
"""

from __future__ import annotations

import html
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "static" / "gifs.json"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
TENOR_PAGE = re.compile(r"^https?://(www\.)?tenor\.com/(\w{2}/)?view/", re.I)
MEDIA = r"https://media\d*\.tenor\.com/[^\"'\s<>\\]+?"


def fetch(url: str) -> str:
    p = urllib.parse.urlsplit(url)
    safe = urllib.parse.urlunsplit((p.scheme, p.netloc, urllib.parse.quote(urllib.parse.unquote(p.path)), p.query, ""))
    req = urllib.request.Request(safe, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def media_from(page: str) -> dict:
    text = html.unescape(page).replace("\\u002F", "/").replace("\\/", "/")
    gif = mp4 = None
    # The page's own GIF: structured data first, then the og: tags, then the first media link.
    for pattern in (r'"contentUrl"\s*:\s*"(' + MEDIA + r'\.gif)"',
                    r'<meta[^>]+property="og:image"[^>]+content="(' + MEDIA + r'\.gif)"',
                    r'<meta[^>]+content="(' + MEDIA + r'\.gif)"[^>]+property="og:image"',
                    r"(" + MEDIA + r"\.gif)"):
        m = re.search(pattern, text, re.I)
        if m:
            gif = m.group(1)
            break
    for pattern in (r'<meta[^>]+property="og:video(?::secure_url)?"[^>]+content="(' + MEDIA + r'\.mp4)"',
                    r'"contentUrl"\s*:\s*"(' + MEDIA + r'\.mp4)"',
                    r"(" + MEDIA + r"\.mp4)"):
        m = re.search(pattern, text, re.I)
        if m:
            mp4 = m.group(1)
            break
    return {"src": gif, "mp4": mp4}


def main() -> int:
    data = json.loads(PATH.read_text(encoding="utf-8"))
    out, changed = [], 0
    for item in data.get("gifs", []):
        page = item if isinstance(item, str) else (item.get("page") if not item.get("src") else None)
        if not page or not TENOR_PAGE.match(page):
            out.append(item)
            continue
        try:
            media = media_from(fetch(page))
        except Exception as e:  # leave it as it is; the page shows Tenor's player for it meanwhile
            print(f"FAILED  {page}: {e}")
            out.append(item)
            continue
        if not media["src"] and not media["mp4"]:
            print(f"NO GIF  {page}")
            out.append(item)
            continue
        print(f"OK      {page}\n        -> {media['src']} | {media['mp4']}")
        out.append({"src": media["src"] or media["mp4"], "mp4": media["mp4"], "page": page})
        changed += 1
    if changed:
        data["gifs"] = out
        PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{changed} resolved")
    return 0


if __name__ == "__main__":
    sys.exit(main())
