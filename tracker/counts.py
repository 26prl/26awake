"""Approximate case and death counts, taken only from verified reporting.

Every article headline/summary is scanned for statements such as "lab worker dies", "2 cases",
"второй случай", "dozens quarantined" or denials like "no plague cases". A figure is shown as
verified only when an official/expert source states it, or at least two independent reputable
outlets do. Bigger figures from other sources are listed separately as unverified.

This is rule-based text matching on headlines, so the result is an approximation: every number
links to the reports it came from.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

from .trust import TRUSTED

WINDOW_DAYS = 30

WORD_NUMBERS = {
    "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "dozen": 12,
    "один": 1, "одна": 1, "одного": 1, "одной": 1, "одно": 1, "два": 2, "две": 2, "двух": 2, "двое": 2,
    "три": 3, "трех": 3, "трёх": 3, "трое": 3, "четыре": 4, "четырех": 4, "четырёх": 4, "четверо": 4,
    "пять": 5, "пяти": 5, "пятеро": 5, "шесть": 6, "семь": 7, "восемь": 8, "девять": 9, "десять": 10,
}
ORDINALS = {
    "second": 2, "third": 3, "fourth": 4, "fifth": 5,
    "второй": 2, "вторая": 2, "второго": 2, "второе": 2, "второму": 2, "третий": 3, "третья": 3,
    "третьего": 3, "третье": 3, "четвертый": 4, "четвёртый": 4, "пятый": 5,
}
VAGUE = {"dozens": "dozens", "десятки": "dozens", "десятков": "dozens", "hundreds": "hundreds", "сотни": "hundreds"}

_NUM = r"(\d{1,6}|" + "|".join(sorted(WORD_NUMBERS, key=len, reverse=True)) + r")"
_ORD = r"(" + "|".join(sorted(ORDINALS, key=len, reverse=True)) + r")"
_GAP = r"(?:\s+[\w'’-]+){0,3}?\s+"  # up to three words in between: "second lab worker", "a suspected plague case"

DEATH_WORDS = r"(deaths?|dead|died|dies|killed|fatalit\w*|fatal|умер\w*|умерш\w*|скончал\w*|погиб\w*|смерт\w*|летальн\w*|гибел\w*)"
CASE_WORDS = (r"(cases?|infections?|infected|patients?|sick|ill|illness|"
              r"случа\w*|заболе\w*|заразил\w*|заражен\w*|заражён\w*|инфицир\w*|пациент\w*)")
CASE_SUBJECT = r"(cases?|infections?|patients?|illness|lab workers?|workers?|employees?|случа\w*|заболе\w*|пациент\w*|сотрудни\w*|лаборант\w*)"
QUARANTINE_WORDS = (r"(quarantined|in quarantine|isolated|hospitali[sz]ed|under observation|contacts|"
                    r"на карантин\w*|в карантин\w*|изолирован\w*|госпитализир\w*|под наблюдени\w*|контактн\w*)")

SUSPECTED = re.compile(
    r"suspect|possibl|probabl|likely|reported|reports? of|mysterio|unknown|potential|may have|might|alleged|feared|"
    r"\?|вероятн|возможн|подозр|предполож|якобы|неизвестн|слух|по данным сми|сообщени",
    re.I,
)
CONFIRMED = re.compile(r"\bconfirm|lab-confirmed|подтверд|подтвержд|диагностир|выявил|выявлен", re.I)
DENIAL = re.compile(
    r"\bno (new )?(plague )?(cases?|infections?|deaths?|outbreak|epidemic)\b|\bno plague\b|\bnot (the )?plague\b|"
    r"\bdid(n['’]t| not) die (of|from) plague|\bden(y|ies|ied)\b|\bruled? out\b|tested negative|\bnegative\b|"
    r"\bfalse (information|reports?)\b|\bfake\b|"
    r"чумы нет|\bнет чумы|отсутстви\w* (случа|чум)|исключил\w*|исключен\w*|не выявил\w*|не выявлен\w*|не обнаруж\w*|"
    r"фейк\w*|опроверг\w*|не подтверд\w*|не подтвержд\w*|отрица\w*|ложн\w*",
    re.I,
)
NO_DEATHS = re.compile(r"\bno (new )?deaths?\b|никто не умер|смертей нет|без летальн", re.I)
CONTEXT_SKIP = re.compile(
    r"black death|ч[её]рн\w* смерт|middle ages|medieval|средневек|century|столети|веке\b|annually|per year|"
    r"each year|every year|ежегодно|в год\b|worldwide|в мире\b|globally|история чумы|history of",
    re.I,
)
_SENTENCES = re.compile(r"(?<=[.!?;])\s+|\s+\|\|\s+|\s[–—-]\s")


def _value(token: str) -> int | None:
    token = token.lower()
    if token.isdigit():
        return int(token)
    return WORD_NUMBERS.get(token)


def _qualifier(sentence: str, tier: str) -> str:
    if SUSPECTED.search(sentence):
        return "suspected"
    if CONFIRMED.search(sentence) or tier in ("official", "expert"):
        return "confirmed"
    return "reported"


def extract(text: str, tier: str = "unknown") -> list[dict]:
    """Return claims found in one article's text: {metric, value, qualifier, vague, denial, quote}."""
    claims: list[dict] = []
    for sentence in _SENTENCES.split(text):
        s = sentence.strip()
        low = s.lower()
        if len(low) < 8 or CONTEXT_SKIP.search(low):
            continue
        denial = bool(DENIAL.search(low))
        qual = _qualifier(low, tier)

        # Deaths (a death is reported even when officials dispute that plague caused it).
        if not NO_DEATHS.search(low):
            death = None
            m = re.search(_NUM + r"\s+(?:people\s+|persons?\s+|человек\w*\s+)?(?:have\s+)?" + DEATH_WORDS, low)
            if m and _value(m.group(1)) is not None:
                death = _value(m.group(1))
            m2 = re.search(r"\b" + _ORD + _GAP + DEATH_WORDS, low)
            if m2:
                death = max(death or 0, ORDINALS[m2.group(1)])
            if death is None and re.search(r"\b" + DEATH_WORDS, low) and not re.search(r"\bdeath toll\b", low):
                death = 1
            if death:
                claims.append({"metric": "deaths", "value": death, "qualifier": qual, "denial": False, "quote": s})

        # Cases / infections — not counted from sentences that deny cases.
        if not denial:
            case = None
            m = re.search(_NUM + r"\s+(?:new\s+|confirmed\s+|suspected\s+|possible\s+|probable\s+|more\s+)?"
                          r"(?:plague\s+|чумы\s+)?" + CASE_WORDS, low)
            if m and _value(m.group(1)) is not None and not re.match(r"(a|an)\b", m.group(1)):
                case = _value(m.group(1))
            m2 = re.search(r"\b" + _ORD + _GAP + CASE_SUBJECT, low) or re.search(
                r"\b(another|ещ[её] (один|одна|одного))\b" + _GAP + r"?" + CASE_WORDS, low)
            if m2:
                n = ORDINALS.get(m2.group(1), 2)
                case = max(case or 0, n)
            if case is None and re.search(r"\b(a|one)\b" + _GAP + r"?(case|infection|patient)\b|\bcase of\b|"
                                          r"\bслучай\b|\bслучая (чумы|заболев|заражен)|\bзаболел\w*\b", low):
                case = 1
            if case:
                claims.append({"metric": "cases", "value": case, "qualifier": qual, "denial": False, "quote": s})

        # Quarantined / contacts under observation.
        m = re.search(r"(\d{1,6}|" + "|".join(VAGUE) + "|" + "|".join(k for k in WORD_NUMBERS if len(k) > 2) + r")"
                      r"\s+(?:people\s+|человек\w*\s+|residents\s+|workers\s+|сотрудник\w*\s+)?(?:were\s+|have been\s+|are\s+)?"
                      + QUARANTINE_WORDS, low)
        if m:
            token = m.group(1)
            claims.append({"metric": "quarantined", "value": _value(token), "vague": VAGUE.get(token),
                           "qualifier": "reported", "denial": False, "quote": s})

        if denial:
            metric = "deaths" if re.search(DEATH_WORDS, low) and "plague" not in low and "чум" not in low else "cases"
            claims.append({"metric": metric, "value": 0, "qualifier": "denial", "denial": True, "quote": s})
    return claims


