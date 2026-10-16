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


# Tableaux du recensement 2021 au niveau des municipalités, publiés sur www150 (joignable depuis GitHub).
TABLES = {
    "98100057": "https://www150.statcan.gc.ca/n1/tbl/csv/98100057-eng.zip",  # revenu des ménages
    "98100259": "https://www150.statcan.gc.ca/n1/tbl/csv/98100259-eng.zip",  # logement selon le mode d'occupation
    "98100022": "https://www150.statcan.gc.ca/n1/tbl/csv/98100022-eng.zip",  # âge
}


def _col(df: pd.DataFrame, *needles: str) -> str | None:
    """Première colonne dont le nom contient tous les fragments (insensible à la casse)."""
    for c in df.columns:
        if all(n.lower() in c.lower() for n in needles):
            return c
    return None


def _norm(s: str) -> str:
    return str(s).replace("–", "-").replace("—", "-").strip().lower()


def _csd_rows(source: Path) -> pd.DataFrame:
    """Lignes des municipalités du Québec (DGUID 2021A0005 24xxxxx) d'un tableau www150."""
    z = zipfile.ZipFile(source)
    name = next(n for n in z.namelist() if n.endswith(".csv") and "metadata" not in n.lower())
    parts = []
    for ch in pd.read_csv(io.TextIOWrapper(z.open(name), encoding="utf-8-sig"), dtype=str, chunksize=200_000):
        parts.append(ch[ch["DGUID"].astype(str).str.contains("A000524", na=False)])
    df = pd.concat(parts) if parts else pd.DataFrame()
    df["code"] = df["DGUID"].astype(str).str.split("A0005").str[-1].map(muni_code)
    return df


def _pick(df: pd.DataFrame, **filters: str) -> pd.DataFrame:
    """Filtre sur des dimensions désignées par un fragment de leur nom de colonne."""
    for frag, val in filters.items():
        c = _col(df, frag.replace("_", " "))
        if c is None:
            return df.iloc[0:0]
        df = df[df[c].map(_norm).str.startswith(_norm(val))]
    return df


def _num(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def parse_income(source: Path) -> dict[str, dict]:
    df = _csd_rows(source)
    df = _pick(df, **{"Household size": "Total - Households by household size",
                      "Household type": "Total - Household type"})
    c21 = _col(df, "Median household total income (2020)")
    c15 = _col(df, "Median household total income (2015)")
    cn = _col(df, "Number of households (2021)")
    out = {}
    for _, r in df.iterrows():
        rec = {}
        v = _num(pd.Series([r.get(c21)])).iloc[0] if c21 else None
        if pd.notna(v) and v > 0:
            rec["revenuMenage"] = float(v)
            v15 = _num(pd.Series([r.get(c15)])).iloc[0] if c15 else None
            if pd.notna(v15) and v15 > 0:
                rec["croissanceRevenu"] = round(float(100 * (v / v15 - 1)), 1)  # 2015 à 2020, dollars constants
        n = _num(pd.Series([r.get(cn)])).iloc[0] if cn else None
        if pd.notna(n) and n > 0:
            rec["menages"] = float(n)
        if rec and r["code"]:
            out[r["code"]] = rec
    return out


def parse_tenure(source: Path) -> dict[str, dict]:
    df = _csd_rows(source)
    yc = _col(df, "Census year")
    if yc:
        df = df[df[yc].astype(str).str.strip() == "2021"]
    ic = _col(df, "Housing indicators")
    co, cr, ct = _col(df, "Owner"), _col(df, "Renter"), _col(df, "Total - Tenure")
    out: dict[str, dict] = {}
    if not ic:
        return out
    labels = {
        "total - housing indicators": ("proprietaires", "locataires", None),
        "percent of households in unaffordable housing": ("pctInabordableProprio", "pctInabordableLocataire", "pctInabordable"),
        "percent of households in core housing need": (None, None, "pctBesoinImperieux"),
    }
    for _, r in df.iterrows():
        key = labels.get(_norm(r[ic]))
        if not key or not r["code"]:
            continue
        d = out.setdefault(r["code"], {})
        for col, k in zip((co, cr, ct), key):
            if k and col:
                v = pd.to_numeric(r.get(col), errors="coerce")
                if pd.notna(v):
                    d[k] = float(v)
    for d in out.values():
        tot = (d.get("proprietaires") or 0) + (d.get("locataires") or 0)
        if tot:
            d["pctProprio"] = round(100 * (d.get("proprietaires") or 0) / tot, 1)
    return out


def parse_age(source: Path) -> dict[str, dict]:
    df = _csd_rows(source)
    yc = _col(df, "Census year")
    if yc:
        df = df[df[yc].astype(str).str.strip() == "2021"]
    ac = _col(df, "Age (in single years)")
    tc = _col(df, "Total - Gender") or _col(df, "Total - Sex")
    out: dict[str, dict] = {}
    if not ac or not tc:
        return out
    for code, g in df.groupby("code"):
        if not code:
            continue
        vals = {_norm(a): pd.to_numeric(v, errors="coerce") for a, v in zip(g[ac], g[tc])}

        def first(prefix):
            v = next((x for k, x in vals.items() if k.startswith(prefix)), None)
            return float(v) if v is not None and pd.notna(v) else None
        d = {}
        if (v := first("average age")) is not None:
            d["ageMoyen"] = v
        if (v := first("median age")) is not None:
            d["ageMedian"] = v
        tot = vals.get("total - age")
        p65 = vals.get("65 years and over")
        if tot and pd.notna(tot) and p65 is not None and pd.notna(p65):
            d["pct65"] = round(float(100 * p65 / tot), 1)
        if d:
            out[code] = d
    return out


PARSERS = {"98100057": parse_income, "98100259": parse_tenure, "98100022": parse_age}


def load_www150(sources: dict[str, Path] | None = None) -> dict[str, dict]:
    """Population + revenu + mode d'occupation + âge, chaque tableau étant facultatif."""
    sources = sources or {}
    try:
        out = load_population_table(sources.get("98100002"))
    except Exception as exc:  # noqa: BLE001
        log.warning("tableau de population indisponible : %s", exc)
        out = {}
    for pid, parser in PARSERS.items():
        try:
            src = sources.get(pid) or download(TABLES[pid], WORK / f"census_{pid}.zip", timeout=300, retries=2)
            part = parser(src)
        except Exception as exc:  # noqa: BLE001 — chaque tableau enrichit, aucun n'est essentiel
            log.warning("tableau %s du recensement indisponible : %s", pid, exc)
            continue
        for code, d in part.items():
            out.setdefault(code, {}).update(d)
        log.info("recensement, tableau %s : %d municipalités", pid, len(part))
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
            log.warning("profil du recensement inaccessible (%s) ; repli sur les tableaux www150", exc)
            return load_www150()
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
