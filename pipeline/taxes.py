"""Taux de taxe foncière résidentielle par municipalité (prévisions budgétaires du MAMH).

Fichier « Données prévisionnelles non auditées, simple occurrence » (rapport financier des
organismes municipaux). Les colonnes CPALB… sont les taux adoptés, en dollars par 100 $
d'évaluation. Taux résidentiel = taxe foncière générale + taxes spéciales (dette,
fonctionnement, investissement), chacune au taux unique ou, à défaut, au taux de la catégorie
résiduelle (résidentielle et autres). Les taxes d'arrondissement, tarifs et taxes scolaires
ne sont pas inclus.
"""
from __future__ import annotations

import csv
import io
from datetime import date
from pathlib import Path

from common import WORK, download, log, muni_code

URL = "https://mamh.gouv.qc.ca/fichiersdonneesouvertes/Données-prévisionnelles-non-auditées-{an}-SimpleOccurrence.csv"
# (taux unique, taux résiduel) pour chaque composante
COMPOSANTES = [("CPALB01724", "CPALB01726"), ("CPALB01736", "CPALB01738"),
               ("CPALB01747", "CPALB01749"), ("CPALB01758", "CPALB01760")]


def _f(x: str | None) -> float:
    try:
        return float(str(x).replace(",", ".")) if x not in (None, "") else 0.0
    except ValueError:
        return 0.0


def parse(path: Path, annee: int) -> dict[str, dict]:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            txt = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    out = {}
    for row in csv.DictReader(io.StringIO(txt)):
        code = muni_code(row.get("cod_geo"))
        if not code:
            continue
        taux = 0.0
        for unique, residuel in COMPOSANTES:
            v = _f(row.get(unique)) or _f(row.get(residuel))
            taux += v
        # Garde-fou : un taux résidentiel plausible se situe entre 0,1 $ et 3 $ par 100 $.
        if 0.1 <= taux <= 3:
            out[code] = {"tauxResidentiel": round(taux, 4), "annee": annee}
    return out


def load_taxes(source: Path | None = None, annee: int | None = None) -> dict[str, dict]:
    if source is not None:
        return parse(source, annee or date.today().year)
    an = date.today().year
    for a in (an + 1, an, an - 1):
        try:
            path = download(URL.format(an=a), WORK / f"taxes_{a}.csv", timeout=300, retries=1)
            data = parse(path, a)
            if len(data) > 100:
                log.info("taux de taxe foncière %d : %d municipalités", a, len(data))
                return data
        except Exception as exc:  # noqa: BLE001
            log.info("prévisions budgétaires %d indisponibles (%s)", a, exc)
    log.warning("taux de taxe foncière indisponibles : estimation par défaut")
    return {}