def _support(claims: list[dict], v: int) -> tuple[int, set[str]]:
    """Official/expert sources count double, so one of them alone verifies a figure."""
    domains: dict[str, str] = {}
    for c in claims:
        if c["value"] is not None and c["value"] >= v and c["trust"] in TRUSTED:
            domains.setdefault(c["domain"], c["trust"])
    score = sum(2 if t in ("official", "expert") else 1 for t in domains.values())
    return score, set(domains)


def _verified(claims: list[dict]) -> dict:
    values = sorted({c["value"] for c in claims if c["value"]}, reverse=True)
    for v in values:
        score, domains = _support(claims, v)
        if score >= 2:
            backing = [c for c in claims if c["value"] is not None and c["value"] >= v and c["trust"] in TRUSTED]
            return {"value": v, "n_sources": len(domains), "official": any(c["trust"] == "official" for c in backing),
                    "sources": _dedupe_articles(backing)[:6]}
    return {"value": 0, "n_sources": 0, "official": False, "sources": []}


def _dedupe_articles(claims: list[dict]) -> list[dict]:
    seen, out = set(), []
    for c in sorted(claims, key=lambda c: c["published_at"], reverse=True):
        if c["url"] in seen:
            continue
        seen.add(c["url"])
        out.append({k: c[k] for k in ("title", "url", "source", "trust", "published_at", "value", "qualifier", "quote")})
    return out


