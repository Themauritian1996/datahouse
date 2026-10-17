"""Indicateurs de marché : indice des loyers (IPC), loyers affichés et taux hypothécaire."""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pandas as pd

from common import WORK, download, get_json, log, norm

CPI_URL = "https://www150.statcan.gc.ca/n1/tbl/csv/18100004-eng.zip"     # IPC mensuel
ASK_URL = "https://www150.statcan.gc.ca/n1/tbl/csv/46100092-eng.zip"     # loyers trimestriels
BOC_URL = "https://www.bankofcanada.ca/valet/observations/V80691335/json?recent=1"


def _table_csv(path: Path):
    z = zipfile.ZipFile(path)
    name = next(n for n in z.namelist() if n.endswith(".csv") and "metadata" not in n.lower())
    return io.TextIOWrapper(z.open(name), encoding="utf-8-sig")


def rent_cpi_factor(path: Path | None = None) -> dict:
    """Croissance de l'IPC « Loyer » au Québec depuis mai 2021 (mois du recensement)."""
    try:
        path = path or download(CPI_URL, WORK / "cpi.zip", timeout=600)
        keep = []
        for chunk in pd.read_csv(_table_csv(path), chunksize=200_000, dtype=str):
            prod = next(c for c in chunk.columns if "product" in c.lower())
            sub = chunk[(chunk["GEO"] == "Quebec") & (chunk[prod].str.strip() == "Rent")]
            keep.append(sub[["REF_DATE", "VALUE"]])
        df = pd.concat(keep)
        df["VALUE"] = pd.to_numeric(df["VALUE"], errors="coerce")
        df = df.dropna().sort_values("REF_DATE")
        base = df[df["REF_DATE"] == "2021-05"]["VALUE"].iloc[0]
        last = df.iloc[-1]
        f = float(last["VALUE"] / base)
        log.info("IPC loyer Québec : x%.3f depuis 2021-05 (%s)", f, last["REF_DATE"])
        return {"facteur": round(f, 4), "depuis": "2021-05", "jusqua": last["REF_DATE"]}
    except Exception as exc:  # noqa: BLE001
        log.warning("IPC loyer indisponible : %s", exc)
        return {"facteur": None}


QC_CMA = ("montreal", "quebec,", "gatineau", "sherbrooke", "saguenay", "trois-rivieres", "drummondville",
          "granby", "saint-jean-sur-richelieu", "rimouski", "saint-hyacinthe", "joliette", "victoriaville")


def asking_rents(path: Path | None = None) -> dict:
    """Loyers affichés moyens d'un appartement de 2 chambres, par région métropolitaine du Québec."""
    try:
        path = path or download(ASK_URL, WORK / "asking.zip", timeout=300)
        df = pd.read_csv(_table_csv(path), dtype=str)
        unit = next(c for c in df.columns if "unit type" in c.lower())
        est = next((c for c in df.columns if c.lower() == "estimates"), None)
        df = df[df[unit].str.strip().str.lower() == "apartment - 2 bedrooms"]
        if est:
            df = df[df[est].str.contains("asking rent", case=False, na=False)]
        g = df["GEO"].astype(str).map(norm)
        quebec = g.map(lambda x: any(k in x for k in QC_CMA) and "ontario part" not in x).astype(bool)
        df = df[quebec.to_numpy()].copy()
        df["VALUE"] = pd.to_numeric(df["VALUE"], errors="coerce")
        df = df.dropna(subset=["VALUE"])
        latest = df["REF_DATE"].max()
        df = df[df["REF_DATE"] == latest]
        out = {}
        for geo, val in zip(df["GEO"], df["VALUE"]):
            out.setdefault(norm(geo.split(",")[0]), round(float(val)))
        log.info("loyers affichés (%s) : %s", latest, out)
        return {"periode": latest, "deuxChambres": out}
    except Exception as exc:  # noqa: BLE001
        log.warning("loyers affichés indisponibles : %s", exc)
        return {"periode": None, "deuxChambres": {}}


def mortgage_rate() -> dict:
    try:
        data = get_json(BOC_URL)
        obs = data["observations"][-1]
        val = float(obs["V80691335"]["v"])
        log.info("taux hypothécaire affiché 5 ans : %.2f %% (%s)", val, obs["d"])
        return {"tauxAffiche5ans": val, "date": obs["d"]}
    except Exception as exc:  # noqa: BLE001
        log.warning("taux Banque du Canada indisponible : %s", exc)
        return {"tauxAffiche5ans": None, "date": None}


VAC_URL = "https://www150.statcan.gc.ca/n1/tbl/csv/34100127-eng.zip"    # SCHL : taux d'inoccupation (RMR)
LOYM_URL = "https://www150.statcan.gc.ca/n1/tbl/csv/34100133-eng.zip"   # SCHL : loyers moyens (RMR et AR)
LFS_URL = "https://www150.statcan.gc.ca/n1/tbl/csv/14100387-eng.zip"    # EPA par région économique


