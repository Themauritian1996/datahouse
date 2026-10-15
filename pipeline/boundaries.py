"""Limites des municipalités (subdivisions de recensement 2021, Statistique Canada)."""
from __future__ import annotations

import subprocess
from pathlib import Path

import geopandas as gpd

from common import WORK, download, log, muni_code, unzip

CSD_URL = ("https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/"
           "boundary-limites/files-fichiers/lcsd000b21a_e.zip")


def load_boundaries(source: Path | None = None) -> gpd.GeoDataFrame:
    """Retourne les municipalités du Québec (EPSG:4326) avec `code` (5 chiffres) et `nom`."""
    if source is None:
        z = download(CSD_URL, WORK / "lcsd000b21a_e.zip")
        folder = unzip(z, WORK / "csd")
        shp = next(folder.rglob("*.shp"))
        source = shp
    gdf = gpd.read_file(source)
    cols = {c.lower(): c for c in gdf.columns}
    if "pruid" in cols:
        gdf = gdf[gdf[cols["pruid"]].astype(str) == "24"]
    uid = cols.get("csduid") or cols.get("code")
    name = cols.get("csdname") or cols.get("nom")
    gdf = gdf.rename(columns={uid: "uid", name: "nom"})
    gdf["code"] = gdf["uid"].map(muni_code)
    gdf = gdf[["code", "nom", "geometry"]].to_crs(4326)
    # Les municipalités en plusieurs morceaux restent une seule entité.
    gdf = gdf.dissolve(by="code", as_index=False, aggfunc="first")
    log.info("limites : %d municipalités", len(gdf))
    return gdf


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
