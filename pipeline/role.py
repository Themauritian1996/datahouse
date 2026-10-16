"""Rôle d'évaluation foncière géoréférencé du Québec (MAMH, GeoPackage).

Le GeoPackage provincial contient plusieurs tables reliées par `id_provinc` :

* `rol_unite_p_AAAA`          positions (MultiPoint) des unités d'évaluation ;
* `b05v_unite_evaln_AAAA`     caractéristiques et valeurs (balises RL0105A, RL0311A, RL0404A…) ;
* `b05v_adr_unite_evaln_AAAA` adresses (RL0101A… ; plusieurs par unité, `no_seq_adr`).

On ne garde que les unités résidentielles (et mixtes avec logements).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pyogrio
import shapely

from common import WORK, ckan_resources, download, log, muni_code, norm, pick_resource, unzip

DATASET = "roles-d-evaluation-fonciere-du-quebec"

GENERIQUES = {
    "ru": "rue", "av": "avenue", "bd": "boulevard", "bo": "boulevard", "boul": "boulevard",
    "ch": "chemin", "rg": "rang", "ra": "rang", "rt": "route", "ro": "route", "mt": "montée",
    "mo": "montée", "pl": "place", "cr": "croissant", "im": "impasse", "al": "allée", "pr": "promenade",
    "ca": "carré", "cv": "côte", "co": "côte", "te": "terrasse", "ci": "circle", "cs": "cours",
    "pk": "parc", "qu": "quai", "rl": "ruelle", "se": "sentier", "ae": "autoroute", "rp": "rond-point",
    "ve": "venelle", "dm": "domaine", "ld": "lac",
}

TYPE_LABELS = {
    "U": "Unifamiliale", "C": "Copropriété", "P": "Plex (2-5 log.)", "M": "Multilogement (6+)",
    "H": "Chalet", "R": "Maison mobile", "X": "Mixte (commerce + logements)",
}

EVAL_COLS = {
    "id_provinc": "id", "code_mun": "muni", "rl0105a": "cubf", "rl0302a": "ter", "rl0303a": "agri",
    "rl0306a": "et", "rl0307a": "an", "rl0308a": "aire", "rl0309a": "li", "rl0311a": "lg",
    "rl0402a": "vt", "rl0404a": "vr", "rl0405a": "va", "dat_cond_mrche": "dateRef",
}
ADR_COLS = ["id_provinc", "no_seq_adr", "rl0101a", "rl0101b", "rl0101c", "rl0101e", "rl0101f",
            "rl0101g", "rl0101h", "rl0101i"]


def find_gpkg():
    res = ckan_resources(DATASET)
    r = pick_resource(res, ["georeferenc"], fmt="GPKG")
    if r is None:
        raise RuntimeError("GeoPackage du rôle introuvable sur Données Québec")
    log.info("rôle géoréférencé %s : %s", r["_year"], r["url"])
    z = download(r["url"], WORK / f"role_{r['_year']}.zip", timeout=1800)
    folder = unzip(z, WORK / f"role_{r['_year']}")
    return max(folder.rglob("*.gpkg"), key=lambda p: p.stat().st_size)


def _layer(layers: list[str], prefix: str) -> str:
    hit = [l for l in layers if l.lower().startswith(prefix)]
    if not hit:
        raise RuntimeError(f"Table « {prefix}… » absente du GeoPackage ({layers})")
    return hit[0]


def _num(s: pd.Series) -> pd.Series:
    """Nombre en float64 numpy (NaN, jamais pd.NA) quel que soit le type d'origine."""
    v = pd.to_numeric(s.astype("string").str.replace(",", ".", regex=False), errors="coerce")
    return v.astype("float64")


def _str(s: pd.Series) -> pd.Series:
    return s.astype("string").fillna("").str.strip().replace({"None": "", "nan": "", "<NA>": ""})


def classify(cubf: np.ndarray, lg: np.ndarray, lien: np.ndarray) -> np.ndarray:
    t = np.full(len(cubf), "", dtype=object)
    n = np.nan_to_num(lg, nan=1)
    resid = (cubf >= 1000) & (cubf < 1300)
    t[resid & (n <= 1)] = "U"
    t[resid & (n >= 2) & (n <= 5)] = "P"
    t[resid & (n >= 6)] = "M"
    t[(cubf >= 1100) & (cubf < 1200)] = "H"
    t[(cubf >= 1211) & (cubf < 1300)] = "R"
    t[resid & (lien == 5) & (n <= 1)] = "C"
    t[(cubf >= 5000) & (cubf < 7000) & (n >= 2)] = "X"
    return t


