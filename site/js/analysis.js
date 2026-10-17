// Avantages et inconvénients d'un secteur : indicateurs officiels + OpenStreetMap.
import { distance } from './engine.js';
import { fmt } from './format.js';

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

function query(lat, lon) {
  const a = (r) => `(around:${r},${lat},${lon})`;
  return `[out:json][timeout:25];(
node${a(600)}[highway=bus_stop];
node${a(1500)}[railway~"^(station|halt|subway_entrance|tram_stop)$"];
node${a(1500)}[public_transport=station];
nwr${a(1000)}[amenity~"^(school|kindergarten|childcare)$"];
nwr${a(600)}[leisure~"^(park|playground)$"];
nwr${a(1000)}[shop~"^(supermarket|greengrocer|bakery|convenience)$"];
nwr${a(1200)}[amenity~"^(pharmacy|clinic|hospital|doctors|dentist)$"];
nwr${a(600)}[amenity~"^(restaurant|cafe|bar|pub|fast_food)$"];
nwr${a(1500)}[amenity~"^(library|community_centre|theatre|cinema)$"];
nwr${a(1500)}[leisure~"^(sports_centre|fitness_centre|swimming_pool|ice_rink)$"];
way${a(200)}[highway~"^(motorway|trunk)$"];
way${a(120)}[railway=rail];
way${a(250)}[landuse=industrial];
nwr${a(4000)}[aeroway=aerodrome];
);out center tags qt 600;`;
}

const CATS = [
  { k: 'bus', label: 'Arrêt d\'autobus', test: (t) => t.highway === 'bus_stop' },
  { k: 'rail', label: 'Métro, REM, train ou tramway', test: (t) => /station|halt|subway_entrance|tram_stop/.test(t.railway || '') || t.public_transport === 'station' },
  { k: 'ecole', label: 'École ou garderie', test: (t) => /school|kindergarten|childcare/.test(t.amenity || '') },
  { k: 'garderie', label: 'Garderie ou CPE', test: (t) => /kindergarten|childcare/.test(t.amenity || '') },
  { k: 'parc', label: 'Parc', test: (t) => /park|playground/.test(t.leisure || '') },
  { k: 'epicerie', label: 'Épicerie', test: (t) => /supermarket|greengrocer|bakery/.test(t.shop || '') },
  { k: 'depanneur', label: 'Dépanneur', test: (t) => t.shop === 'convenience' },
  { k: 'sante', label: 'Pharmacie ou clinique', test: (t) => /pharmacy|clinic|hospital|doctors/.test(t.amenity || '') },
  { k: 'pharmacie', label: 'Pharmacie', test: (t) => t.amenity === 'pharmacy' },
  { k: 'clinique', label: 'Clinique ou hôpital', test: (t) => /clinic|hospital|doctors/.test(t.amenity || '') },
  { k: 'restos', label: 'Restaurants et cafés', test: (t) => /restaurant|cafe|bar|pub|fast_food/.test(t.amenity || '') },
  { k: 'culture', label: 'Bibliothèque ou centre culturel', test: (t) => /library|community_centre|theatre|cinema/.test(t.amenity || '') },
  { k: 'sport', label: 'Centre sportif, piscine ou aréna', test: (t) => /sports_centre|fitness_centre|swimming_pool|ice_rink/.test(t.leisure || '') },
  { k: 'autoroute', label: 'Autoroute', test: (t) => /motorway|trunk/.test(t.highway || ''), nuisance: true },
  { k: 'voieFerree', label: 'Voie ferrée', test: (t) => t.railway === 'rail', nuisance: true },
  { k: 'industriel', label: 'Zone industrielle', test: (t) => t.landuse === 'industrial', nuisance: true },
  { k: 'aeroport', label: 'Aéroport ou aérodrome', test: (t) => t.aeroway === 'aerodrome', nuisance: true },
];

const cache = new Map();

