"""Nouvelles locales susceptibles d'influencer la valeur immobilière.

Récupère les manchettes récentes (Google Actualités, flux RSS public) pour les
municipalités les plus peuplées. Si une clé Gemini est fournie
(variable GEMINI_API_KEY), chaque manchette pertinente reçoit une courte
explication de son effet probable (hausse, baisse, neutre) et un horizon.
Aucun texte d'article n'est conservé : seulement le titre, la source, la date
et le lien.
"""
from __future__ import annotations

import json
import os
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import requests
from lxml import etree

from common import UA, log

RSS = "https://news.google.com/rss/search?q={q}&hl=fr-CA&gl=CA&ceid=CA:fr"
KEYWORDS = ("immobilier OR zonage OR logement OR construction OR développement OR "
            "transport OR tramway OR REM OR usine OR fermeture OR inondation OR taxes")
MODELS = [m.strip() for m in os.environ.get(
    "GEMINI_MODELS", "gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.8-flash").split(",") if m.strip()]
GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={k}"

PROMPT = """Tu es analyste immobilier au Québec. Voici des manchettes récentes concernant
la municipalité de {ville}. Pour chacune, détermine si elle peut influencer la valeur
des propriétés résidentielles locales. Réponds en JSON strict : une liste d'objets
{{"i": index, "pertinent": true|false, "effet": "hausse"|"baisse"|"neutre"|"incertain",
"horizon": "court terme"|"moyen terme"|"long terme",
"explication": "une phrase en français, factuelle, sans exagération"}}.
Ne spécule pas au-delà de la manchette.

Manchettes :
{items}"""


def fetch_headlines(ville: str, days: int = 90, limit: int = 15) -> list[dict]:
    q = urllib.parse.quote(f'"{ville}" ({KEYWORDS})')
    try:
        r = requests.get(RSS.format(q=q), timeout=30, headers=UA)
        r.raise_for_status()
        root = etree.fromstring(r.content)
    except Exception as exc:  # noqa: BLE001
        log.warning("nouvelles %s : %s", ville, exc)
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    out = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = item.findtext("link") or ""
        src = item.findtext("source") or ""
        try:
            dt = parsedate_to_datetime(item.findtext("pubDate"))
        except Exception:  # noqa: BLE001
            continue
        if dt < cutoff:
            continue
        if src and title.endswith(" - " + src):
            title = title[: -len(src) - 3]
        out.append({"titre": title, "source": src, "date": dt.date().isoformat(), "url": link})
    out.sort(key=lambda x: x["date"], reverse=True)
    return out[:limit]


def classify(ville: str, items: list[dict], key: str) -> list[dict]:
    listing = "\n".join(f"{i}. {it['titre']} ({it['source']}, {it['date']})" for i, it in enumerate(items))
    body = {
        "contents": [{"parts": [{"text": PROMPT.format(ville=ville, items=listing)}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
    }
    for model in MODELS:
        try:
            r = requests.post(GEMINI.format(m=model, k=key), json=body, timeout=90)
            if r.status_code in (429, 503):
                time.sleep(4)
                continue
            r.raise_for_status()
            text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
            verdicts = {v["i"]: v for v in json.loads(text) if isinstance(v, dict) and "i" in v}
            kept = []
            for i, it in enumerate(items):
                v = verdicts.get(i)
                if v and v.get("pertinent"):
                    kept.append({**it, "effet": v.get("effet"), "horizon": v.get("horizon"),
                                 "explication": v.get("explication"), "modele": model})
            return kept
        except Exception as exc:  # noqa: BLE001
            log.warning("Gemini %s (%s) : %s", model, ville, exc)
    return items


def news_for(munis: list[tuple[str, str]]) -> dict[str, dict]:
    key = os.environ.get("GEMINI_API_KEY")
    out = {}
    for code, ville in munis:
        items = fetch_headlines(ville)
        if items and key:
            items = classify(ville, items, key)
        out[code] = {"maj": datetime.now(timezone.utc).date().isoformat(),
                     "analyse": bool(key), "items": items}
        time.sleep(1.0)
    log.info("nouvelles : %d municipalités", len(out))
    return out