def _geo_key(geo: str) -> str | None:
    g = str(geo)
    if "Quebec" not in g and "Québec" not in g:
        return None
    if "Ontario part" in g or "excluding" in g:
        return None
    base = g.split(",")[0]
    if base.lower().startswith("ottawa-gatineau"):
        base = "Gatineau"
    return norm(base)


def schl_rentals(vac_path: Path | None = None, loy_path: Path | None = None) -> dict:
    """Taux d'inoccupation (RMR) et loyers moyens d'un 2 chambres (RMR et agglomérations), enquête SCHL."""
    out = {"inoccupation": {}, "loyer2ch": {}, "anneeInoccupation": None, "anneeLoyer": None}
    try:
        df = pd.read_csv(_table_csv(vac_path or download(VAC_URL, WORK / "schl_inoccupation.zip", timeout=300)), dtype=str)
        df["VALUE"] = pd.to_numeric(df["VALUE"], errors="coerce")
        df = df.dropna(subset=["VALUE"])
        an = df["REF_DATE"].max()
        for geo, v in zip(df[df["REF_DATE"] == an]["GEO"], df[df["REF_DATE"] == an]["VALUE"]):
            k = _geo_key(geo)
            if k:
                out["inoccupation"][k] = float(v)
        out["anneeInoccupation"] = an
        log.info("inoccupation SCHL %s : %d régions", an, len(out["inoccupation"]))
    except Exception as exc:  # noqa: BLE001
        log.warning("taux d'inoccupation indisponibles : %s", exc)
    try:
        df = pd.read_csv(_table_csv(loy_path or download(LOYM_URL, WORK / "schl_loyers.zip", timeout=300)), dtype=str)
        st = next(c for c in df.columns if "type of structure" in c.lower())
        un = next(c for c in df.columns if "type of unit" in c.lower())
        df = df[(df[st].str.strip() == "Row and apartment structures of three units and over") & (df[un].str.strip() == "Two bedroom units")]
        df["VALUE"] = pd.to_numeric(df["VALUE"], errors="coerce")
        df = df.dropna(subset=["VALUE"])
        an = df["REF_DATE"].max()
        cur = df[df["REF_DATE"] == an]
        for geo, v in zip(cur["GEO"], cur["VALUE"]):
            k = _geo_key(geo)
            if k:
                out["loyer2ch"][k] = round(float(v))
        out["anneeLoyer"] = an
        log.info("loyers moyens SCHL %s : %d centres", an, len(out["loyer2ch"]))
    except Exception as exc:  # noqa: BLE001
        log.warning("loyers moyens SCHL indisponibles : %s", exc)
    return out


def labour_force(path: Path | None = None) -> dict:
    """Taux de chômage et d'emploi par région économique du Québec (moyenne mobile de 3 mois)."""
    try:
        path = path or download(LFS_URL, WORK / "epa_regions.zip", timeout=600)
        keep = []
        for ch in pd.read_csv(_table_csv(path), chunksize=200_000, dtype=str):
            lfc = next(c for c in ch.columns if "labour force characteristics" in c.lower())
            stc = next((c for c in ch.columns if c.lower() == "statistics"), None)
            sub = ch[ch["GEO"].str.endswith(", Quebec", na=False) & ch[lfc].isin(["Unemployment rate", "Employment rate", "Participation rate"])]
            if stc:
                sub = sub[sub[stc] == "Estimate"]
            keep.append(sub[["REF_DATE", "GEO", lfc, "VALUE"]].rename(columns={lfc: "car"}))
        df = pd.concat(keep)
        df["VALUE"] = pd.to_numeric(df["VALUE"], errors="coerce")
        last = df["REF_DATE"].max()
        y, m = last.split("-")
        avant = f"{int(y) - 1}-{m}"
        out = {}
        for geo, g in df.groupby("GEO"):
            cur = g[g["REF_DATE"] == last].set_index("car")["VALUE"]
            prev = g[g["REF_DATE"] == avant].set_index("car")["VALUE"]
            rec = {"periode": last, "region": geo.replace(", Quebec", "")}
            if "Unemployment rate" in cur:
                rec["chomage"] = float(cur["Unemployment rate"])
                if "Unemployment rate" in prev:
                    rec["chomageVar"] = round(float(cur["Unemployment rate"] - prev["Unemployment rate"]), 1)
            if "Employment rate" in cur:
                rec["tauxEmploi"] = float(cur["Employment rate"])
            if "Participation rate" in cur:
                rec["activite"] = float(cur["Participation rate"])
            for part in geo.replace(", Quebec", "").split(" and "):
                out[norm(part)] = rec
        log.info("EPA régions (%s) : %s", last, sorted(out))
        return out
    except Exception as exc:  # noqa: BLE001
        log.warning("EPA régionale indisponible : %s", exc)
        return {}
