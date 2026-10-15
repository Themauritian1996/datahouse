"""Rôle d'évaluation foncière géoréférencé du Québec (MAMH).

Lit le GeoPackage provincial par tranches, garde les unités résidentielles et
produit une table compacte : coordonnées, adresse, type, logements, année,
superficies et valeurs au rôle (actuel et antérieur).
"""
from __future__ import annotations

import re
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio

from common import WORK, ckan_resources, download, log, muni_code, norm, pick_resource, unzip

DATASET = "roles-d-evaluation-fonciere-du-quebec"

# Balises du Manuel d'évaluation foncière du Québec (MEFQ).
TAGS = {
    "muni": ["rlm01a", "code_mun", "cod_geo", "code_geo", "codegeo"],
    "role_annee": ["rlm02a"],
    "no_inf": ["rl0101a"], "no_inf_s": ["rl0101b"], "no_sup": ["rl0101c"],
    "generique": ["rl0101e"], "lien_voie": ["rl0101f"], "voie": ["rl0101g"],
    "cardinal": ["rl0101h"], "app": ["rl0101i"],
    "mat_a": ["rl0104a"], "mat_b": ["rl0104b"], "mat_c": ["rl0104c"],
    "mat_e": ["rl0104e"], "mat_f": ["rl0104f"],
    "matricule": ["matricule", "mat18", "no_matricule"],
    "cubf": ["rl0105a"],
    "condition": ["rl0201u"],
    "terrain": ["rl0302a"],
    "zonage_agri": ["rl0303a"],
    "etages": ["rl0306a"],
    "annee": ["rl0307a"],
    "aire": ["rl0308a"],
    "lien": ["rl0309a"],
    "genre": ["rl0310a"],
    "logements": ["rl0311a"],
    "date_ref": ["rl0401a"],
    "v_terrain": ["rl0402a"],
    "v_batiment": ["rl0403a"],
    "valeur": ["rl0404a"],
    "valeur_ant": ["rl0405a"],
}

GENERIQUES = {
    "ru": "rue", "av": "avenue", "bd": "boulevard", "bo": "boulevard", "boul": "boulevard",
    "ch": "chemin", "rg": "rang", "rt": "route", "mt": "montée", "mo": "montée",
    "pl": "place", "cr": "croissant", "im": "impasse", "al": "allée", "pr": "promenade",
    "ca": "carré", "cv": "côte", "co": "côte", "te": "terrasse", "ci": "circle",
    "cs": "cours", "pk": "parc", "qu": "quai", "rl": "ruelle", "se": "sentier",
    "ae": "autoroute", "rp": "rond-point", "ve": "venelle", "ld": "lac", "dm": "domaine",
}

TYPE_LABELS = {
    "U": "Unifamiliale", "C": "Copropriété", "P": "Plex (2-5 log.)", "M": "Multilogement (6+)",
    "H": "Chalet", "R": "Maison mobile", "X": "Mixte (commerce + logements)",
}


def find_gpkg() -> Path:
    res = ckan_resources(DATASET)
    r = pick_resource(res, ["georeferenc"], fmt="GPKG")
    if r is None:
        raise RuntimeError("GeoPackage du rôle introuvable sur Données Québec")
    log.info("rôle géoréférencé %s : %s", r["_year"], r["url"])
    z = download(r["url"], WORK / f"role_{r['_year']}.zip", timeout=1800)
    folder = unzip(z, WORK / f"role_{r['_year']}")
    return max(folder.rglob("*.gpkg"), key=lambda p: p.stat().st_size)


def map_fields(fields: list[str]) -> dict[str, str]:
    """Associe nos clés aux colonnes réelles du fichier (noms tolérants)."""
    normed = {norm(f).replace(" ", "_"): f for f in fields}
    out = {}
    for key, tags in TAGS.items():
        for tag in tags:
            exact = [f for n, f in normed.items() if n == tag]
            pref = [f for n, f in normed.items() if n.startswith(tag)]
            hit = exact or sorted(pref, key=len)
            if hit:
                out[key] = hit[0]
                break
    return out


def _clean_str(s: pd.Series) -> pd.Series:
    return s.fillna("").astype(str).str.strip().replace({"None": "", "nan": ""})


def _num(s: pd.Series | None, n: int) -> np.ndarray:
    if s is None:
        return np.full(n, np.nan)
    return pd.to_numeric(s.astype(str).str.replace(",", ".", regex=False)
                         .str.replace(r"[^\d.\-]", "", regex=True), errors="coerce").to_numpy()


def build_address(df: pd.DataFrame, f: dict[str, str]) -> pd.Series:
    def col(k):
        return _clean_str(df[f[k]]) if k in f else pd.Series([""] * len(df), index=df.index)
    no = col("no_inf") + col("no_inf_s")
    sup = col("no_sup")
    no = np.where(sup != "", no + "-" + sup, no)
    gen = col("generique").map(lambda g: GENERIQUES.get(norm(g), g.lower()) if g else "")
    voie = col("voie").str.title().str.replace(r"\bDe\b", "de", regex=True) \
        .str.replace(r"\bDu\b", "du", regex=True).str.replace(r"\bDes\b", "des", regex=True)
    lien = col("lien_voie").str.lower()
    card = col("cardinal")
    app = col("app")
    parts = (pd.Series(no, index=df.index) + " " + gen + " " + lien + " " + voie + " " + card)
    parts = parts.str.replace(r"\s+", " ", regex=True).str.strip()
    return np.where(app != "", parts + ", app. " + app, parts)


