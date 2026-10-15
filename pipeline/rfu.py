"""Facteurs comparatifs (MAMH, Richesse foncière uniformisée).

Le facteur comparatif est l'inverse de la proportion médiane, calculée par le
ministère à partir des ventes réelles comparées aux valeurs du rôle. Il ramène
les valeurs du rôle à la valeur marchande.
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd

from common import WORK, ckan_resources, download, log, muni_code, norm, pick_resource

DATASET = "richesse-fonciere-uniformisee"


def _read_any(path: Path) -> pd.DataFrame:
    for enc in ("utf-8-sig", "latin-1"):
        try:
            return pd.read_csv(path, sep=None, engine="python", dtype=str, encoding=enc)
        except UnicodeDecodeError:
            continue
    raise RuntimeError(f"CSV illisible : {path}")


def _num(v) -> float | None:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return None
    s = str(v).strip().replace(" ", "").replace(" ", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def parse_rfu(path: Path) -> dict[str, dict]:
    df = _read_any(path)
    cols = {norm(c): c for c in df.columns}
    fc_col = next((cols[c] for c in cols if "facteur" in c), None) \
        or next((cols[c] for c in cols if c.endswith("02163")), None)
    code_col = cols.get("cod_geo") or next(c for k, c in cols.items() if "geo" in k)
    name_col = next((cols[c] for c in ("nom_mun", "nom_organisme") if c in cols), None)
    out = {}
    for _, row in df.iterrows():
        code = muni_code(row[code_col])
        if not code:
            continue
        rec = {
            "nom": row.get(name_col) if name_col else None,
            "fc": _num(row[fc_col]) if fc_col else None,
            "population": _num(row.get(cols.get("population", ""), None)),
            "mrc": row.get(cols.get("nom_mrc", ""), None),
            "region": row.get(cols.get("desc_reg", ""), None),
            "cm": row.get(cols.get("nom_cm", ""), None),
        }
        # Les facteurs plausibles se situent entre 0,5 et 3.
        if rec["fc"] is not None and not 0.5 <= rec["fc"] <= 3:
            rec["fc"] = None
        out[code] = rec
    if not fc_col:
        log.warning("RFU %s : colonne du facteur comparatif introuvable", path.name)
    return out


def load_rfu(local: dict[int, Path] | None = None) -> dict[int, dict[str, dict]]:
    """Retourne {année: {code: {...}}} pour les deux années les plus récentes."""
    years: dict[int, Path] = {}
    if local:
        years = local
    else:
        res = ckan_resources(DATASET)
        found = []
        for r in res:
            name = r.get("name") or ""
            if (r.get("format") or "").upper() != "CSV" or "description" in norm(name):
                continue
            m = re.search(r"(20\d\d)", name)
            if m:
                found.append((int(m.group(1)), r["url"]))
        found.sort(reverse=True)
        for year, url in found[:2]:
            years[year] = download(url, WORK / f"rfu_{year}.csv")
    out = {y: parse_rfu(p) for y, p in years.items()}
    for y, d in out.items():
        n = sum(1 for v in d.values() if v["fc"])
        log.info("RFU %d : %d municipalités, %d facteurs", y, len(d), n)
    return out


__all__ = ["load_rfu", "parse_rfu", "pick_resource"]
