// Avantages et inconvénients d'un secteur : indicateurs officiels + OpenStreetMap.
import { distance } from './engine.js';
import { pct, signedPct, dist, kmoney } from './format.js';

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

function query(lat, lon) {
  const a = (r) => `(around:${r},${lat},${lon})`;
  return `[out:json][timeout:25];(
node${a(600)}[highway=bus_stop];
node${a(1500)}[railway~"^(station|halt|subway_entrance|tram_stop)$"];
node${a(1500)}[public_transport=station];
nwr${a(1000)}[amenity~"^(school|kindergarten|childcare)$"];
nwr${a(600)}[leisure~"^(park|playground)$"];
nwr${a(1000)}[shop~"^(supermarket|greengrocer|bakery)$"];
nwr${a(1200)}[amenity~"^(pharmacy|clinic|hospital|doctors)$"];
way${a(200)}[highway~"^(motorway|trunk)$"];
way${a(120)}[railway=rail];
way${a(250)}[landuse=industrial];
nwr${a(4000)}[aeroway=aerodrome];
);out center tags qt 400;`;
}

const CATS = [
  { k: 'bus', label: 'Arrêt d\'autobus', test: (t) => t.highway === 'bus_stop' },
  { k: 'rail', label: 'Métro, REM, train ou tramway', test: (t) => /station|halt|subway_entrance|tram_stop/.test(t.railway || '') || t.public_transport === 'station' },
  { k: 'ecole', label: 'École ou garderie', test: (t) => /school|kindergarten|childcare/.test(t.amenity || '') },
  { k: 'parc', label: 'Parc', test: (t) => /park|playground/.test(t.leisure || '') },
  { k: 'epicerie', label: 'Épicerie', test: (t) => /supermarket|greengrocer|bakery/.test(t.shop || '') },
  { k: 'sante', label: 'Pharmacie ou clinique', test: (t) => /pharmacy|clinic|hospital|doctors/.test(t.amenity || '') },
  { k: 'autoroute', label: 'Autoroute', test: (t) => /motorway|trunk/.test(t.highway || ''), nuisance: true },
  { k: 'voieFerree', label: 'Voie ferrée', test: (t) => t.railway === 'rail', nuisance: true },
  { k: 'industriel', label: 'Zone industrielle', test: (t) => t.landuse === 'industrial', nuisance: true },
  { k: 'aeroport', label: 'Aéroport ou aérodrome', test: (t) => t.aeroway === 'aerodrome', nuisance: true },
];

const cache = new Map();

