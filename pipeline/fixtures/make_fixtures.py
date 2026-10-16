"""Génère des données SIMULÉES au même format que les sources réelles.

Sert aux tests et au site de démonstration (bannière « données de démonstration »).
Les municipalités, codes et emplacements sont réels ; les valeurs ne le sont pas.
"""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from shapely.geometry import MultiPoint, Point, box

HERE = Path(__file__).resolve().parent
OUT = HERE / "_gen"

# code, nom, lon, lat, demi-largeur (deg), prix médian unifamilial simulé, MRC, région, CM, population
MUNIS = [
    ("66023", "Montréal", -73.60, 45.53, 0.07, 720000, "Montréal", "Montréal", "Montréal", 1762949),
    ("65005", "Laval", -73.72, 45.58, 0.06, 640000, "Laval", "Laval", "Montréal", 438366),
    ("58227", "Longueuil", -73.47, 45.52, 0.05, 590000, "Longueuil", "Montérégie", "Montréal", 254483),
    ("23027", "Québec", -71.26, 46.81, 0.07, 430000, "Québec", "Capitale-Nationale", "Québec", 549459),
    ("43027", "Sherbrooke", -71.90, 45.40, 0.06, 410000, "Sherbrooke", "Estrie", None, 172950),
    ("46058", "Sutton", -72.62, 45.10, 0.04, 520000, "Brome-Missisquoi", "Montérégie", None, 4548),
]
STREETS = ["Saint-Denis", "des Érables", "Principale", "Sherbrooke", "du Parc", "Laurier", "Beaubien",
           "de la Montagne", "Champlain", "des Pins", "Notre-Dame", "Saint-Laurent", "Papineau",
           "Jean-Talon", "de l'Église", "du Lac", "Fleury", "Masson", "Bélanger", "Rachel"]
GENS = ["RU", "AV", "BD", "CH", "RU", "RU"]


def _boundaries() -> Path:
    rows = []
    for code, nom, lon, lat, w, *_ in MUNIS:
        rows.append({"CSDUID": "24" + code, "CSDNAME": nom, "PRUID": "24",
                     "geometry": box(lon - w, lat - w * 0.7, lon + w, lat + w * 0.7)})
    path = OUT / "csd.geojson"
    gpd.GeoDataFrame(rows, crs=4326).to_file(path, driver="GeoJSON")
    return path


def _census() -> Path:
    rng = np.random.default_rng(3)
    names = ["Population, 2021", "Population, 2016", "Population percentage change, 2016 to 2021",
             "Population density per square kilometre", "Average age of the population", "65 years and over",
             "Median total income of household in 2020 ($)", "Owner", "Renter",
             "Median monthly shelter costs for owned dwellings ($)",
             "Median monthly shelter costs for rented dwellings ($)", "Median value of dwellings ($)",
             "Total - Mobility status 1 year ago - 25% sample data", "Movers"]
    rows = []
    for code, nom, lon, lat, w, prix, mrc, reg, cm, pop in MUNIS:
        p16 = int(pop / (1 + rng.uniform(-0.01, 0.08)))
        hh = pop / 2.2
        own = rng.uniform(0.35, 0.75)
        vals = [pop, p16, round(100 * (pop - p16) / p16, 1), round(rng.uniform(80, 4800), 1),
                round(rng.uniform(38, 47), 1), int(pop * rng.uniform(0.15, 0.27)),
                int(rng.uniform(58000, 92000)), int(hh * own), int(hh * (1 - own)),
                int(rng.uniform(1100, 1700)), int(rng.uniform(780, 1050)), int(prix * 0.75),
                int(pop * 0.98), int(pop * rng.uniform(0.08, 0.17))]
        for i, (n, v) in enumerate(zip(names, vals)):
            rows.append({"CENSUS_YEAR": 2021, "DGUID": "2021A0005" + "24" + code, "ALT_GEO_CODE": "24" + code,
                         "GEO_LEVEL": "Census subdivision", "GEO_NAME": nom, "CHARACTERISTIC_ID": i + 1,
                         "CHARACTERISTIC_NAME": ("  " + n) if n in ("Owner", "Renter") else n,
                         "C1_COUNT_TOTAL": v})
        # Doublon plus loin dans le profil (doit être ignoré) :
        rows.append({"CENSUS_YEAR": 2021, "DGUID": "x", "ALT_GEO_CODE": "24" + code,
                     "GEO_LEVEL": "Census subdivision", "GEO_NAME": nom, "CHARACTERISTIC_ID": 2000,
                     "CHARACTERISTIC_NAME": "Owner", "C1_COUNT_TOTAL": 1})
    path = OUT / "census.zip"
    buf = io.StringIO()
    pd.DataFrame(rows).to_csv(buf, index=False)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("98-401-X2021020_English_CSV_data.csv", buf.getvalue().encode("latin-1"))
    return path


