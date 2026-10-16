"""Outils partagés du pipeline de données DataHouse."""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import time
import unicodedata
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
WORK = Path(os.environ.get("DATAHOUSE_WORK", ROOT / "_work"))
OUT = Path(os.environ.get("DATAHOUSE_OUT", ROOT / "_out"))
# Les archives extraites (plusieurs Go) restent hors du cache GitHub Actions.
EXTRACT = Path(os.environ.get("DATAHOUSE_EXTRACT", WORK / "extrait"))

CKAN = "https://www.donneesquebec.ca/recherche/api/3/action/package_show?id={id}"
# En-têtes de navigateur : certains serveurs publics (p. ex. Statistique Canada)
# refusent les clients qui ne s'identifient pas comme un navigateur.
UA = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/141.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-CA,fr;q=0.9,en;q=0.8",
}

log = logging.getLogger("datahouse")


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )


def _signature(headers) -> dict:
    return {k: headers.get(k) for k in ("ETag", "Last-Modified", "Content-Length") if headers.get(k)}


def download(url: str, dest: Path, retries: int = 3, timeout: int = 120) -> Path:
    """Télécharge un fichier avec reprises.

    Si le fichier est déjà présent (cache de la semaine précédente), une requête HEAD
    compare l'ETag, la date de modification et la taille : le fichier n'est
    retéléchargé que s'il a changé à la source.
    """
    dest.parent.mkdir(parents=True, exist_ok=True)
    sig_path = dest.with_suffix(dest.suffix + ".sig.json")
    if dest.exists() and dest.stat().st_size > 0:
        try:
            h = requests.head(url, timeout=30, headers=UA, allow_redirects=True)
            new_sig = _signature(h.headers) if h.ok else {}
        except Exception:  # noqa: BLE001
            new_sig = {}
        old_sig = read_json(sig_path, {})
        if not new_sig or new_sig == old_sig:
            log.info("inchangé à la source, réutilisé : %s", dest.name)
            return dest
        log.info("nouvelle version à la source : %s", dest.name)
        dest.unlink()
    tmp = dest.with_suffix(dest.suffix + ".part")
    for attempt in range(1, retries + 1):
        try:
            log.info("téléchargement %s (essai %d)", url, attempt)
            with requests.get(url, stream=True, timeout=(20, timeout), headers=UA) as r:
                r.raise_for_status()
                sig = _signature(r.headers)
                with open(tmp, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            tmp.rename(dest)
            write_json(sig_path, sig)
            log.info("ok : %s (%.1f Mo)", dest.name, dest.stat().st_size / 1e6)
            return dest
        except Exception as exc:  # noqa: BLE001
            log.warning("échec %s : %s", url, exc)
            time.sleep(5 * attempt)
    raise RuntimeError(f"Impossible de télécharger {url}")


def get_json(url: str, timeout: int = 60):
    r = requests.get(url, timeout=timeout, headers=UA)
    r.raise_for_status()
    return r.json()


def ckan_resources(dataset_id: str) -> list[dict]:
    """Liste les ressources d'un jeu de données de Données Québec (API CKAN)."""
    data = get_json(CKAN.format(id=dataset_id))
    return data["result"]["resources"]


def pick_resource(resources: list[dict], must: list[str], fmt: str | None = None,
                  exclude: list[str] | None = None) -> dict | None:
    """Choisit la ressource dont le nom contient tous les mots `must`, en
    préférant l'année la plus récente trouvée dans le nom."""
    exclude = exclude or []
    best, best_year = None, -1
    for res in resources:
        name = norm(res.get("name") or "")
        if not all(norm(m) in name for m in must):
            continue
        if any(norm(x) in name for x in exclude):
            continue
        if fmt and (res.get("format") or "").upper() != fmt.upper():
            continue
        years = [int(y) for y in re.findall(r"20\d\d", name)]
        year = max(years) if years else 0
        if year > best_year:
            best, best_year = res, year
    if best is not None:
        best = dict(best, _year=best_year)
    return best


def unzip(path: Path, dest: Path) -> Path:
    """Décompresse dans `dest` (hors du cache), sauf si cette archive y est déjà extraite."""
    dest = EXTRACT / dest.name
    marker = dest / ".source"
    stamp = f"{path.name}:{path.stat().st_size}:{int(path.stat().st_mtime)}"
    if marker.exists() and marker.read_text() == stamp:
        return dest
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    with zipfile.ZipFile(path) as z:
        z.extractall(dest)
    marker.write_text(stamp)
    return dest


def norm(s: str) -> str:
    """Minuscules sans accents, pour les comparaisons tolérantes."""
    s = unicodedata.normalize("NFKD", str(s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return s.lower().strip()


def clean(obj):
    """Remplace NaN/inf par null et convertit les types numpy (JSON valide)."""
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if hasattr(obj, "item") and not isinstance(obj, (str, bytes)):
        try:
            obj = obj.item()
        except (ValueError, AttributeError):
            pass
    if isinstance(obj, float) and (obj != obj or obj in (float("inf"), float("-inf"))):
        return None
    return obj


def write_json(path: Path, obj, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    obj = clean(obj)
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1, allow_nan=False)


def read_json(path: Path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def clean_dir(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True)


def muni_code(value) -> str | None:
    """Ramène un code géographique (SGC à 7 chiffres ou MAMH à 5) au code à 5 chiffres."""
    if value is None:
        return None
    raw = str(value).strip().upper()
    if re.fullmatch(r"[A-Z]{2}\d{3}", raw):  # territoires non organisés (p. ex. NR942)
        return raw
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None
    if len(digits) >= 7 and digits.startswith("24"):
        digits = digits[2:7]
    return digits[-5:].zfill(5)
