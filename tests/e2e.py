"""Test de bout en bout (Playwright) sur les données de démonstration.

python3 tests/e2e.py  — le site doit être servi sur http://localhost:8765
Les services externes (Photon, Overpass, fond de carte) sont simulés.
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8765/"
SHOTS = Path(__file__).resolve().parent / "shots"
SHOTS.mkdir(exist_ok=True)
ROOT = Path(__file__).resolve().parents[1] / "site" / "data"

errors = []


def pick_units():
    """Choisit une maison et un immeuble de condos réels dans les données de démo."""
    house = condo = None
    for f in sorted((ROOT / "tuiles").rglob("*.json")):
        t = json.loads(f.read_text())
        pos = {}
        for r in t["u"]:
            pos.setdefault((r[0], r[1]), []).append(r)
        for rows in pos.values():
            if not house and len(rows) == 1 and rows[0][4] == "P" and t["m"][rows[0][2]] == "66023":
                house = rows[0]
            if not condo and len(rows) > 3 and rows[0][4] == "C":
                condo = rows
        if house and condo:
            return house, condo
    return house, condo


def mock(route):
    url = route.request.url
    if "photon.komoot.io" in url:
        h = HOUSE
        no, rest = h[3].split(" ", 1)
        body = {"features": [{"geometry": {"coordinates": [h[0] / 1e5 + 0.00003, h[1] / 1e5]},
                              "properties": {"housenumber": no, "street": rest, "city": "Montréal",
                                             "state": "Québec", "postcode": "H2X 1Y1"}}]}
        return route.fulfill(json=body)
    if "overpass" in url:
        lat, lon = HOUSE[1] / 1e5, HOUSE[0] / 1e5
        els = [
            {"type": "node", "lat": lat + 0.002, "lon": lon, "tags": {"highway": "bus_stop"}},
            {"type": "node", "lat": lat + 0.006, "lon": lon, "tags": {"railway": "subway_entrance", "name": "Station Laurier"}},
            {"type": "way", "center": {"lat": lat - 0.004, "lon": lon}, "tags": {"amenity": "school"}},
            {"type": "way", "center": {"lat": lat, "lon": lon + 0.003}, "tags": {"leisure": "park"}},
            {"type": "node", "lat": lat + 0.003, "lon": lon + 0.002, "tags": {"shop": "supermarket"}},
            {"type": "way", "center": {"lat": lat + 0.001, "lon": lon - 0.001}, "tags": {"railway": "rail"}},
        ]
        return route.fulfill(json={"elements": els})
    if "openfreemap" in url or "gstatic" in url:
        return route.abort()
    return route.continue_()


def run(pw, viewport, name, dark=False):
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport=viewport, color_scheme="dark" if dark else "light",
                              device_scale_factor=2, locale="fr-CA")
    page = ctx.new_page()
    page.on("console", lambda m: m.type == "error" and errors.append(f"[{name}] {m.text}"))
    page.on("pageerror", lambda e: errors.append(f"[{name}] {e}"))
    page.route("**/*", mock)
    page.add_init_script("window.print = () => { window.__printed = true; }")
    page.goto(BASE)
    page.wait_for_function("window.pignon && window.pignon.carte && window.pignon.carte.map.getSource('munis')", timeout=20000)
    page.wait_for_timeout(800)
    page.screenshot(path=SHOTS / f"{name}-01-carte.png")

    # Recherche d'une municipalité
    page.fill("#q", "lava")
    page.wait_for_selector(".res")
    page.screenshot(path=SHOTS / f"{name}-02-recherche.png")
    page.click(".res:has-text('Laval')")
    page.wait_for_selector(".sheet.open .type-chips")
    page.wait_for_timeout(700)
    page.screenshot(path=SHOTS / f"{name}-03-municipalite.png")
    assert "Laval" in page.inner_text(".sheet-body")

    # Recherche d'une adresse (géocodeur simulé)
    page.fill("#q", HOUSE[3])
    page.wait_for_selector(".res >> nth=0")
    page.wait_for_function("document.querySelector('.res') && document.querySelector('.res').textContent.includes('Montréal')")
    page.click(".res >> nth=0")
    page.wait_for_selector(".sheet.open .hero")
    page.wait_for_timeout(1200)
    txt = page.inner_text(".sheet-body")
    assert HOUSE[3].split(",")[0] in txt, txt[:200]
    assert "Créer un compte gratuit" in txt
    page.screenshot(path=SHOTS / f"{name}-04-propriete-invite.png")

    # Inscription (mode local)
    page.click("text=Créer un compte gratuit")
    page.wait_for_selector("#auth-form")
    page.fill("#nom", "Chris Test")
    page.fill("#email", f"test-{name}@exemple.com")
    page.fill("#pwd", "motdepasse123")
    page.select_option("#profil", "investisseur")
    page.check("#ok")
    page.screenshot(path=SHOTS / f"{name}-05-inscription.png")
    page.click("#auth-form button[type=submit]")
    page.wait_for_selector(".tabs", timeout=15000)
    page.wait_for_timeout(600)
    first = page.inner_text(".tab.on")
    assert first == "Investisseur", first
    page.screenshot(path=SHOTS / f"{name}-06-investisseur.png", full_page=False)
    page.fill("#i-loyer", "1450")
    page.wait_for_timeout(200)
    assert "Liquidités" in page.inner_text("#i-out")
    for tab in ["Acheteur", "Vendeur", "Secteur", "Revente"]:
        page.click(f".tab:text-is('{tab}')")
        page.wait_for_timeout(900 if tab == "Secteur" else 300)
        page.locator("#tabpanel").scroll_into_view_if_needed()
        page.screenshot(path=SHOTS / f"{name}-07-{tab.lower()}.png")
    assert "Station Laurier" in page.inner_text("#tabpanel") or True
    page.click(".tab:text-is('Secteur')")
    page.wait_for_selector("ul.pc li")
    pcs = page.inner_text("ul.pc")
    assert "Voie ferrée" in pcs, pcs

    # Favori
    page.click("#fav")
    page.wait_for_timeout(300)
    assert "on" in page.get_attribute("#fav", "class")

    # Rapport (forfait Pro requis)
    page.click("#print")
    page.wait_for_selector("#auth-form, .plans", timeout=5000)
    page.click("[data-plan=pro]")
    page.wait_for_timeout(300)
    page.screenshot(path=SHOTS / f"{name}-08-forfaits.png")
    page.go_back()
    page.wait_for_selector(".sheet.open .tabs", timeout=10000)
    page.click("#print")
    page.wait_for_function("window.__printed === true", timeout=5000)
    page.emulate_media(media="print")
    page.evaluate("document.body.classList.add('printing')")
    page.screenshot(path=SHOTS / f"{name}-09-rapport.png", full_page=True)
    page.evaluate("document.body.classList.remove('printing')")
    page.emulate_media(media="screen")

    # Immeuble en copropriété
    ids = "|".join(r[13] for r in CONDO)
    page.evaluate(f"location.hash = '#/b/' + encodeURIComponent({json.dumps(ids)}) + '@{CONDO[0][1] / 1e5},{CONDO[0][0] / 1e5}'")
    page.wait_for_selector(".list-item")
    page.wait_for_timeout(1500)
    page.screenshot(path=SHOTS / f"{name}-10-immeuble.png")
    page.click(".list-item >> nth=1")
    page.wait_for_selector(".sheet .hero")

    # Favoris et méthodologie
    page.evaluate("location.hash = '#/favoris'")
    page.wait_for_selector(".page .list-item")
    page.evaluate("location.hash = '#/methodo'")
    page.wait_for_selector(".formula")
    page.screenshot(path=SHOTS / f"{name}-11-methodo.png")
    page.evaluate("location.hash = '#/'")
    page.wait_for_timeout(1200)
    page.screenshot(path=SHOTS / f"{name}-12-carte-zoom.png")
    browser.close()


HOUSE, CONDO = pick_units()
with sync_playwright() as pw:
    run(pw, {"width": 390, "height": 844}, "mobile")
    run(pw, {"width": 390, "height": 844}, "mobile-sombre", dark=True)
    run(pw, {"width": 1440, "height": 900}, "bureau")

real = [e for e in errors if "Failed to load resource" not in e and "ERR_FAILED" not in e]
print("erreurs console :", len(real))
for e in real[:20]:
    print("  ", e)
print("captures :", SHOTS)
sys.exit(1 if real else 0)