def _rfu() -> dict[int, Path]:
    rng = np.random.default_rng(5)
    out = {}
    r25 = []
    r26 = []
    for code, nom, lon, lat, w, prix, mrc, reg, cm, pop in MUNIS:
        fc25 = round(rng.uniform(1.05, 1.30), 2)
        fc26 = round(fc25 * rng.uniform(1.02, 1.09), 2)
        if code in ("66023", "23027"):  # nouveau rôle en 2026 : facteur proche de 1
            fc25, fc26 = round(fc25 + 0.15, 2), round(rng.uniform(1.0, 1.06), 2)
        r25.append({"cod_geo": code, "nom_mun": nom, "population": pop, "facteur_comparatif": fc25,
                    "nom_mrc": mrc, "desc_reg": reg, "nom_cm": cm or ""})
        r26.append({"cod_geo": code, "nom_organisme": nom, "population": pop,
                    "CSALX02163": str(fc26).replace(".", ","), "nom_mrc": mrc, "desc_reg": reg, "nom_cm": cm or ""})
    out[2025] = OUT / "rfu_2025.csv"
    pd.DataFrame(r25).to_csv(out[2025], index=False)
    out[2026] = OUT / "rfu_2026.csv"
    pd.DataFrame(r26).to_csv(out[2026], index=False, sep=";")
    return out


def _table_zip(name: str, df: pd.DataFrame) -> Path:
    path = OUT / f"{name}.zip"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(f"{name}.csv", df.to_csv(index=False))
        z.writestr(f"{name}_MetaData.csv", "x\n")
    return path


def _cpi() -> Path:
    df = pd.DataFrame([
        {"REF_DATE": "2021-05", "GEO": "Quebec", "Products and product groups": "Rent", "VALUE": 140.0},
        {"REF_DATE": "2026-08", "GEO": "Quebec", "Products and product groups": "Rent", "VALUE": 171.5},
        {"REF_DATE": "2026-08", "GEO": "Canada", "Products and product groups": "Rent", "VALUE": 180.0},
    ])
    return _table_zip("18100004", df)


def _asking() -> Path:
    rows = []
    for d, geo, v in [("2026-04", "Montréal, Census metropolitan area (CMA)", 1990),
                      ("2026-04", "Québec, Census metropolitan area (CMA)", 1620),
                      ("2026-04", "Sherbrooke, Census metropolitan area (CMA)", 1450),
                      ("2026-04", "Ottawa - Gatineau (Ontario part), Census metropolitan area (CMA)", 2300),
                      ("2026-01", "Sherbrooke, Census metropolitan area (CMA)", 1400)]:
        rows.append({"REF_DATE": d, "GEO": geo, "Rental unit type": "Apartment - 2 bedrooms",
                     "Estimates": "Average asking rent", "VALUE": v})
        rows.append({"REF_DATE": d, "GEO": geo, "Rental unit type": "Apartment - 1 bedroom",
                     "Estimates": "Average asking rent", "VALUE": v - 300})
    return _table_zip("46100092", pd.DataFrame(rows))


