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
    """Repli : population 2016-2021 et densité par municipalité (tableau 98-10-0002, format large)."""
    source = source or download(POP_TABLE, WORK / "pop_98100002.zip", timeout=300)
    z = zipfile.ZipFile(source)
    name = next(n for n in z.namelist() if n.endswith(".csv") and "metadata" not in n.lower())
    df = pd.read_csv(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"), dtype=str)
    wanted = {
        "Population, 2021": "pop2021", "Population, 2016": "pop2016",
        "Population percentage change, 2016 to 2021": "croissancePop",
        "Population density per square kilometre": "densite",
    }
    colmap = {}
    for c in df.columns:
        label = c.split(":", 1)[-1].split("[")[0].strip()
        label = label.replace(", 2021", ", 2021") if label.startswith("Population") else label
        for w, k in wanted.items():
            if label == w or label == w + ", 2021":
                colmap[c] = k
    df = df[df["DGUID"].astype(str).str.contains("A000524", na=False)]
    out: dict[str, dict] = {}
    for _, row in df.iterrows():
        code = muni_code(str(row["DGUID"]).split("A0005")[-1])
        rec = {k: pd.to_numeric(row[c], errors="coerce") for c, k in colmap.items()}
        out[code] = {k: float(v) for k, v in rec.items() if pd.notna(v)}
    log.info("population (tableau 98-10-0002) : %d municipalités, colonnes %s", len(out), sorted(colmap.values()))
    return out


STATIC = Path(__file__).resolve().parent / "static" / "recensement_2021_csd_qc.json"


def extract_static(source: Path, dest: Path = STATIC) -> int:
    """Extrait une fois pour toutes le profil du recensement (fichier téléchargé à la main) en petit JSON."""
    from common import write_json
    data = load_census(source)
    write_json(dest, data, compact=False)
    return len(data)


def load_census(source: Path | None = None) -> dict[str, dict]:
    if source is None and STATIC.exists():
        import json
        data = json.loads(STATIC.read_text(encoding="utf-8"))
        log.info("recensement 2021 (fichier extrait du dépôt) : %d municipalités", len(data))
        return data
    if source is None:
        try:
            source = download(URL, WORK / "census_qc_csd.bin", timeout=300, retries=1)
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
