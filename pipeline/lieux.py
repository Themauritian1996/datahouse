"""Lieux d'intérêt publiés par le gouvernement du Québec, exportés en petits fichiers statiques.

- Écoles primaires et secondaires (publiques et privées) du ministère de l'Éducation, avec, pour
  les écoles publiques, le rang décile de l'indice de milieu socio-économique (IMSE, 1 = le plus
  favorisé, 10 = le plus défavorisé) publié par le ministère.
- Répertoire des terrains contaminés (ministère de l'Environnement) : emplacement et état de
  réhabilitation.

Les points sont regroupés par cellule de 0,05° (environ 4 × 5 km) pour un chargement à la demande.
"""
from __future__ import annotations

import csv
import io
import math
from pathlib import Path

import pyogrio

from common import WORK, download, log, unzip, write_json

ECOLES_URL = ("https://www.donneesquebec.ca/recherche/dataset/2d3b5cf8-b347-49c7-ad3b-bd6a9c15e443/resource/"
              "2ae11c05-03b2-4006-bdb2-a49a4fa41c23/download/etablissements-meq-mes-esrishp.zip")
IMSE_URLS = [
    "https://www.donneesquebec.ca/recherche/dataset/004de02c-19f1-4da0-9af8-33f893e41972/resource/6c5d4a5d-ba3b-40a6-b570-916f43ab622c/download/defav_ecole_prim_public.csv",
    "https://www.donneesquebec.ca/recherche/dataset/004de02c-19f1-4da0-9af8-33f893e41972/resource/3e9aa43a-c32b-4779-b258-8407db716813/download/defav_ecole_sec_public.csv",
]
GTC_URL = ("https://stqc380donopppdtce01.blob.core.windows.net/donnees-ouvertes/Repertoire_terrains_contamines/"
           "RepertoireTerrainsContamines.gdb.zip")
CELL = 0.05


def cell_key(lat: float, lon: float) -> str:
    return f"{math.floor(lat / CELL)}_{math.floor(lon / CELL)}"


def _decode(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("latin-1", errors="replace")


def _imse(paths: list[Path]) -> dict[str, int]:
    out = {}
    for p in paths:
        for row in csv.DictReader(io.StringIO(_decode(p.read_bytes()))):
            try:
                rang = int(float(row.get("Rang_Decile_IMSE") or "nan"))
            except ValueError:
                continue
            if row.get("Code_Org"):
                out[row["Code_Org"].strip()] = rang
    return out


def _num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def load_ecoles(folder: Path | None = None, imse_paths: list[Path] | None = None) -> list[dict]:
    if folder is None:
        folder = unzip(download(ECOLES_URL, WORK / "ecoles_meq.zip", timeout=300), WORK / "ecoles_meq")
    if imse_paths is None:
        imse_paths = []
        for i, u in enumerate(IMSE_URLS):
            try:
                imse_paths.append(download(u, WORK / f"imse_{i}.csv", timeout=120))
            except Exception as exc:  # noqa: BLE001
                log.warning("IMSE indisponible (%s)", exc)
    rangs = _imse(imse_paths)
    ecoles, vus = [], set()
    for nom_couche, reseau in (("PPS_Public_Ecole", "public"), ("PPS_Prive_Installation", "prive"), ("PPS_Gouvernemental", "gouv")):
        shp = next(folder.rglob(f"{nom_couche}.shp"), None)
        if shp is None:
            continue
        df = pyogrio.read_dataframe(shp, read_geometry=False)
        for r in df.to_dict("records"):
            prim, sec = int(_num(r.get("PRIM")) or 0), int(_num(r.get("SEC")) or 0)
            if not (prim or sec):
                continue  # formation professionnelle ou aux adultes seulement
            lat, lon = _num(r.get("COORD_Y_LL")), _num(r.get("COORD_X_LL"))
            if lat is None or lon is None:
                continue
            nom = r.get("NOM_CRT_O") or r.get("NOM_IMM") or r.get("NOM_COURT") or r.get("NOM_OFFCL") or ""
            k = (round(lat, 4), round(lon, 4), nom)
            if k in vus:
                continue
            vus.add(k)
            code = str(r.get("CD_ORGNS") or "").strip()
            e = {"n": str(nom).strip(), "la": round(lat, 5), "lo": round(lon, 5), "r": reseau,
                 "p": prim, "s": sec, "pre": int(_num(r.get("PRESC")) or 0)}
            if r.get("TYPE_CS") in ("Anglo", "Franco"):
                e["l"] = "en" if r.get("TYPE_CS") == "Anglo" else "fr"
            if reseau == "public" and code in rangs:
                e["imse"] = rangs[code]
            web = r.get("SITE_WEB_O") or r.get("SITE_WEB")
            if isinstance(web, str) and web.startswith("http"):
                e["w"] = web
            ecoles.append(e)
    log.info("écoles primaires et secondaires : %d (IMSE pour %d)", len(ecoles), sum(1 for e in ecoles if "imse" in e))
    return ecoles


def load_terrains(gdb_folder: Path | None = None) -> list[dict]:
    if gdb_folder is None:
        gdb_folder = unzip(download(GTC_URL, WORK / "gtc.zip", timeout=300), WORK / "gtc")
    gdb = next(gdb_folder.rglob("*.gdb"))
    etats = {}
    try:
        det = pyogrio.read_dataframe(gdb, layer="detailsFiches", read_geometry=False)
        for r in det.to_dict("records"):
            etats.setdefault(str(r.get("NO_MEF_LIEU")), r.get("ETAT_REHAB"))
    except Exception as exc:  # noqa: BLE001
        log.warning("fiches des terrains contaminés illisibles : %s", exc)
    out = []
    for couche in ("point", "surface", "multipoint", "ligne"):
        try:
            df = pyogrio.read_dataframe(gdb, layer=couche, read_geometry=False)
        except Exception:  # noqa: BLE001
            continue
        for r in df.to_dict("records"):
            lat, lon = _num(r.get("LATITUDE")), _num(r.get("LONGITUDE"))
            if lat is None or lon is None:
                continue
            etat = etats.get(str(r.get("NO_MEF_LIEU"))) or ""
            out.append({"la": round(lat, 5), "lo": round(lon, 5), "a": str(r.get("ADR_CIV_LIEU") or "").strip()[:80],
                        "e": "termine" if "termin" in str(etat).lower() else ("non" if "non" in str(etat).lower() else "encours")})
    log.info("terrains contaminés : %d", len(out))
    return out


def export_par_cellule(items: list[dict], dossier: Path) -> int:
    cells: dict[str, list] = {}
    for it in items:
        cells.setdefault(cell_key(it["la"], it["lo"]), []).append(it)
    for k, v in cells.items():
        write_json(dossier / f"{k}.json", v)
    return len(cells)