def _gpkg(per_muni: int = 3500) -> Path:
    """GeoPackage au format réel du MAMH : positions + caractéristiques + adresses."""
    import pyogrio
    rng = np.random.default_rng(11)
    pts, ev, ad = [], [], []
    for code, nom, lon, lat, w, prix, *_ in MUNIS:
        n = per_muni if code != "46058" else 700
        ref = "2024-07-01" if code in ("66023", "23027") else "2023-07-01"
        i = 0
        while i < n:
            x = lon + rng.uniform(-w, w) * 0.95
            y = lat + rng.uniform(-w * 0.7, w * 0.7) * 0.95
            street = STREETS[int(abs(x * 1000)) % len(STREETS)]
            gen = GENS[int(abs(y * 1000)) % len(GENS)]
            no = int(rng.integers(10, 9000))
            kind = rng.choice(["U", "C", "P", "M", "H", "N"], p=[0.5, 0.14, 0.2, 0.06, 0.03, 0.07])
            annee = int(rng.integers(1900, 2025))
            dist = np.hypot(x - lon, y - lat) / w
            loc = (1.25 - 0.5 * dist) * rng.lognormal(0, 0.18)
            base_mat = f"{int(x * 1e4) % 10000:04d}{int(y * 1e4) % 100:02d}{no % 10000:04d}0"

            def add(mat, cubf, lg, aire, ter, lien, et, vr, va, app=None):
                pid = code + mat
                pts.append({"id_provinc": pid, "code_mun": code, "mat18": mat, "geometry": Point(x, y)})
                ev.append({"anrole": "2026", "id_provinc": pid, "code_mun": code, "mat18": mat,
                           "rl0105a": str(cubf), "rl0302a": ter, "rl0303a": "0", "rl0306a": et,
                           "rl0307a": str(annee), "rl0308a": aire, "rl0309a": str(lien) if lien else None,
                           "rl0311a": lg, "rl0402a": None, "rl0404a": vr, "rl0405a": va,
                           "dat_cond_mrche": ref})
                ad.append({"anrole": "2026", "id_provinc": pid, "code_mun": code, "mat18": mat, "no_seq_adr": 1,
                           "rl0101a": str(no), "rl0101b": None, "rl0101c": None, "rl0101e": gen, "rl0101f": None,
                           "rl0101g": street.upper(), "rl0101h": None, "rl0101i": app})
                if rng.random() < 0.05:  # adresse secondaire (doit être ignorée)
                    ad.append({**ad[-1], "no_seq_adr": 2, "rl0101a": str(no + 2)})

            if kind == "C":
                k = int(rng.integers(4, 24))
                for loc_no in range(1, k + 1):
                    aire = rng.uniform(55, 140)
                    vr = prix * 0.55 * (aire / 85) ** 0.85 * loc / 1.2
                    add(f"{base_mat}000{loc_no:04d}", 1000, 1, round(aire, 1), None, 5, 1, float(int(vr)),
                        float(int(vr / rng.uniform(1.15, 1.35))), app=str(100 + loc_no))
                    i += 1
                continue
            if kind == "N":
                add(f"{base_mat}0000000", 5811, 0, 300.0, 800.0, 1, 1, 900000.0, 800000.0)
                i += 1
                continue
            lg = {"U": 1, "P": int(rng.integers(2, 6)), "M": int(rng.integers(6, 24)), "H": 1}[kind]
            aire = {"U": rng.uniform(90, 260), "P": lg * rng.uniform(70, 105),
                    "M": lg * rng.uniform(60, 85), "H": rng.uniform(60, 160)}[kind]
            ter = rng.uniform(250, 1400) * (4 if kind == "H" else 1)
            vr = prix * (aire / 150) ** 0.8 * loc / 1.2 * (0.9 if kind in "PM" else 1)
            va = float(int(vr / rng.uniform(1.12, 1.4))) if rng.random() > 0.05 else None
            add(f"{base_mat}0000000", 1100 if kind == "H" else 1000, lg, round(aire, 1), round(ter, 1),
                int(rng.choice([1, 1, 1, 2, 3])), int(rng.integers(1, 4)), float(int(vr)), va)
            i += 1
    path = OUT / "role.gpkg"
    if path.exists():
        path.unlink()
    g = gpd.GeoDataFrame(pts, crs=4269)
    g["geometry"] = g.geometry.map(lambda p: MultiPoint([p]))
    g.to_file(path, layer="rol_unite_p_2026", driver="GPKG")
    pyogrio.write_dataframe(pd.DataFrame(ev), path, layer="b05v_unite_evaln_2026", driver="GPKG", append=False)
    pyogrio.write_dataframe(pd.DataFrame(ad), path, layer="b05v_adr_unite_evaln_2026", driver="GPKG")
    pyogrio.write_dataframe(pd.DataFrame(ev[:10])[["anrole", "id_provinc", "code_mun", "mat18"]], path,
                            layer="b05v_lot_cadst_2026", driver="GPKG")
    return path


def build() -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    return {"boundaries": _boundaries(), "census": _census(), "rfu": _rfu(),
            "cpi": _cpi(), "asking": _asking(), "gpkg": _gpkg()}


if __name__ == "__main__":
    print(build())