/** Commodités et nuisances autour d'un point (cache par session). */
export async function environs(lat, lon) {
  const key = `v2:${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const stored = sessionStorage.getItem(`osm:${key}`);
    if (stored) {
      const v = JSON.parse(stored);
      cache.set(key, v);
      return v;
    }
  } catch { /* stockage indisponible */ }
  let json = null;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query(lat, lon) }) });
      if (r.ok) { json = await r.json(); break; }
    } catch { /* essai suivant */ }
  }
  if (!json) return null;
  const res = {};
  for (const c of CATS) res[c.k] = { label: c.label, n: 0, plusProche: null, nom: null, nuisance: !!c.nuisance };
  for (const el of json.elements || []) {
    const p = el.type === 'node' ? { lat: el.lat, lon: el.lon } : el.center;
    if (!p) continue;
    const t = el.tags || {};
    for (const c of CATS) {
      if (!c.test(t)) continue;
      const d = distance({ lat, lon }, p);
      const r = res[c.k];
      r.n += 1;
      if (r.plusProche == null || d < r.plusProche) { r.plusProche = d; r.nom = t.name || null; }
    }
  }
  cache.set(key, res);
  try { sessionStorage.setItem(`osm:${key}`, JSON.stringify(res)); } catch { /* plein */ }
  return res;
}

/** Liste d'avantages (+), d'inconvénients (−) et de points neutres (±), en français ou en anglais. */
export function prosCons({ muni, meta, unit, osm, est }, lang = 'fr') {
  const out = [];
  const L = (fr, en) => (lang === 'en' ? en : fr);
  const POUR = { tous: L('tous', 'all'), acheteur: L('acheteur', 'buyer'), investisseur: L('investisseur', 'investor') };
  const add = (signe, texte, pour = 'tous') => out.push({ signe, texte, pour: POUR[pour] || pour, cle: pour });
  const { pct, signedPct, dist, kmoney, num1 } = fmt(lang);
  const c = muni.recensement || {};
  const rep = meta.reperes || {};

  if (c.croissancePop != null) {
    if (c.croissancePop >= 5) add('+', L(`Population en croissance (${signedPct(c.croissancePop)} entre 2016 et 2021) : demande soutenue.`, `Growing population (${signedPct(c.croissancePop)} from 2016 to 2021): sustained demand.`));
    else if (c.croissancePop <= 0) add('−', L(`Population stable ou en baisse (${signedPct(c.croissancePop)} entre 2016 et 2021).`, `Stable or declining population (${signedPct(c.croissancePop)} from 2016 to 2021).`));
  }
  const g = muni.marche?.g;
  if (g != null) {
    if (g >= 0.06) add('±', L(`Valeurs en forte hausse (environ ${signedPct(g * 100)} par an) : favorable au vendeur, moins à l'acheteur.`, `Values rising fast (about ${signedPct(g * 100)} per year): good for sellers, less so for buyers.`));
    else if (g <= 0.01) add('±', L(`Valeurs peu dynamiques (environ ${signedPct(g * 100)} par an) : meilleur pouvoir de négociation pour l'acheteur.`, `Flat values (about ${signedPct(g * 100)} per year): more negotiating power for buyers.`));
  }
  if (c.revenuMenage && rep.revenuMenage) {
    const r = c.revenuMenage / rep.revenuMenage;
    if (r >= 1.15) add('+', L(`Revenu médian des ménages supérieur au repère québécois (${kmoney(c.revenuMenage)} en 2020).`, `Median household income above the Québec benchmark (${kmoney(c.revenuMenage)} in 2020).`));
    else if (r <= 0.85) add('−', L(`Revenu médian des ménages inférieur au repère québécois (${kmoney(c.revenuMenage)} en 2020).`, `Median household income below the Québec benchmark (${kmoney(c.revenuMenage)} in 2020).`));
  }
  if (muni.ratioPrixRevenu) {
    const x = num1(muni.ratioPrixRevenu);
    if (muni.ratioPrixRevenu >= 9) add('−', L(`Marché peu abordable : prix médian ≈ ${x} fois le revenu des ménages.`, `Low affordability: median price ≈ ${x} times household income.`));
    else if (muni.ratioPrixRevenu <= 5) add('+', L(`Marché abordable : prix médian ≈ ${x} fois le revenu des ménages.`, `Affordable market: median price ≈ ${x} times household income.`));
  }
  if (c.pctProprio != null) {
    if (c.pctProprio <= 45) add('+', L(`Forte proportion de locataires (${pct(100 - c.pctProprio, 0)}) : bassin locatif important.`, `High share of renters (${pct(100 - c.pctProprio, 0)}): large rental pool.`), 'investisseur');
    else if (c.pctProprio >= 75) add('+', L(`Secteur majoritairement propriétaire (${pct(c.pctProprio, 0)}) : quartier généralement stable.`, `Mostly owner-occupied (${pct(c.pctProprio, 0)}): usually a stable neighbourhood.`), 'acheteur');
  }
  if (c.pctInabordableLocataire != null) {
    if (c.pctInabordableLocataire >= 33) add('−', L(`${pct(c.pctInabordableLocataire, 0)} des locataires consacrent plus de 30 % de leur revenu au logement : marge limitée pour hausser les loyers.`, `${pct(c.pctInabordableLocataire, 0)} of renters spend over 30% of income on housing: limited room to raise rents.`), 'investisseur');
    else if (c.pctInabordableLocataire <= 18) add('+', L(`Seulement ${pct(c.pctInabordableLocataire, 0)} des locataires dépassent 30 % de leur revenu en loyer : demande solvable.`, `Only ${pct(c.pctInabordableLocataire, 0)} of renters spend over 30% of income on rent: solvent demand.`), 'investisseur');
  }
  if (c.croissanceRevenu != null && c.croissanceRevenu >= 20) add('+', L(`Revenu des ménages en forte hausse (${signedPct(c.croissanceRevenu, 0)} de 2015 à 2020, en dollars constants).`, `Household income rising fast (${signedPct(c.croissanceRevenu, 0)} from 2015 to 2020, constant dollars).`));
  if (muni.rendementPlex != null) {
    if (muni.rendementPlex >= 6) add('+', L(`Rendement brut des plex élevé (≈ ${pct(muni.rendementPlex)}).`, `High gross yield on plexes (≈ ${pct(muni.rendementPlex)}).`), 'investisseur');
    else if (muni.rendementPlex <= 4) add('−', L(`Rendement brut des plex faible (≈ ${pct(muni.rendementPlex)}) : misez sur la plus-value.`, `Low gross yield on plexes (≈ ${pct(muni.rendementPlex)}): rely on appreciation.`), 'investisseur');
  }
  const liq = muni.liquidite?.score;
  if (liq != null) {
    if (liq >= 65) add('+', L('Marché liquide : la revente est généralement plus facile.', 'Liquid market: resale is usually easier.'));
    else if (liq <= 35) add('−', L('Marché peu liquide : prévoir un délai de vente plus long.', 'Thin market: expect a longer time to sell.'));
  }
  if (unit) {
    if (unit.an && unit.an < 1950) add('−', L(`Bâtiment construit en ${unit.an} : inspection approfondie conseillée (fondation, électricité, plomberie, isolation).`, `Built in ${unit.an}: a thorough inspection is advised (foundation, wiring, plumbing, insulation).`));
    else if (unit.an && unit.an >= 2010) add('+', L(`Construction récente (${unit.an}) : moins de travaux majeurs à prévoir à court terme.`, `Recent construction (${unit.an}): fewer major repairs expected soon.`));
    if (unit.t === 'C') add('±', L('Copropriété : vérifiez le fonds de prévoyance, l\'étude du fonds et les procès-verbaux du syndicat.', 'Condo: check the contingency fund, the fund study and the syndicate\'s minutes.'));
    if (est && est.marge >= 0.15) add('±', L('Propriété atypique pour le secteur : estimation moins précise, une évaluation agréée est recommandée.', 'Atypical property for the area: less precise estimate, a certified appraisal is recommended.'));
  }
  if (osm) {
    const o = osm;
    if (o.rail.plusProche != null && o.rail.plusProche <= 1000) add('+', L(`Station de transport collectif structurant à ${dist(o.rail.plusProche)}`, `Rapid transit station ${dist(o.rail.plusProche)} away`) + (o.rail.nom ? ` (${o.rail.nom}).` : '.'));
    if (o.bus.plusProche != null && o.bus.plusProche <= 400) add('+', L(`Arrêt d'autobus à ${dist(o.bus.plusProche)}.`, `Bus stop ${dist(o.bus.plusProche)} away.`));
    else if (o.bus.n === 0 && o.rail.n === 0) add('−', L('Peu ou pas de transport collectif à distance de marche.', 'Little or no public transit within walking distance.'));
    if (o.ecole.plusProche != null && o.ecole.plusProche <= 800) add('+', L(`École ou garderie à ${dist(o.ecole.plusProche)}.`, `School or daycare ${dist(o.ecole.plusProche)} away.`), 'acheteur');
    if (o.parc.plusProche != null && o.parc.plusProche <= 400) add('+', L(`Parc à ${dist(o.parc.plusProche)}.`, `Park ${dist(o.parc.plusProche)} away.`));
    if (o.epicerie.plusProche != null && o.epicerie.plusProche <= 800) add('+', L(`Épicerie à ${dist(o.epicerie.plusProche)}.`, `Grocery store ${dist(o.epicerie.plusProche)} away.`));
    else if (o.epicerie.n === 0) add('−', L('Aucune épicerie à moins de 1 km.', 'No grocery store within 1 km.'));
    if (o.sante.plusProche != null && o.sante.plusProche <= 1000) add('+', L(`Pharmacie ou clinique à ${dist(o.sante.plusProche)}.`, `Pharmacy or clinic ${dist(o.sante.plusProche)} away.`));
    if (o.autoroute.n) add('−', L(`Autoroute à ${dist(o.autoroute.plusProche)} : bruit possible.`, `Highway ${dist(o.autoroute.plusProche)} away: possible noise.`));
    if (o.voieFerree.n) add('−', L(`Voie ferrée à ${dist(o.voieFerree.plusProche)} : bruit et vibrations possibles.`, `Railway ${dist(o.voieFerree.plusProche)} away: possible noise and vibration.`));
    if (o.industriel.n) add('−', L(`Zone industrielle à ${dist(o.industriel.plusProche)}.`, `Industrial area ${dist(o.industriel.plusProche)} away.`));
    if (o.aeroport.n) add('±', L(`Aéroport ou aérodrome à ${dist(o.aeroport.plusProche)} : vérifiez les couloirs aériens.`, `Airport or airfield ${dist(o.aeroport.plusProche)} away: check flight paths.`));
  }
  return out;
}
