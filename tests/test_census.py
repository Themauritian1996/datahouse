"""Test des lecteurs de tableaux du recensement (format www150 de Statistique Canada).

python3 tests/test_census.py
"""
import io
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
import census  # noqa: E402


def zip_csv(path, name, header, rows):
    buf = io.StringIO()
    buf.write("﻿" + ",".join(f'"{h}"' for h in header) + "\n")
    for r in rows:
        buf.write(",".join(f'"{x}"' for x in r) + "\n")
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(name + ".csv", buf.getvalue())
        z.writestr(name + "_MetaData.csv", "x")
    return path


tmp = Path(tempfile.mkdtemp())
G = [("Montréal", "2021A00052466023"), ("Laval", "2021A00052465005"), ("Ottawa", "2021A00053506008")]

inc = zip_csv(tmp / "i.zip", "98100057", ["REF_DATE", "GEO", "DGUID", "Household size (7)",
    "Household type including census family structure (11)", "Coordinate",
    "Household income statistics (6):Number of households (2021)[1]", "Symbol",
    "Household income statistics (6):Median household total income (2020) (2020 constant dollars)[3]", "Symbol.2",
    "Household income statistics (6):Median household total income (2015) (2020 constant dollars)[4]", "Symbol.3"],
    [["2021", g, d, "Total - Households by household size", "Total – Household type including census family structure", "1", n, "", v, "", v15, ""]
     for (g, d), n, v, v15 in zip(G, [816335, 160000, 500000], [63600, 86000, 90000], [54400, 76000, 80000])]
    + [["2021", "Montréal", G[0][1], "1 person", "Total – Household type including census family structure", "2", 1, "", 1, "", 1, ""]])

ten_rows = []
for (g, d), (o, r) in zip(G, [(297335, 519015), (100000, 60000), (1, 1)]):
    ten_rows += [["2021", g, d, "2021", "Total - Housing indicators", "1", o + r, "", o, "", r, ""],
                 ["2021", g, d, "2021", "Percent of households in unaffordable housing", "1", 24.2, "", 18.0, "", 27.8, ""],
                 ["2021", g, d, "2016", "Total - Housing indicators", "1", 9, "", 9, "", 9, ""]]
ten = zip_csv(tmp / "t.zip", "98100259", ["REF_DATE", "GEO", "DGUID", "Census year (2)", "Housing indicators (9)", "Coordinate",
    "Tenure (4):Total - Tenure[1]", "Symbol", "Tenure (4):Owner[2]", "Symbol.1", "Tenure (4):Renter[3]", "Symbol.2"], ten_rows)

age_rows = []
for (g, d), (tot, p65, moy) in zip(G, [(1762950, 300000, 41.2), (438366, 80000, 42.0), (1, 1, 1)]):
    for lab, v in [("Total - Age", tot), ("65 years and over", p65), ("Average age", moy), ("Median age", moy - 1)]:
        age_rows.append(["2021", g, d, "2021", lab, "1", v, "", 0, "", 0, ""])
age = zip_csv(tmp / "a.zip", "98100022", ["REF_DATE", "GEO", "DGUID", "Census year (2)",
    "Age (in single years), average age and median age (128)", "Coordinate", "Gender (3a):Total - Gender[1]", "Symbol",
    "Gender (3a):Men+[2]", "Symbol.1", "Gender (3a):Women+[3]", "Symbol.2"], age_rows)

i = census.parse_income(inc)
t = census.parse_tenure(ten)
a = census.parse_age(age)
print(i, t, a, sep="\n")
assert set(i) == {"66023", "65005"}, i.keys()
assert i["66023"]["revenuMenage"] == 63600 and i["66023"]["croissanceRevenu"] == 16.9 and i["66023"]["menages"] == 816335
assert t["66023"]["pctProprio"] == 36.4 and t["66023"]["pctInabordableLocataire"] == 27.8 and t["66023"]["proprietaires"] == 297335
assert a["66023"]["ageMoyen"] == 41.2 and a["66023"]["pct65"] == 17.0 and a["65005"]["ageMedian"] == 41.0
print("recensement : OK")
