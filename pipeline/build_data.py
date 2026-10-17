"""Construit toutes les données statiques de DataHouse.

Usage :
    python build_data.py                 # données réelles (GitHub Actions)
    python build_data.py --demo          # données simulées (tests, démonstration)
    python build_data.py --no-news       # sans nouvelles

Sortie : DATAHOUSE_OUT (par défaut pipeline/_out) contenant data/…
"""
from __future__ import annotations

import argparse
import math
import os
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd

from common import OUT, clean_dir, log, setup_logging, write_json
import boundaries
import census as census_mod
import markets
import model
import news as news_mod
import rfu as rfu_mod
import role as role_mod
import taxes as taxes_mod

# Droits de mutation (taxe de bienvenue) 2026 — tranches de base de la loi,
# plus les tranches supplémentaires adoptées par Montréal et Québec.
DROITS_MUTATION = {
    "annee": 2026,
    "base": [[62900, 0.005], [315000, 0.01], [None, 0.015]],
    "municipal": {
        "66023": {"nom": "Montréal", "tranches": [[62900, 0.005], [315000, 0.01], [552300, 0.015],
                                                   [1104700, 0.02], [2136500, 0.025], [3113000, 0.035],
                                                   [None, 0.04]]},
        "23027": {"nom": "Québec", "tranches": [[62900, 0.005], [315000, 0.01], [500000, 0.015],
                                                 [750000, 0.025], [None, 0.03]]},
    },
    "note": "Plusieurs municipalités appliquent un taux plus élevé (jusqu'à 3 %) au-delà de "
            "500 000 $. Vérifiez auprès de la municipalité.",
    "sources": ["https://montreal.ca/articles/comment-sont-calcules-les-droits-sur-les-mutations-immobilieres-9279",
                "https://www.ville.quebec.qc.ca/citoyens/taxes_evaluation/droits_mutation_immobiliere.aspx"],
}

SOURCES = [
    {"nom": "Prévisions budgétaires des municipalités (taux de taxe foncière adoptés)", "editeur": "MAMH — Données Québec",
     "licence": "CC-BY 4.0", "url": "https://www.donneesquebec.ca/recherche/dataset/rapport-financier-des-organismes-municipaux-et-autres-documents"},
    {"nom": "Imagerie aérienne continue du Québec", "editeur": "Gouvernement du Québec",
     "licence": "CC-BY 4.0", "url": "https://www.donneesquebec.ca/"},
    {"nom": "Rôles d'évaluation foncière du Québec géoréférencés", "editeur": "MAMH — Données Québec",
     "licence": "CC-BY 4.0", "url": "https://www.donneesquebec.ca/recherche/dataset/roles-d-evaluation-fonciere-du-quebec"},
    {"nom": "Richesse foncière uniformisée (facteurs comparatifs)", "editeur": "MAMH — Données Québec",
     "licence": "CC-BY 4.0", "url": "https://www.donneesquebec.ca/recherche/dataset/richesse-fonciere-uniformisee"},
    {"nom": "Recensement 2021 par municipalité : population (98-10-0002), revenu des ménages (98-10-0057), "
     "mode d'occupation et abordabilité (98-10-0259), âge (98-10-0022), valeur des logements (98-10-0257)", "editeur": "Statistique Canada",
     "licence": "Licence du gouvernement ouvert — Canada",
     "url": "https://www150.statcan.gc.ca/t1/tbl1/fr/tv.action?pid=9810005701"},
    {"nom": "Fichiers des limites des subdivisions de recensement 2021", "editeur": "Statistique Canada",
     "licence": "Licence du gouvernement ouvert — Canada",
     "url": "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-fra.cfm"},
    {"nom": "Indice des prix à la consommation (loyer), tableau 18-10-0004", "editeur": "Statistique Canada",
     "licence": "Licence du gouvernement ouvert — Canada", "url": "https://www150.statcan.gc.ca/t1/tbl1/fr/tv.action?pid=1810000401"},
    {"nom": "Statistiques trimestrielles sur les loyers, tableau 46-10-0092", "editeur": "Statistique Canada",
     "licence": "Licence du gouvernement ouvert — Canada", "url": "https://www150.statcan.gc.ca/t1/tbl1/fr/tv.action?pid=4610009201"},
    {"nom": "Taux hypothécaire conventionnel 5 ans (V80691335)", "editeur": "Banque du Canada",
     "licence": "Conditions d'utilisation de la Banque du Canada", "url": "https://www.banqueducanada.ca/taux/"},
    {"nom": "Commodités et nuisances (OpenStreetMap, API Overpass)", "editeur": "Contributeurs OpenStreetMap",
     "licence": "ODbL", "url": "https://www.openstreetmap.org/copyright"},
]