/** Commodités et nuisances autour d'un point (cache par session). */
export async function environs(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
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

/** Liste d'avantages (+), d'inconvénients (−) et de points neutres (±). */
export function prosCons({ muni, meta, unit, osm, est }) {
  const out = [];
  const add = (signe, texte, pour = 'tous') => out.push({ signe, texte, pour });
  const c = muni.recensement || {};
  const rep = meta.reperes || {};

  if (c.croissancePop != null) {
    if (c.croissancePop >= 5) add('+', `Population en croissance (${signedPct(c.croissancePop)} entre 2016 et 2021) : demande soutenue.`);
    else if (c.croissancePop <= 0) add('−', `Population stable ou en baisse (${signedPct(c.croissancePop)} entre 2016 et 2021).`);
  }
  const g = muni.marche?.g;
  if (g != null) {
    if (g >= 0.06) add('±', `Valeurs en forte hausse (environ ${signedPct(g * 100)} par an) : favorable au vendeur, moins à l'acheteur.`);
    else if (g <= 0.01) add('±', `Valeurs peu dynamiques (environ ${signedPct(g * 100)} par an) : meilleur pouvoir de négociation pour l'acheteur.`);
  }
  if (c.revenuMenage && rep.revenuMenage) {
    const r = c.revenuMenage / rep.revenuMenage;
    if (r >= 1.15) add('+', `Revenu médian des ménages supérieur au repère québécois (${kmoney(c.revenuMenage)} en 2020).`);
    else if (r <= 0.85) add('−', `Revenu médian des ménages inférieur au repère québécois (${kmoney(c.revenuMenage)} en 2020).`);
  }
  if (muni.ratioPrixRevenu) {
    if (muni.ratioPrixRevenu >= 9) add('−', `Marché peu abordable : prix médian ≈ ${muni.ratioPrixRevenu.toFixed(1).replace('.', ',')} fois le revenu des ménages.`);
    else if (muni.ratioPrixRevenu <= 5) add('+', `Marché abordable : prix médian ≈ ${muni.ratioPrixRevenu.toFixed(1).replace('.', ',')} fois le revenu des ménages.`);
  }
  if (c.pctProprio != null) {
    if (c.pctProprio <= 45) add('+', `Forte proportion de locataires (${pct(100 - c.pctProprio, 0)}) : bassin locatif important.`, 'investisseur');
    else if (c.pctProprio >= 75) add('+', `Secteur majoritairement propriétaire (${pct(c.pctProprio, 0)}) : quartier généralement stable.`, 'acheteur');
  }
  if (c.pctInabordableLocataire != null) {
    if (c.pctInabordableLocataire >= 33) add('−', `${pct(c.pctInabordableLocataire, 0)} des locataires consacrent plus de 30 % de leur revenu au logement : marge limitée pour hausser les loyers.`, 'investisseur');
    else if (c.pctInabordableLocataire <= 18) add('+', `Seulement ${pct(c.pctInabordableLocataire, 0)} des locataires dépassent 30 % de leur revenu en loyer : demande solvable.`, 'investisseur');
  }
  if (c.croissanceRevenu != null && c.croissanceRevenu >= 20) add('+', `Revenu des ménages en forte hausse (${signedPct(c.croissanceRevenu, 0)} de 2015 à 2020, en dollars constants).`);
  if (muni.rendementPlex != null) {
    if (muni.rendementPlex >= 6) add('+', `Rendement brut des plex élevé (≈ ${pct(muni.rendementPlex)}).`, 'investisseur');
    else if (muni.rendementPlex <= 4) add('−', `Rendement brut des plex faible (≈ ${pct(muni.rendementPlex)}) : misez sur la plus-value.`, 'investisseur');
  }
  const liq = muni.liquidite?.score;
  if (liq != null) {
    if (liq >= 65) add('+', 'Marché liquide : la revente est généralement plus facile.');
    else if (liq <= 35) add('−', 'Marché peu liquide : prévoir un délai de vente plus long.');
  }
  if (unit) {
    if (unit.an && unit.an < 1950) add('−', `Bâtiment construit en ${unit.an} : inspection approfondie conseillée (fondation, électricité, plomberie, isolation).`);
    else if (unit.an && unit.an >= 2010) add('+', `Construction récente (${unit.an}) : moins de travaux majeurs à prévoir à court terme.`);
    if (unit.t === 'C') add('±', 'Copropriété : vérifiez le fonds de prévoyance, l\'étude du fonds et les procès-verbaux du syndicat.');
    if (est && est.marge >= 0.15) add('±', 'Propriété atypique pour le secteur : estimation moins précise, une évaluation agréée est recommandée.');
  }
  if (osm) {
    const o = osm;
    if (o.rail.plusProche != null && o.rail.plusProche <= 1000) add('+', `Station de transport collectif structurant à ${dist(o.rail.plusProche)}${o.rail.nom ? ` (${o.rail.nom})` : ''}.`);
    if (o.bus.plusProche != null && o.bus.plusProche <= 400) add('+', `Arrêt d'autobus à ${dist(o.bus.plusProche)}.`);
    else if (o.bus.n === 0 && o.rail.n === 0) add('−', 'Peu ou pas de transport collectif à distance de marche.');
    if (o.ecole.plusProche != null && o.ecole.plusProche <= 800) add('+', `École ou garderie à ${dist(o.ecole.plusProche)}.`, 'acheteur');
    if (o.parc.plusProche != null && o.parc.plusProche <= 400) add('+', `Parc à ${dist(o.parc.plusProche)}.`);
    if (o.epicerie.plusProche != null && o.epicerie.plusProche <= 800) add('+', `Épicerie à ${dist(o.epicerie.plusProche)}.`);
    else if (o.epicerie.n === 0) add('−', 'Aucune épicerie à moins de 1 km.');
    if (o.sante.plusProche != null && o.sante.plusProche <= 1000) add('+', `Pharmacie ou clinique à ${dist(o.sante.plusProche)}.`);
    if (o.autoroute.n) add('−', `Autoroute à ${dist(o.autoroute.plusProche)} : bruit possible.`);
    if (o.voieFerree.n) add('−', `Voie ferrée à ${dist(o.voieFerree.plusProche)} : bruit et vibrations possibles.`);
    if (o.industriel.n) add('−', `Zone industrielle à ${dist(o.industriel.plusProche)}.`);
    if (o.aeroport.n) add('±', `Aéroport ou aérodrome à ${dist(o.aeroport.plusProche)} : vérifiez les couloirs aériens.`);
  }
  return out;
}