def _metric_summary(claims: list[dict], metric: str) -> dict:
    mine = [c for c in claims if c["metric"] == metric and not c["denial"]]
    reported = _verified(mine)  # suspected + reported + confirmed
    confirmed = _verified([c for c in mine if c["qualifier"] == "confirmed"])
    verified_value = reported["value"]
    # Anything above the verified figure: untrusted sources, or a single trusted outlet without backing.
    unverified = [c for c in mine if (c["value"] or 0) > verified_value]
    return {
        "value": verified_value,
        "confirmed": confirmed,
        "reported": reported,
        "suspected_only": verified_value > confirmed["value"],
        "unverified_max": max((c["value"] for c in unverified), default=None),
        "unverified": _dedupe_articles(unverified)[:5],
        "n_claims": len(mine),
    }


def collect_claims(articles: list[dict]) -> list[dict]:
    claims = []
    for a in articles:
        text = f"{a['title']}. {a.get('summary') or ''}"
        for c in extract(text, a["trust"]):
            c.update(
                article_id=a.get("id"), title=a["title"], url=a["url"], source=a["source"],
                domain=a.get("domain") or a["source"], trust=a["trust"], published_at=a["published_at"],
                text=text.lower(),
            )
            claims.append(c)
    return claims


def summarize(claims: list[dict]) -> dict:
    deaths = _metric_summary(claims, "deaths")
    cases = _metric_summary(claims, "cases")
    # Everyone who died of a (suspected) infection was infected.
    for key in ("reported", "confirmed"):
        if deaths[key]["value"] > cases[key]["value"]:
            cases[key] = {**deaths[key]}
    cases["value"] = max(cases["value"], deaths["value"])
    cases["suspected_only"] = cases["value"] > cases["confirmed"]["value"]

    q = [c for c in claims if c["metric"] == "quarantined"]
    q_trusted = [c for c in q if c["trust"] in TRUSTED or c["trust"] == "state"]
    q_num = _verified([c for c in q if c["value"]])
    vague = sorted({c["vague"] for c in q_trusted if c.get("vague")})
    quarantined = {
        "value": q_num["value"] or None,
        "text": str(q_num["value"]) if q_num["value"] else (vague[-1] if vague else None),
        "sources": (q_num["sources"] or _dedupe_articles(q_trusted))[:4],
    }

    # Official positions are often relayed by state media, so include it here (labelled).
    denials = _dedupe_articles([c for c in claims if c["denial"] and (c["trust"] in TRUSTED or c["trust"] == "state")])
    # A figure is "disputed" when trusted or state outlets report an official denial.
    disputed = bool(denials)
    deaths["disputed"] = disputed and deaths["confirmed"]["value"] == 0
    cases["disputed"] = disputed and cases["confirmed"]["value"] == 0
    return {"deaths": deaths, "cases": cases, "quarantined": quarantined, "denials": denials[:6],
            "n_denials": len(denials)}


def build(articles: list[dict], facets: dict | None = None, days: int = WINDOW_DAYS) -> dict:
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    recent = [a for a in articles if a["published_at"] >= since]
    claims = collect_claims(recent)
    result = summarize(claims)
    result["window_days"] = days
    result["n_articles"] = len(recent)
    regions = {}
    for name, facet in (facets or {}).items():
        kws = [k.lower() for k in facet.get("keywords", [])]
        mine = [c for c in claims if any(k in c["text"] for k in kws)]
        if not mine:
            continue
        s = summarize(mine)
        regions[name] = {"deaths": s["deaths"]["value"], "cases": s["cases"]["value"],
                         "confirmed_cases": s["cases"]["confirmed"]["value"], "denials": len(s["denials"])}
    result["regions"] = regions
    return result
