"""Zone inondable de chaque unité d'évaluation (Base de données des zones inondables du Québec).

Valeurs : 2 = zone de grand courant (récurrence 0-20 ans), 1 = zone de faible courant (20-100 ans)
ou autre zone inondable, 0 = hors des zones cartographiées. La BDZI ne couvre pas tous les cours
d'eau ni toutes les cartes municipales : « 0 » signifie « aucune zone connue ».
"""
from __future__ import annotations

import geopandas as gpd
import numpy as np
import pandas as pd
import pyogrio

from common import WORK, download, log, unzip

URL = "https://stqc380donopppdtce01.blob.core.windows.net/donnees-ouvertes/Base_donnees_zones_inondables/BDZI_GPK.zip"


def charger_zones(gpkg=None) -> gpd.GeoDataFrame:
    if gpkg is None:
        dossier = unzip(download(URL, WORK / "bdzi.zip", timeout=1800), WORK / "bdzi")
        gpkg = next(dossier.rglob("*.gpkg"))
    z = pyogrio.read_dataframe(gpkg, layer="ZOI_s", columns=["Description", "Etat"])
    z = z[z["Etat"].astype(str).str.lower().str.startswith("actif")]
    d = z["Description"].astype(str).str.lower()
    z["zi"] = np.where(d.str.contains("grand courant"), 2, 1)
    z = z[["zi", "geometry"]].to_crs(4326)
    z["geometry"] = z.geometry.make_valid()
    log.info("zones inondables : %d polygones (grand courant : %d)", len(z), int((z["zi"] == 2).sum()))
    return z


def zones_pour(units: pd.DataFrame, zones: gpd.GeoDataFrame | None = None) -> pd.Series:
    zones = charger_zones() if zones is None else zones
    pts = gpd.GeoDataFrame({"i": np.arange(len(units))}, geometry=gpd.points_from_xy(units["lon"], units["lat"]), crs=4326)
    j = gpd.sjoin(pts, zones, how="inner", predicate="within")
    best = j.groupby("i")["zi"].max()
    out = np.zeros(len(units), dtype=np.int8)
    out[best.index.to_numpy()] = best.to_numpy()
    log.info("propriétés en zone inondable : %d (grand courant : %d)", int((out > 0).sum()), int((out == 2).sum()))
    return pd.Series(out, index=units.index)