def build_address(a: pd.DataFrame) -> pd.Series:
    no = _str(a["rl0101a"]) + _str(a["rl0101b"])
    sup = _str(a["rl0101c"])
    no = no.where(sup == "", no + "-" + sup)
    gen = _str(a["rl0101e"]).map(lambda g: GENERIQUES.get(norm(g), g.lower()) if g else "")
    voie = _str(a["rl0101g"]).str.title()
    for w in ("De", "Du", "Des", "La", "Le", "L'", "D'"):
        voie = voie.str.replace(rf"(?<=\s){w}\b", w.lower(), regex=True)
    parts = (no + " " + gen + " " + _str(a["rl0101f"]).str.lower() + " " + voie + " " + _str(a["rl0101h"]))
    parts = parts.str.replace(r"\s+", " ", regex=True).str.strip()
    app = _str(a["rl0101i"])
    return parts.where(app == "", parts + ", app. " + app)


def load_role(gpkg=None, munis=None) -> pd.DataFrame:
    gpkg = gpkg or find_gpkg()
    layers = [l[0] for l in pyogrio.list_layers(gpkg)]
    l_pts, l_eval, l_adr = _layer(layers, "rol_unite_p"), _layer(layers, "b05v_unite_evaln"), \
        _layer(layers, "b05v_adr_unite_evaln")
    log.info("tables : %s, %s, %s", l_pts, l_eval, l_adr)

    # 1. Caractéristiques et valeurs, filtrées sur le résidentiel.
    fields = set(pyogrio.read_info(gpkg, layer=l_eval)["fields"])
    cols = [c for c in EVAL_COLS if c in fields]
    ev = pyogrio.read_dataframe(gpkg, layer=l_eval, columns=cols, read_geometry=False, use_arrow=True)
    ev = ev.rename(columns=EVAL_COLS)
    log.info("unités au rôle : %d", len(ev))
    for c in ("cubf", "ter", "agri", "et", "an", "aire", "li", "lg", "vt", "vr", "va"):
        ev[c] = _num(ev[c]) if c in ev else np.nan
    ev["t"] = classify(ev["cubf"].to_numpy(), ev["lg"].to_numpy(), ev["li"].to_numpy())
    ev = ev[(ev["t"] != "") & (ev["vr"] > 1000)].copy()
    ev["id"] = _str(ev["id"]).astype(object)
    ev["muni"] = ev["muni"].map(muni_code)
    ev["dateRef"] = ev["dateRef"].astype("string").str[:10] if "dateRef" in ev else None
    ev["roleAn"] = _num(ev["dateRef"].str[:4]) + 2
    ev["dateRef"] = ev["dateRef"].astype(object).where(ev["dateRef"].notna(), None)
    log.info("unités résidentielles : %d", len(ev))
    keep = set(ev["id"])

    # 2. Positions (premier point de chaque MultiPoint), en degrés.
    tbl = pyogrio.read_arrow(gpkg, layer=l_pts, columns=["id_provinc"])[1]
    ids = np.asarray(tbl.column("id_provinc").to_pylist(), dtype=object)
    geom_col = next(c for c in tbl.column_names if c != "id_provinc")
    geoms = shapely.from_wkb(np.asarray(tbl.column(geom_col).to_pylist(), dtype=object))
    coords, idx = shapely.get_coordinates(geoms, return_index=True)
    first = np.unique(idx, return_index=True)[1]
    pts = pd.DataFrame({"id": pd.Series(ids[idx[first]]).astype(str).str.strip(),
                        "lon": coords[first, 0].round(5), "lat": coords[first, 1].round(5)})
    pts = pts[pts["id"].isin(keep)].drop_duplicates("id")
    log.info("positions trouvées : %d", len(pts))

    # 3. Adresses (la première de chaque unité).
    afields = set(pyogrio.read_info(gpkg, layer=l_adr)["fields"])
    ad = pyogrio.read_dataframe(gpkg, layer=l_adr, columns=[c for c in ADR_COLS if c in afields],
                                read_geometry=False, use_arrow=True)
    for c in ADR_COLS:
        if c not in ad:
            ad[c] = ""
    ad["id_provinc"] = _str(ad["id_provinc"])
    ad = ad[ad["id_provinc"].isin(keep)]
    ad["no_seq_adr"] = pd.to_numeric(ad["no_seq_adr"], errors="coerce")
    ad = ad.sort_values("no_seq_adr").drop_duplicates("id_provinc")
    adr = pd.Series(build_address(ad).to_numpy(), index=ad["id_provinc"].to_numpy())

    units = ev.merge(pts, on="id", how="inner")
    units["adr"] = units["id"].map(adr).fillna("").astype(object)
    units["muni"] = units["muni"].astype(object)
    # Coordonnées plausibles pour le Québec seulement.
    units = units[units["lat"].between(44.9, 63) & units["lon"].between(-80, -57)]
    log.info("rôle : %d unités résidentielles géolocalisées", len(units))
    return units.reset_index(drop=True)


__all__ = ["load_role", "classify", "TYPE_LABELS"]
