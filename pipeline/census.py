"""Profil du recensement 2021 par municipalité (subdivision de recensement), Québec."""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pandas as pd

from common import WORK, download, log, muni_code

URL = ("https://www12.statcan.gc.ca/census-recensement/2021/dp-pd/prof/details/"
       "download-telecharger/comp/GetFile.cfm?Lang=E&FILETYPE=CSV&GEONO=020")

# Nom exact de la caractéristique -> clé de sortie. Pour les noms répétés
# (« Owner », « Movers »…), on prend la première occurrence.
TARGETS = {
    "Population, 2021": "pop2021",
    "Population, 2016": "pop2016",
    "Population percentage change, 2016 to 2021": "croissancePop",
    "Population density per square kilometre": "densite",
    "Average age of the population": "ageMoyen",
    "65 years and over": "pop65",
    "Median total income of household in 2020 ($)": "revenuMenage",
    "Owner": "proprietaires",
    "Renter": "locataires",
    "Median monthly shelter costs for owned dwellings ($)": "coutProprio",
    "Median monthly shelter costs for rented dwellings ($)": "loyerMedian2021",
    "Median value of dwellings ($)": "valeurDeclaree2021",
    "Total - Mobility status 1 year ago - 25% sample data": "mobTotal",
    "Movers": "demenageurs",
}


def _open_csv(path: Path) -> io.TextIOBase | Path:
    if zipfile.is_zipfile(path):
        z = zipfile.ZipFile(path)
        names = [n for n in z.namelist() if n.lower().endswith(".csv")]
        data = [n for n in names if "data" in n.lower()] or names
        return io.TextIOWrapper(z.open(data[0]), encoding="latin-1")
    return path


POP_TABLE = "https://www150.statcan.gc.ca/n1/tbl/csv/98100002-eng.zip"  # serveur joignable depuis GitHub


def load_population_table(source: Path | None = None) -> dict[str, dict]:
    """Repli : population 2016-2021 et densité par municipalité (tableau 98-10-0002)."""
    source = source or download(POP_TABLE, WORK / "pop_98100002.zip", timeout=300)
    z = zipfile.ZipFile(source)
    name = next(n for n in z.namelist() if n.endswith(".csv") and "metadata" not in n.lower())
    df = pd.read_csv(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"), dtype=str)
    member = next(c for c in df.columns if "dwelling counts" in c.lower() or "chiffres de population" in c.lower())
    wanted = {
        "Population, 2021": "pop2021", "Population, 2016": "pop2016",
        "Population percentage change, 2016 to 2021": "croissancePop",
        "Population density per square kilometre": "densite",
    }
    df = df[df[member].str.strip().isin(wanted) & df["DGUID"].str.contains("A0005", na=False)]
    out: dict[str, dict] = {}
    for dguid, m, v in zip(df["DGUID"], df[member].str.strip(), pd.to_numeric(df["VALUE"], errors="coerce")):
        sgc = dguid.split("A0005")[-1]
        if not sgc.startswith("24") or pd.isna(v):
            continue
        out.setdefault(sgc[2:7], {})[wanted[m]] = float(v)
    log.info("population (tableau 98-10-0002) : %d municipalités", len(out))
    return out


def load_census(source: Path | None = None) -> dict[str, dict]:
    if source is None:
        try:
            source = download(URL, WORK / "census_qc_csd.bin", timeout=300)
        except Exception as exc:  # noqa: BLE001
            log.warning("profil du recensement inaccessible (%s) ; repli sur le tableau de population", exc)
            return load_population_table()
    handle = _open_csv(source)
    usecols = ["ALT_GEO_CODE", "GEO_LEVEL", "CHARACTERISTIC_ID", "CHARACTERISTIC_NAME", "C1_COUNT_TOTAL"]
    df = pd.read_csv(handle, usecols=lambda c: c in usecols, encoding="latin-1", dtype=str, low_memory=False)
    df["CHARACTERISTIC_NAME"] = df["CHARACTERISTIC_NAME"].str.strip()
    df = df[df["CHARACTERISTIC_NAME"].isin(TARGETS)]
    if "GEO_LEVEL" in df:
        df = df[df["GEO_LEVEL"].str.contains("subdivision", case=False, na=False)]
    df["CHARACTERISTIC_ID"] = pd.to_numeric(df["CHARACTERISTIC_ID"], errors="coerce")
    df["val"] = pd.to_numeric(df["C1_COUNT_TOTAL"], errors="coerce")
    df = df.sort_values("CHARACTERISTIC_ID").drop_duplicates(["ALT_GEO_CODE", "CHARACTERISTIC_NAME"])
    out: dict[str, dict] = {}
    for (geo, name), val in zip(zip(df["ALT_GEO_CODE"], df["CHARACTERISTIC_NAME"]), df["val"]):
        code = muni_code(geo)
        if code is None or pd.isna(val):
            continue
        out.setdefault(code, {})[TARGETS[name]] = float(val)
    for d in out.values():
        pop = d.get("pop2021")
        if pop and d.get("pop65") is not None:
            d["pct65"] = round(100 * d.pop("pop65") / pop, 1)
        tot = (d.get("proprietaires") or 0) + (d.get("locataires") or 0)
        if tot:
            d["pctProprio"] = round(100 * (d.get("proprietaires") or 0) / tot, 1)
        if d.get("mobTotal") and d.get("demenageurs") is not None:
            d["pctDemenage1an"] = round(100 * d.pop("demenageurs") / d.pop("mobTotal"), 1)
        d.pop("mobTotal", None)
        d.pop("demenageurs", None)
    log.info("recensement : %d municipalités", len(out))
    return out
