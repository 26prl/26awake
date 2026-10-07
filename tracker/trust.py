"""Source credibility: map a publisher domain to a trust tier from trust.json."""

from __future__ import annotations

import json
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "trust.json"

# Ordered from most to least trustworthy. "unknown" = not in any list.
TIERS = ["official", "expert", "reputable", "state", "unknown", "low"]
TRUSTED = ("official", "expert", "reputable")
SCORES = {"official": 1.0, "expert": 0.9, "reputable": 0.75, "state": 0.5, "unknown": 0.3, "low": 0.1}
UNKNOWN_INFO = {
    "label": "Unverified",
    "description": "Not in any list yet. Treat as unconfirmed until a trusted source reports the same.",
}


class TrustRegistry:
    def __init__(self, path: str | Path = DEFAULT_PATH):
        data = json.loads(Path(path).read_text(encoding="utf-8")) if Path(path).exists() else {"tiers": {}}
        self.info: dict[str, dict] = {"unknown": UNKNOWN_INFO}
        self._domains: dict[str, str] = {}
        self._suffixes: list[tuple[str, str]] = []
        for tier, cfg in data.get("tiers", {}).items():
            if tier not in SCORES:
                raise ValueError(f"trust.json: unknown tier '{tier}', expected one of {TIERS}")
            self.info[tier] = {"label": cfg.get("label", tier), "description": cfg.get("description", "")}
            for d in cfg.get("domains", []):
                self._domains[d.lower().removeprefix("www.")] = tier
            for s in cfg.get("suffixes", []):
                self._suffixes.append((s.lower(), tier))
        # Longest suffix wins, so ".rospotrebnadzor.ru" beats ".ru"-style catch-alls.
        self._suffixes.sort(key=lambda x: -len(x[0]))

    def tier(self, domain: str) -> str:
        domain = (domain or "").lower().removeprefix("www.")
        if not domain:
            return "unknown"
        parts = domain.split(".")
        for i in range(len(parts) - 1):  # exact domain, then each parent domain
            hit = self._domains.get(".".join(parts[i:]))
            if hit:
                return hit
        for suffix, tier in self._suffixes:
            if domain.endswith(suffix):
                return tier
        return "unknown"

    def legend(self) -> list[dict]:
        return [{"tier": t, "score": SCORES[t], "trusted": t in TRUSTED, **self.info.get(t, {"label": t})}
                for t in TIERS]
