"""Limites des municipalités du Québec.

Source principale : Découpages administratifs du Québec (MRNF, Données Québec), 1/100 000.
Source de rechange : subdivisions de recensement 2021 (Statistique Canada).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import geopandas as gpd
import pandas as pd

from common import WORK, ckan_resources, download, log, muni_code, norm, pick_resource, unzip

CSD_URL = ("https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/"
           "boundary-limites/files-fichiers/lcsd000b21a_e.zip")
SDA_DATASET = "decoupages-administratifs"


def _from_sda() -> gpd.GeoDataFrame:
    res = ckan_resources(SDA_DATASET)
    r = (pick_resource(res, ["100 000"], fmt="SHP") or pick_resource(res, ["100 000"])
         or pick_resource(res, ["20 000"], fmt="SHP"))
    if r is None:
        raise RuntimeError("Découpages administratifs introuvables")
    z = download(r["url"], WORK / "sda.zip", timeout=600)
    folder = unzip(z, WORK / "sda")
    shps = sorted(folder.rglob("*.shp"), key=lambda p: ("munic" not in p.name.lower(), len(p.name)))
    if not shps:
        raise RuntimeError("Aucun fichier SHP dans les découpages administratifs")
    shp = shps[0]
    log.info("découpages administratifs : couche %s", shp.name)
    gdf = gpd.read_file(shp)
    cols = list(gdf.columns)
    code_col = next((c for c in cols if "co_geo" in c.lower()), None)
    if code_col is None:  # colonne dont les valeurs ressemblent à des codes à 5 chiffres
        for c in cols:
            if c == "geometry":
                continue
            v = gdf[c].astype(str).str.strip()
            if (v.str.fullmatch(r"\d{5}").mean() or 0) > 0.9:
                code_col = c
                break
    name_col = next((c for c in cols if "nm_mun" in c.lower()), None) \
        or next((c for c in cols if "nom" in c.lower() or c.lower().endswith("_nm")), None)
    if code_col is None or name_col is None:
        raise RuntimeError(f"Champs non reconnus dans {shp.name} : {cols}")
    gdf = gdf.rename(columns={code_col: "uid", name_col: "nom"})
    return gdf


def _from_statcan() -> gpd.GeoDataFrame:
    z = download(CSD_URL, WORK / "lcsd000b21a_e.zip")
    folder = unzip(z, WORK / "csd")
    return gpd.read_file(next(folder.rglob("*.shp")))


def _normalise(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    cols = {c.lower(): c for c in gdf.columns}
    if "pruid" in cols:
        gdf = gdf[gdf[cols["pruid"]].astype(str) == "24"]
    if "uid" not in gdf.columns:
        uid = cols.get("csduid") or cols.get("code")
        name = cols.get("csdname") or cols.get("nom")
        gdf = gdf.rename(columns={uid: "uid", name: "nom"})
    gdf = gdf.copy()
    gdf["code"] = gdf["uid"].map(muni_code)
    gdf = gdf[gdf["code"].notna()][["code", "nom", "geometry"]]
    if gdf.crs is None:
        gdf = gdf.set_crs(4326)
    gdf = gdf.to_crs(4326)
    gdf["geometry"] = gdf.geometry.make_valid()
    return gdf.dissolve(by="code", as_index=False, aggfunc="first")


def load_boundaries(source: Path | None = None) -> gpd.GeoDataFrame | None:
    """Retourne les municipalités du Québec (EPSG:4326) avec `code` (5 chiffres) et `nom`."""
    if source is not None:
        gdf = _normalise(gpd.read_file(source))
    else:
        gdf = None
        for name, loader in (("Données Québec", _from_sda), ("Statistique Canada", _from_statcan)):
            try:
                gdf = _normalise(loader())
                log.info("limites municipales : %s", name)
                break
            except Exception as exc:  # noqa: BLE001
                log.warning("limites municipales indisponibles (%s) : %s", name, exc)
        if gdf is None:
            log.warning("aucune source officielle de limites : contours reconstruits à partir du rôle")
            return None
    log.info("limites : %d municipalités", len(gdf))
    return gdf


def from_units(units: pd.DataFrame, names: dict[str, str], cell: float = 0.004) -> gpd.GeoDataFrame:
    """Contours approximatifs des municipalités, reconstruits à partir des unités d'évaluation.

    Chaque cellule d'une grille d'environ 400 m est attribuée à la municipalité la plus
    représentée, puis les cellules sont fusionnées par municipalité et adoucies.
    Résultat : des zones habitées sans chevauchement, suffisantes pour la carte.
    """
    from shapely.geometry import box

    df = pd.DataFrame({
        "cx": (units["lon"] // cell).astype(int), "cy": (units["lat"] // cell).astype(int),
        "code": units["muni"].astype(str),
    })
    counts = df.groupby(["cx", "cy", "code"]).size().reset_index(name="n")
    best = counts.sort_values("n", ascending=False).drop_duplicates(["cx", "cy"])
    geoms = [box(x * cell, y * cell, (x + 1) * cell, (y + 1) * cell) for x, y in zip(best["cx"], best["cy"])]
    cells = gpd.GeoDataFrame({"code": best["code"].to_numpy()}, geometry=geoms, crs=4326)
    gdf = cells.dissolve(by="code", as_index=False)
    smooth = cell * 0.6
    gdf["geometry"] = gdf.geometry.buffer(smooth, 2).buffer(-smooth, 2).simplify(cell / 4)
    gdf["nom"] = gdf["code"].map(lambda c: names.get(c) or c)
    log.info("contours reconstruits à partir du rôle : %d municipalités, %d cellules", len(gdf), len(cells))
    return gdf[["code", "nom", "geometry"]]


def export_simplified(gdf: gpd.GeoDataFrame, dest: Path, props: dict[str, dict]) -> None:
    """Écrit un GeoJSON simplifié (léger pour la carte) avec quelques indicateurs."""
    tmp = WORK / "munis_full.geojson"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    g = gdf.copy()
    for key in ("v", "g", "y", "l", "p"):
        g[key] = g["code"].map(lambda c, k=key: props.get(c, {}).get(k))
    g.to_file(tmp, driver="GeoJSON")
    dest.parent.mkdir(parents=True, exist_ok=True)
    cmd = ["mapshaper", str(tmp), "-simplify", "4%", "keep-shapes", "weighted",
           "-o", "precision=0.0001", "format=geojson", str(dest)]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        log.warning("mapshaper indisponible (%s) : simplification avec shapely", exc)
        g["geometry"] = g.geometry.simplify(0.002, preserve_topology=True)
        g.to_file(dest, driver="GeoJSON")
    log.info("munis.geojson : %.1f Mo", dest.stat().st_size / 1e6)


__all__ = ["load_boundaries", "export_simplified", "norm", "pd"]
