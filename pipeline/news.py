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
GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent"
GEMINI_LIST = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200"
_models: list[str] | None = None


def _version(name: str) -> tuple:
    import re
    m = re.search(r"(\d+(?:\.\d+)?)", name)
    return (float(m.group(1)) if m else 0.0, "lite" not in name, "preview" not in name and "exp" not in name)


def available_models(key: str) -> list[str]:
    """Modèles « flash » réellement offerts à cette clé (la liste change souvent chez Google)."""
    global _models
    if _models is not None:
        return _models
    found = []
    try:
        r = requests.get(GEMINI_LIST, headers={"x-goog-api-key": key}, timeout=30)
        r.raise_for_status()
        for m in r.json().get("models", []):
            name = m.get("name", "").removeprefix("models/")
            if "generateContent" in m.get("supportedGenerationMethods", []) and "flash" in name \
                    and not any(x in name for x in ("image", "tts", "audio", "live", "embedding")):
                found.append(name)
    except Exception as exc:  # noqa: BLE001 — la clé est envoyée en en-tête, jamais journalisée
        log.warning("liste des modèles Gemini indisponible : %s", type(exc).__name__)
    preferred = [m for m in MODELS if not found or m in found]
    stable = sorted([m for m in found if m not in preferred and "preview" not in m and "exp" not in m], key=_version, reverse=True)
    _models = (preferred + stable)[:4] or MODELS
    log.info("modèles Gemini retenus : %s", ", ".join(_models))
    return _models

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


def classify(ville: str, items: list[dict], key: str) -> list[dict] | None:
    """Manchettes pertinentes annotées, ou None si aucun modèle n'a répondu."""
    listing = "\n".join(f"{i}. {it['titre']} ({it['source']}, {it['date']})" for i, it in enumerate(items))
    body = {
        "contents": [{"parts": [{"text": PROMPT.format(ville=ville, items=listing)}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.2},
    }
    for model in list(available_models(key)):
        try:
            r = requests.post(GEMINI.format(m=model), json=body, timeout=90, headers={"x-goog-api-key": key})
            if r.status_code in (429, 503):
                time.sleep(4)
                continue
            if r.status_code == 404 and _models and model in _models and len(_models) > 1:
                _models.remove(model)  # modèle retiré : ne plus l'essayer
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
            log.warning("Gemini %s (%s) : %s", model, ville, getattr(getattr(exc, "response", None), "status_code", type(exc).__name__))
    return None


def news_for(munis: list[tuple[str, str]]) -> dict[str, dict]:
    key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if not key:
        log.warning("GEMINI_API_KEY absente : nouvelles sans analyse")
    out = {}
    analysed = 0
    for code, ville in munis:
        items = fetch_headlines(ville)
        done = False
        if items and key:
            kept = classify(ville, items, key)
            if kept is not None:
                items, done = kept, True
                analysed += 1
        out[code] = {"maj": datetime.now(timezone.utc).date().isoformat(), "analyse": done, "items": items}
        time.sleep(1.0)
    log.info("nouvelles : %d municipalités, %d analysées par Gemini", len(out), analysed)
    return out