def classify(cubf: np.ndarray, log_: np.ndarray, lien: np.ndarray, local: np.ndarray,
             cond: np.ndarray) -> np.ndarray:
    t = np.full(len(cubf), "", dtype=object)
    lg = np.nan_to_num(log_, nan=1)
    resid = (cubf >= 1000) & (cubf < 1300)
    mixte = (cubf >= 5000) & (cubf < 7000) & (lg >= 2)
    t[resid & (lg <= 1)] = "U"
    t[resid & (lg >= 2) & (lg <= 5)] = "P"
    t[resid & (lg >= 6)] = "M"
    t[(cubf >= 1100) & (cubf < 1200)] = "H"
    t[(cubf >= 1211) & (cubf < 1300)] = "R"
    condo = resid & ((lien == 5) | local | (cond == 3)) & (lg <= 1)
    t[condo] = "C"
    t[mixte] = "X"
    return t


def process_slice(gdf: gpd.GeoDataFrame, f: dict[str, str], munis: gpd.GeoDataFrame | None) -> pd.DataFrame:
    n = len(gdf)
    cubf = _num(gdf.get(f.get("cubf")), n)
    logts = _num(gdf.get(f.get("logements")), n)
    lien = _num(gdf.get(f.get("lien")), n)
    cond = _num(gdf.get(f.get("condition")), n)
    local = (_clean_str(gdf[f["mat_f"]]) != "").to_numpy() if "mat_f" in f else np.zeros(n, bool)
    t = classify(cubf, logts, lien, local, cond)
    keep = t != ""
    vr = _num(gdf.get(f.get("valeur")), n)
    keep &= np.nan_to_num(vr, nan=0) > 1000
    g = gdf.loc[keep].copy()
    if g.empty:
        return pd.DataFrame()
    geom = g.geometry
    if not (geom.geom_type == "Point").all():
        geom = geom.representative_point()
    pts = gpd.GeoSeries(geom, crs=gdf.crs).to_crs(4326)
    out = pd.DataFrame({
        "lon": pts.x.round(5).to_numpy(), "lat": pts.y.round(5).to_numpy(),
        "t": t[keep], "lg": logts[keep], "cubf": cubf[keep],
        "an": _num(g.get(f.get("annee")), len(g)), "aire": _num(g.get(f.get("aire")), len(g)),
        "ter": _num(g.get(f.get("terrain")), len(g)), "et": _num(g.get(f.get("etages")), len(g)),
        "li": lien[keep], "vr": vr[keep], "va": _num(g.get(f.get("valeur_ant")), len(g)),
        "vt": _num(g.get(f.get("v_terrain")), len(g)),
        "agri": _num(g.get(f.get("zonage_agri")), len(g)),
    })
    out["adr"] = build_address(g, f)
    if "matricule" in f:
        out["id"] = _clean_str(g[f["matricule"]]).to_numpy()
    else:
        parts = [_clean_str(g[f[k]]) for k in ("mat_a", "mat_b", "mat_c", "mat_e", "mat_f") if k in f]
        out["id"] = (pd.concat(parts, axis=1).agg("-".join, axis=1).str.strip("-").to_numpy()
                     if parts else "")
    if "muni" in f:
        out["muni"] = g[f["muni"]].map(muni_code).to_numpy()
    else:
        out["muni"] = None
    if "role_annee" in f:
        out["roleAn"] = _num(g[f["role_annee"]], len(g))
    if "date_ref" in f:
        out["dateRef"] = _clean_str(g[f["date_ref"]]).str[:10].to_numpy()
    missing = out["muni"].isna()
    if missing.any() and munis is not None:
        pts_gdf = gpd.GeoDataFrame(out.loc[missing, []], geometry=gpd.points_from_xy(
            out.loc[missing, "lon"], out.loc[missing, "lat"]), crs=4326)
        joined = gpd.sjoin(pts_gdf, munis[["code", "geometry"]], how="left", predicate="within")
        joined = joined[~joined.index.duplicated()]
        out.loc[missing, "muni"] = joined["code"].reindex(out.index[missing]).to_numpy()
    out = out[out["muni"].notna()]
    out["id"] = out["id"].where(out["id"] != "", out["muni"] + "-" + out.index.astype(str))
    return out


def load_role(gpkg: Path | None, munis: gpd.GeoDataFrame | None, slice_size: int = 400_000) -> pd.DataFrame:
    gpkg = gpkg or find_gpkg()
    layers = pyogrio.list_layers(gpkg)
    best = max(layers, key=lambda l: pyogrio.read_info(gpkg, layer=l[0]).get("features", 0))[0]
    info = pyogrio.read_info(gpkg, layer=best)
    fields = list(info["fields"])
    f = map_fields(fields)
    log.info("couche %s : %d unités, %d champs", best, info["features"], len(fields))
    log.info("champs reconnus : %s", {k: v for k, v in f.items()})
    absent = [k for k in ("valeur", "cubf", "logements") if k not in f]
    if absent:
        log.error("champs essentiels absents %s ; champs disponibles : %s", absent, fields)
        raise RuntimeError("Structure du GeoPackage non reconnue (voir le journal)")
    cols = sorted(set(f.values()))
    parts = []
    total = info["features"]
    for start in range(0, total, slice_size):
        gdf = pyogrio.read_dataframe(gpkg, layer=best, columns=cols,
                                     skip_features=start, max_features=slice_size)
        part = process_slice(gdf, f, munis)
        parts.append(part)
        log.info("  %d/%d lues, %d résidentielles gardées", min(start + slice_size, total), total, len(part))
    units = pd.concat(parts, ignore_index=True)
    log.info("rôle : %d unités résidentielles", len(units))
    return units


__all__ = ["load_role", "map_fields", "classify", "TYPE_LABELS", "re"]
