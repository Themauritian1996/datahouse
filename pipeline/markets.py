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


def asking_rents(path: Path | None = None) -> dict:
    """Loyers affichés moyens (2 chambres, appartements) par région métropolitaine du Québec."""
    try:
        path = path or download(ASK_URL, WORK / "asking.zip", timeout=300)
        df = pd.read_csv(_table_csv(path), dtype=str)
        cols = {norm(c): c for c in df.columns}
        bed = next((cols[c] for c in cols if "bedroom" in c), None)
        unit = next((cols[c] for c in cols if "unit type" in c or "rental unit" in c), None)
        df = df[df["GEO"].str.contains("Quebec", na=False)]
        if bed:
            df = df[df[bed].str.contains("2 bedroom", case=False, na=False)]
        if unit:
            apt = df[unit].str.contains("apartment", case=False, na=False)
            if apt.any():
                df = df[apt]
        df["VALUE"] = pd.to_numeric(df["VALUE"], errors="coerce")
        df = df.dropna(subset=["VALUE"])
        latest = df["REF_DATE"].max()
        df = df[df["REF_DATE"] == latest]
        out = {}
        for geo, val in zip(df["GEO"], df["VALUE"]):
            key = norm(geo.split(",")[0])
            out.setdefault(key, round(float(val)))
        log.info("loyers affichés (%s) : %d régions", latest, len(out))
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
