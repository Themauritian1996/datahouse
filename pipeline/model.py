"""Modèle d'estimation : de la valeur au rôle à une valeur marchande actuelle.

valeur estimée = valeur au rôle × facteur comparatif du MAMH × (1 + g) ^ années écoulées

* Le facteur comparatif (inverse de la proportion médiane) est établi par le
  ministère à partir des ventes réelles de chaque municipalité.
* g est la tendance annuelle locale, tirée de l'évolution du facteur comparatif
  d'une année à l'autre ou, à défaut, de l'écart entre le rôle actuel et le rôle
  antérieur (même immeuble, 3 ans d'intervalle).
"""
from __future__ import annotations

import math
from datetime import date

import numpy as np
import pandas as pd

from common import norm

G_MIN, G_MAX = -0.05, 0.12
BASE_RANGE = {"U": 0.07, "C": 0.07, "P": 0.10, "M": 0.14, "H": 0.15, "R": 0.15, "X": 0.15}


def years_between(d1: date, d2: date) -> float:
    return (d2 - d1).days / 365.25


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def lin(x, x0, x1):
    """Échelle linéaire 0-100 entre x0 (0) et x1 (100)."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    return clamp(100 * (x - x0) / (x1 - x0), 0, 100)


def muni_growth(units: pd.DataFrame) -> pd.DataFrame:
    """Croissance médiane annualisée rôle antérieur -> rôle actuel, par municipalité."""
    ok = units[(units["va"] > 1000) & (units["t"].isin(["U", "C", "P"]))]
    ratio = (ok["vr"] / ok["va"]).clip(0.5, 3)
    med = ratio.groupby(ok["muni"]).median()
    n = ratio.groupby(ok["muni"]).size()
    roll_years = units.groupby("muni")["roleAn"].median() if "roleAn" in units else None
    return pd.DataFrame({"ratio3": med, "n3": n, "roleAn": roll_years})


def market_factors(units: pd.DataFrame, rfu: dict[int, dict], today: date, mrc_of: dict[str, str]) -> dict[str, dict]:
    years = sorted(rfu)
    cur_y = years[-1] if years else None
    prev_y = years[-2] if len(years) > 1 else None
    cur = rfu.get(cur_y, {})
    prev = rfu.get(prev_y, {})
    gr = muni_growth(units)
    date_ref = units.groupby("muni")["dateRef"].agg(lambda s: s.mode().iloc[0] if len(s.mode()) else None) \
        if "dateRef" in units else pd.Series(dtype=object)

    raw: dict[str, dict] = {}
    for code in units["muni"].unique():
        rec: dict = {"fcAnnee": cur_y}
        fc = (cur.get(code) or {}).get("fc")
        fcp = (prev.get(code) or {}).get("fc")
        role_an = gr["roleAn"].get(code) if code in gr.index else None
        rec["roleAnnee"] = int(role_an) if role_an and not math.isnan(role_an) else None
        g, src = None, None
        if fc and fcp and rec["roleAnnee"] and cur_y and rec["roleAnnee"] < cur_y:
            g, src = fc / fcp - 1, "facteurs comparatifs %d/%d" % (prev_y, cur_y)
        elif code in gr.index and gr.loc[code, "n3"] >= 20:
            g, src = gr.loc[code, "ratio3"] ** (1 / 3) - 1, "rôle actuel vs rôle antérieur"
        rec.update(fc=fc, fcPrec=fcp, gBrut=g, gSource=src,
                   dateRef=date_ref.get(code) if len(date_ref) else None)
        raw[code] = rec

    # Lissage vers la médiane de la MRC (petites municipalités = plus de bruit).
    by_mrc: dict[str, list] = {}
    for code, r in raw.items():
        if r["gBrut"] is not None:
            by_mrc.setdefault(mrc_of.get(code, "?"), []).append(r["gBrut"])
    all_g = [x for v in by_mrc.values() for x in v]
    prov_g = float(np.median(all_g)) if all_g else 0.03
    out = {}
    for code, r in raw.items():
        pop = (cur.get(code) or {}).get("population") or 0
        mrc_g = float(np.median(by_mrc.get(mrc_of.get(code, "?"), [prov_g])))
        if r["gBrut"] is None:
            g, src = mrc_g, "médiane de la MRC"
        else:
            w = clamp(pop / 10000, 0.3, 1.0)
            g, src = w * r["gBrut"] + (1 - w) * mrc_g, r["gSource"]
        g = clamp(g, G_MIN, G_MAX)
        fallback = False
        if r["fc"] and r["fcAnnee"]:
            fc_date = date(r["fcAnnee"] - 1, 1, 1)
            adj = r["fc"] * (1 + g) ** max(0, years_between(fc_date, today))
            ans = years_between(fc_date, today)
        else:
            fallback = True
            try:
                ref = date.fromisoformat(r["dateRef"]) if r["dateRef"] else None
            except ValueError:
                ref = None
            ref = ref or date((r["roleAnnee"] or today.year) - 2, 7, 1)
            ans = years_between(ref, today)
            adj = (1 + g) ** max(0, ans)
        out[code] = {
            "fc": r["fc"], "fcPrec": r["fcPrec"], "fcAnnee": r["fcAnnee"],
            "roleAnnee": r["roleAnnee"], "dateRef": r["dateRef"],
            "g": round(g, 4), "gSource": src, "adj": round(adj, 4),
            "anneesExtrapolees": round(max(0, ans), 2), "sansFacteur": fallback,
            "incertitudeExtra": round(0.02 * max(0, ans) + (0.04 if pop and pop < 3000 else 0)
                                      + (0.03 if fallback else 0), 3),
        }
    return out


def type_stats(units: pd.DataFrame) -> dict[str, dict]:
    stats: dict[str, dict] = {}
    for (code, t), grp in units.groupby(["muni", "t"]):
        est = grp["est"]
        m2 = (grp["est"] / grp["aire"]).replace([np.inf, -np.inf], np.nan).dropna()
        m2 = m2[(m2 > 100) & (m2 < 30000)]
        ok3 = grp[grp["va"] > 1000]
        q = est.quantile([0.05, 0.25, 0.5, 0.75, 0.95]).round(-3)
        lo, hi = q[0.05], q[0.95]
        hist = None
        if len(est) >= 15 and hi > lo:
            counts, edges = np.histogram(est.clip(lo, hi), bins=12, range=(lo, hi))
            hist = {"min": int(lo), "max": int(hi), "n": counts.tolist()}
        stats.setdefault(code, {})[t] = {
            "n": int(len(grp)),
            "medRole": int(grp["vr"].median()),
            "medEst": int(q[0.5]), "p25": int(q[0.25]), "p75": int(q[0.75]),
            "medM2": int(m2.median()) if len(m2) >= 5 else None,
            "medAnnee": int(grp["an"].median()) if grp["an"].notna().sum() >= 5 else None,
            "medAire": int(grp["aire"].median()) if grp["aire"].notna().sum() >= 5 else None,
            "medLogements": float(grp["lg"].median()) if grp["lg"].notna().any() else None,
            "croissance3ans": round(float((ok3["vr"] / ok3["va"]).clip(0.5, 3).median()) - 1, 3)
            if len(ok3) >= 10 else None,
            "hist": hist,
        }
    return stats


def liquidity(pop, croiss, g, mob, ratio_prix_revenu) -> dict:
    comps = {
        "tailleMarche": (lin(math.log10(pop), 3, 6.2) if pop else None, 0.25),
        "croissanceDemo": (lin(croiss, -5, 10), 0.20),
        "tendancePrix": (lin(None if g is None else g * 100, -3, 10), 0.20),
        "mobilite": (lin(mob, 5, 20), 0.15),
        "abordabilite": (lin(ratio_prix_revenu, 10, 3) if ratio_prix_revenu else None, 0.20),
    }
    if sum(1 for v, w in comps.values() if v is not None) < 3:  # trop peu d'indicateurs
        return {"score": None, "composantes": {k: None if v is None else round(v) for k, (v, w) in comps.items()}}
    tot = sum(w for v, w in comps.values() if v is not None)
    score = sum(v * w for v, w in comps.values() if v is not None) / tot if tot else None
    return {"score": None if score is None else round(score),
            "composantes": {k: None if v is None else round(v) for k, (v, w) in comps.items()}}


def cma_key(nom: str | None, cm: str | None, asking: dict) -> str | None:
    """Région métropolitaine (loyers affichés) correspondant à une municipalité."""
    if not asking:
        return None
    n = norm(nom or "")
    c = norm(cm or "")
    for k in asking:
        base = k.replace("(quebec part)", "").replace("(partie du quebec)", "")
        names = [p.strip() for p in base.replace("–", "-").split(" - ")]
        if any(p and (p == n or (c and p in c)) for p in names):
            return k
    return None