def none_if_nan(v):
    if v is None:
        return None
    if isinstance(v, (float, np.floating)) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        return float(v)
    return v


def write_tiles(units: pd.DataFrame, dest) -> int:
    units = units.copy()
    units["la"] = np.floor(units["lat"] * 100).astype(int)
    units["lo"] = np.floor(units["lon"] * 100).astype(int)
    n = 0
    for (la, lo), g in units.groupby(["la", "lo"]):
        codes = sorted(g["muni"].unique())
        idx = {c: i for i, c in enumerate(codes)}
        rows = []
        for r in g.itertuples(index=False):
            rows.append([
                int(round(r.lon * 1e5)), int(round(r.lat * 1e5)), idx[r.muni], r.adr, r.t,
                none_if_nan(r.lg if not pd.isna(r.lg) else None),
                None if pd.isna(r.an) else int(r.an),
                None if pd.isna(r.aire) else int(round(r.aire)),
                None if pd.isna(r.ter) else int(round(r.ter)),
                int(r.vr), None if pd.isna(r.va) else int(r.va),
                None if pd.isna(r.et) else int(r.et),
                None if pd.isna(r.li) else int(r.li), r.id,
            ])
        write_json(dest / str(la) / f"{la}_{lo}.json", {"m": codes, "u": rows})
        n += 1
    return n


def main() -> None:
    setup_logging()
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true", help="utiliser les données simulées")
    ap.add_argument("--no-news", action="store_true")
    ap.add_argument("--news-min-pop", type=int, default=int(os.environ.get("NEWS_MIN_POP", 20000)))
    args = ap.parse_args()

    today = date.today()
    out = OUT / "data"
    clean_dir(out)

    if args.demo:
        from fixtures.make_fixtures import build as build_fixtures
        fx = build_fixtures()
        munis = boundaries.load_boundaries(fx["boundaries"])
        census = census_mod.load_census(fx["census"])
        rfu = rfu_mod.load_rfu(fx["rfu"])
        cpi = markets.rent_cpi_factor(fx["cpi"])
        asking = markets.asking_rents(fx["asking"])
        rate = {"tauxAffiche5ans": 6.19, "date": "2026-10-07"}
        units = role_mod.load_role(fx["gpkg"], munis)
        taxes = taxes_mod.load_taxes(fx["taxes"], 2026)
    else:
        munis = boundaries.load_boundaries()
        try:
            census = census_mod.load_census()
        except Exception as exc:  # noqa: BLE001 — le recensement enrichit, il n'est pas essentiel
            log.warning("recensement indisponible, analyse sans démographie : %s", exc)
            census = {}
        try:
            rfu = rfu_mod.load_rfu()
        except Exception as exc:  # noqa: BLE001
            log.warning("facteurs comparatifs indisponibles, repli sur la tendance du rôle : %s", exc)
            rfu = {}
        cpi = markets.rent_cpi_factor()
        asking = markets.asking_rents()
        rate = markets.mortgage_rate()
        units = role_mod.load_role(None, munis)
        try:
            taxes = taxes_mod.load_taxes()
        except Exception as exc:  # noqa: BLE001 — facultatif
            log.warning("taux de taxe foncière indisponibles : %s", exc)
            taxes = {}

    cur_rfu = rfu[max(rfu)] if rfu else {}
    if munis is None:
        munis = boundaries.from_units(units, {c: r.get("nom") for c, r in cur_rfu.items()})
    mrc_of = {c: (r.get("mrc") or "?") for c, r in cur_rfu.items()}
    factors = model.market_factors(units, rfu, today, mrc_of)
    units["est"] = units["vr"] * units["muni"].map(lambda c: factors[c]["adj"])
    stats = model.type_stats(units)

    centres = {}
    rp = munis.set_index("code").geometry.representative_point()
    for code, pt in rp.items():
        centres[code] = [round(pt.x, 5), round(pt.y, 5)]
    names = dict(zip(munis["code"], munis["nom"]))

    index, props = [], {}
    cpi_f = cpi.get("facteur")
    for code in sorted(units["muni"].unique()):
        r = cur_rfu.get(code, {})
        c = census.get(code, {})
        f = factors[code]
        st = stats.get(code, {})
        nom = r.get("nom") or names.get(code) or code
        sub = units[units["muni"] == code]
        centre = centres.get(code) or [round(sub["lon"].median(), 5), round(sub["lat"].median(), 5)]
        pop = r.get("population") or c.get("pop2021")
        loyer2021 = c.get("loyerMedian2021")
        loyer_est = round(loyer2021 * cpi_f) if loyer2021 and cpi_f else None
        key = model.cma_key(nom, r.get("cm"), asking.get("deuxChambres", {}))
        affiche = asking["deuxChambres"].get(key) if key else None
        loyer_src = "recensement" if loyer_est else None
        if not loyer_est and affiche:  # repli : loyer affiché régional, prudemment réduit
            loyer_est, loyer_src = round(affiche * 0.9 / 5) * 5, "affiche"
        u = st.get("U") or st.get("C") or {}
        ratio_pr = (u.get("medEst") / c["revenuMenage"]) if u.get("medEst") and c.get("revenuMenage") else None
        liq = model.liquidity(pop, c.get("croissancePop"), f["g"], c.get("pctDemenage1an"), ratio_pr)
        plex = st.get("P")
        rendement = None
        if plex and plex["n"] >= 10 and loyer_est and plex.get("medLogements"):
            rendement = round(12 * loyer_est * plex["medLogements"] / plex["medEst"] * 100, 2)
        data = {
            "code": code, "nom": nom, "mrc": r.get("mrc"), "region": r.get("region"), "cm": r.get("cm"),
            "population": none_if_nan(pop), "centre": centre,
            "role": {"annee": f["roleAnnee"], "dateRef": f["dateRef"], "nbUnites": int(len(sub))},
            "marche": f,
            "types": st,
            "recensement": c,
            "loyer": {"median2021": loyer2021, "facteurIPC": cpi_f, "estime": loyer_est, "source": loyer_src,
                      "affiche2ch": affiche, "region": key, "periodeAffiche": asking.get("periode")},
            "rendementPlex": rendement,
            "liquidite": liq,
            "ratioPrixRevenu": round(ratio_pr, 2) if ratio_pr else None,
            "taxes": taxes.get(code),
            "nouvelles": None,
        }
        write_json(out / "muni" / f"{code}.json", data)
        index.append({"c": code, "n": nom, "m": r.get("mrc"), "r": r.get("region"), "p": none_if_nan(pop),
                      "x": centre[0], "y": centre[1], "v": u.get("medEst"), "g": f["g"],
                      "l": liq["score"], "y2": rendement})
        props[code] = {"v": u.get("medEst"), "g": round(f["g"] * 100, 1), "y": rendement,
                       "l": liq["score"], "p": none_if_nan(pop)}

    # Repères provinciaux (médianes pondérées par la population).
    def wmedian(values: list[tuple[float, float]]):
        values = sorted((v, w) for v, w in values if v is not None and w)
        if not values:
            return None
        half, acc = sum(w for _, w in values) / 2, 0
        for v, w in values:
            acc += w
            if acc >= half:
                return round(v, 4)
    reperes = {}
    for key, getter in {
        "revenuMenage": lambda c: census.get(c, {}).get("revenuMenage"),
        "croissancePop": lambda c: census.get(c, {}).get("croissancePop"),
        "pctProprio": lambda c: census.get(c, {}).get("pctProprio"),
        "ageMoyen": lambda c: census.get(c, {}).get("ageMoyen"),
        "g": lambda c: factors[c]["g"],
    }.items():
        reperes[key] = wmedian([(getter(i["c"]), i["p"]) for i in index])
    reperes["rendementPlex"] = wmedian([(i["y2"], i["p"]) for i in index])

    write_json(out / "municipalites.json", index)
    boundaries.export_simplified(munis[munis["code"].isin(props)], out / "munis.geojson", props)
    n_tiles = write_tiles(units, out / "tuiles")
    log.info("%d tuiles écrites", n_tiles)

    if not args.no_news and not args.demo:
        big = [(i["c"], i["n"]) for i in index if (i["p"] or 0) >= args.news_min_pop]
        for code, payload in news_mod.news_for(big).items():
            path = out / "muni" / f"{code}.json"
            from common import read_json
            d = read_json(path)
            d["nouvelles"] = payload
            write_json(path, d)

    meta = {
        "genere": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "demo": args.demo,
        "nbUnites": int(len(units)),
        "nbMunicipalites": len(index),
        "rfuAnnees": sorted(rfu),
        "hypotheque": rate,
        "loyerIPC": cpi,
        "loyersAffiches": {"periode": asking.get("periode")},
        "droitsMutation": DROITS_MUTATION,
        "typeLabels": role_mod.TYPE_LABELS,
        "incertitudeBase": model.BASE_RANGE,
        "reperes": reperes,
        "sources": SOURCES,
        "tuile": 0.01,
    }
    write_json(out / "meta.json", meta, compact=False)
    log.info("terminé : %d unités, %d municipalités", len(units), len(index))


if __name__ == "__main__":
    main()
