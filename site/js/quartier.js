// Onglets Quartier (écoles, services, score de proximité), Économie (région) et Risques.
import { CONFIG } from './config.js';
import { distance } from './engine.js';
import { money, pct, signedPct, num1, dist, esc } from './format.js';
import { row, section, icon } from './ui.js';
import { meter } from './charts.js';

const BASE = CONFIG.dataUrl.replace(/\/$/, '');
const V = window.DATAHOUSE_VERSION || 'dev';
const CELL = 0.05;
const cacheLieux = new Map();

async function cellule(type, la, lo) {
  const k = `${type}/${la}_${lo}`;
  if (!cacheLieux.has(k)) {
    cacheLieux.set(k, fetch(`${BASE}/${type}/${la}_${lo}.json?v=${V}`).then((r) => (r.ok ? r.json() : [])).catch(() => []));
  }
  return cacheLieux.get(k);
}

/** Lieux (écoles ou terrains) dans un rayon, triés par distance. */
export async function lieuxAutour(type, lat, lon, rayon = 3000) {
  const la = Math.floor(lat / CELL); const lo = Math.floor(lon / CELL);
  const jobs = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) jobs.push(cellule(type, la + a, lo + b));
  const all = (await Promise.all(jobs)).flat();
  return all.map((x) => ({ ...x, d: distance({ lat, lon }, { lat: x.la, lon: x.lo }) }))
    .filter((x) => x.d <= rayon).sort((a, b) => a.d - b.d);
}

/* ---------------------------------------------------------------------------
 * Grilles à 5 niveaux génériques : bornes croissantes [b1, b2, b3, b4] et sens.
 * ------------------------------------------------------------------------- */
const NIV = [
  { n: 2, l: 'Excellent', c: 'favorable', i: ['up', 'up'] }, { n: 1, l: 'Bon', c: 'favorable', i: ['up'] },
  { n: 0, l: 'Moyen', c: 'neutre', i: ['neutral'] }, { n: -1, l: 'Faible', c: 'defavorable', i: ['down'] },
  { n: -2, l: 'Très faible', c: 'defavorable', i: ['down', 'down'] },
];

/** Renvoie le niveau (2 … −2) d'une valeur selon des bornes croissantes ; `hautBon` : plus haut = mieux. */
export function niveau5(v, bornes, hautBon = true) {
  if (v == null || Number.isNaN(v)) return null;
  let i = bornes.filter((b) => v >= b).length; // 0 … 4
  if (!hautBon) i = 4 - i;
  return [-2, -1, 0, 1, 2][i];
}
export const tag5 = (n, libelles) => {
  if (n == null) return '';
  const x = NIV.find((y) => y.n === n);
  return `<span class="palier ${x.c}">${x.i.map((k) => icon(k)).join('')}<span>${esc(libelles?.[n] ?? x.l)}</span></span>`;
};

/** Tableau d'une grille à 5 niveaux avec ses bornes chiffrées et la ligne courante en évidence. */
export function grille5(bornes, { hautBon = true, fmt = (x) => x, valeur, libelles, marque = 'cette propriété' } = {}) {
  const b = bornes;
  const plages = hautBon
    ? [`${fmt(b[3])} et plus`, `${fmt(b[2])} à ${fmt(b[3])}`, `${fmt(b[1])} à ${fmt(b[2])}`, `${fmt(b[0])} à ${fmt(b[1])}`, `moins de ${fmt(b[0])}`]
    : [`moins de ${fmt(b[0])}`, `${fmt(b[0])} à ${fmt(b[1])}`, `${fmt(b[1])} à ${fmt(b[2])}`, `${fmt(b[2])} à ${fmt(b[3])}`, `${fmt(b[3])} et plus`];
  const cur = niveau5(valeur, b, hautBon);
  return `<table class="grille"><tbody>${NIV.map((x, k) => `<tr class="${x.c}${cur === x.n ? ' on' : ''}">
    <td class="g-ico">${x.i.map((i) => icon(i)).join('')}</td><td><b>${esc(libelles?.[x.n] ?? x.l)}</b>${cur === x.n ? `<small>${esc(marque)}</small>` : ''}</td>
    <td class="g-p">${plages[k]}</td></tr>`).join('')}</tbody></table>`;
}

/* ---------------------------------------------------------------------------
 * Quartier : score de proximité des services.
 * ------------------------------------------------------------------------- */
const CRITERES = [
  { k: 'transport', l: 'Transport collectif', poids: 3 },
  { k: 'epicerie', l: 'Épicerie', poids: 2 },
  { k: 'primaire', l: 'École primaire', poids: 2 },
  { k: 'secondaire', l: 'École secondaire', poids: 1 },
  { k: 'garderie', l: 'Garderie', poids: 1 },
  { k: 'parc', l: 'Parc', poids: 1.5 },
  { k: 'sante', l: 'Pharmacie ou clinique', poids: 1.5 },
  { k: 'restos', l: 'Restaurants et cafés', poids: 1 },
  { k: 'sport', l: 'Sport et loisirs', poids: 0.5 },
  { k: 'culture', l: 'Bibliothèque, culture', poids: 0.5 },
];
// Score 100 si à moins de `bon` mètres, 0 au-delà de `max`.
const dscore = (d, bon, max) => (d == null ? 0 : d <= bon ? 100 : d >= max ? 0 : Math.round(100 * (1 - (d - bon) / (max - bon))));

export function scoreProximite(osm, ecoles) {
  if (!osm) return null;
  const prim = ecoles?.find((e) => e.p);
  const sec = ecoles?.find((e) => e.s);
  const v = {
    transport: Math.max(dscore(osm.rail?.plusProche, 500, 1500), dscore(osm.bus?.plusProche, 250, 800) * 0.85),
    epicerie: dscore(osm.epicerie?.plusProche, 500, 1500),
    primaire: dscore(prim?.d ?? (osm.ecole?.plusProche), 600, 2000),
    secondaire: dscore(sec?.d, 1500, 5000),
    garderie: dscore(osm.garderie?.plusProche, 500, 1500),
    parc: dscore(osm.parc?.plusProche, 300, 1000),
    sante: dscore(Math.min(osm.pharmacie?.plusProche ?? 1e9, osm.clinique?.plusProche ?? 1e9, osm.sante?.plusProche ?? 1e9), 600, 2000),
    restos: Math.min(100, (osm.restos?.n || 0) * 12),
    sport: dscore(osm.sport?.plusProche, 800, 2500),
    culture: dscore(osm.culture?.plusProche, 800, 2500),
  };
  const poids = CRITERES.reduce((a, c) => a + c.poids, 0);
  let score = CRITERES.reduce((a, c) => a + v[c.k] * c.poids, 0) / poids;
  const nuis = ['autoroute', 'voieFerree', 'industriel'].filter((k) => osm[k]?.n).length;
  score = Math.max(0, Math.round(score - nuis * 6));
  return { score, detail: CRITERES.map((c) => ({ ...c, v: Math.round(v[c.k]) })), nuisances: nuis };
}

const BORNES_PROX = [35, 50, 65, 80];

export function quartierHtml({ unit, osm, ecoles }) {
  const sp = scoreProximite(osm, ecoles);
  const prim = (ecoles || []).filter((e) => e.p).slice(0, 4);
  const sec = (ecoles || []).filter((e) => e.s).slice(0, 4);
  const ligneEcole = (e) => `<li><div><b>${esc(e.n)}</b><small>${e.r === 'prive' ? 'Privée' : e.r === 'gouv' ? 'Gouvernementale' : 'Publique'}${e.l === 'en' ? ' · anglophone' : e.l === 'fr' ? ' · francophone' : ''}${e.imse ? ` · IMSE ${e.imse}/10` : ''}${e.w ? ` · <a href="${esc(e.w)}" target="_blank" rel="noopener">site</a>` : ''}</small></div><span>${dist(e.d)}</span></li>`;
  const ecolesHtml = section('Écoles à proximité', `
    ${prim.length ? `<h4 class="sub">Primaire</h4><ul class="lieux">${prim.map(ligneEcole).join('')}</ul>` : '<p class="note">Aucune école primaire répertoriée dans un rayon de 3 km.</p>'}
    ${sec.length ? `<h4 class="sub">Secondaire</h4><ul class="lieux">${sec.map(ligneEcole).join('')}</ul>` : '<p class="note">Aucune école secondaire répertoriée dans un rayon de 3 km.</p>'}`,
  { note: 'Source : ministère de l\'Éducation du Québec. IMSE : indice de milieu socio-économique des élèves (1 = le plus favorisé, 10 = le plus défavorisé), publié pour les écoles publiques ; ce n\'est pas un palmarès de qualité. L\'école de quartier attribuée et les programmes particuliers (PEI, sport-études, arts) se vérifient auprès du centre de services scolaire.' });
  if (!sp) {
    return `${section('Proximité des services', '<p class="loading">Analyse des services autour de l\'adresse…</p>')}${ecolesHtml}`;
  }
  const services = [
    ['Transport collectif structurant', osm.rail], ['Arrêt d\'autobus', osm.bus], ['Épicerie', osm.epicerie], ['Dépanneur', osm.depanneur],
    ['Garderie ou CPE', osm.garderie], ['Parc', osm.parc], ['Pharmacie', osm.pharmacie], ['Clinique ou hôpital', osm.clinique],
    ['Restaurants et cafés (600 m)', osm.restos, true], ['Sport et loisirs', osm.sport], ['Bibliothèque, culture', osm.culture],
  ].filter(([, o]) => o);
  return `${section('Proximité des services', `
      <div class="prox"><div class="prox-v">${sp.score}<small>/100</small></div>${tag5(niveau5(sp.score, BORNES_PROX))}</div>
      ${grille5(BORNES_PROX, { valeur: sp.score })}
      <div class="mrows">${sp.detail.map((d) => `<div class="mrow"><span>${esc(d.l)}</span>${meter(d.v)}</div>`).join('')}</div>`,
    { note: `Indice DataHouse de 0 à 100 selon la distance à pied (à vol d'oiseau) des services essentiels, pondérée${sp.nuisances ? ` ; ${sp.nuisances} nuisance(s) à proximité retranchée(s)` : ''}. Données OpenStreetMap et ministère de l'Éducation.` })}
    ${ecolesHtml}
    ${section('Services autour', `<div class="grid2">${services.map(([l, o, compte]) => row(l, o.plusProche == null ? 'aucun' : compte ? `${o.n} · le plus proche à ${dist(o.plusProche)}` : `${dist(o.plusProche)}${o.nom ? ` · ${esc(o.nom)}` : ''}`)).join('')}</div>`,
    { note: 'Distances à vol d\'oiseau. Données OpenStreetMap (contributeurs) : vérifiez sur place.' })}`;
}

/* ---------------------------------------------------------------------------
 * Économie régionale.
 * ------------------------------------------------------------------------- */
export function economieHtml({ muni, meta }) {
  const e = muni.economie || {};
  const c = muni.recensement || {};
  const rep = meta.reperes || {};
  const out = [];
  if (e.chomage != null) {
    out.push(section(`Emploi : région ${esc(e.region || muni.region || '')}`, `
      <div class="kpis">
        <div class="kpi"><div class="kpi-l">Taux de chômage</div><div class="kpi-v">${pct(e.chomage)}</div><div class="kpi-s">${e.chomageVar != null ? `${signedPct(e.chomageVar)} sur un an` : ''}</div></div>
        <div class="kpi"><div class="kpi-l">Taux d'emploi</div><div class="kpi-v">${pct(e.tauxEmploi)}</div><div class="kpi-s">15 ans et plus</div></div>
        <div class="kpi"><div class="kpi-l">Taux d'activité</div><div class="kpi-v">${pct(e.activite)}</div><div class="kpi-s">${esc(e.periode || '')}</div></div>
      </div>
      ${grille5([4, 5.5, 7, 9], { hautBon: false, valeur: e.chomage, marque: 'cette région', fmt: (x) => pct(x, 1), libelles: { 2: 'Très bas', 1: 'Bas', 0: 'Moyen', '-1': 'Élevé', '-2': 'Très élevé' } })}`,
    { note: `Enquête sur la population active, région économique (moyenne mobile de 3 mois, ${esc(e.periode || '')}), Statistique Canada. Un chômage bas soutient la demande et la capacité de payer des acheteurs et des locataires.` }));
  }
  if (e.inoccupation != null || muni.loyer?.schl2ch) {
    out.push(section('Marché locatif régional (SCHL)', `
      ${e.inoccupation != null ? row(`Taux d'inoccupation ${e.anneeInoccupation || ''}`, pct(e.inoccupation)) : ''}
      ${muni.loyer?.schl2ch ? row(`Loyer moyen d'un 2 chambres ${muni.loyer.anneeSCHL || ''}`, money(muni.loyer.schl2ch)) : ''}
      ${muni.loyer?.affiche2ch ? row('Loyer affiché moyen (nouveaux baux), 2 chambres', money(muni.loyer.affiche2ch)) : ''}
      ${e.inoccupation != null ? grille5([1.5, 3, 4.5, 6], { hautBon: false, valeur: e.inoccupation, marque: 'cette région', fmt: (x) => pct(x, 1), libelles: { 2: 'Pénurie (très favorable au propriétaire)', 1: 'Serré', 0: 'Équilibré (3 %)', '-1': 'Détendu', '-2': 'Surplus de logements' } }) : ''}`,
    { note: `Enquête sur les logements locatifs de la SCHL${e.centreSCHL ? `, centre de ${esc(e.centreSCHL.replace(/\b\w/g, (m) => m.toUpperCase()))}` : ''}. Un taux sous 3 % signifie que les logements se louent vite (bon pour l'investisseur, difficile pour les locataires).` }));
  }
  const ratio = muni.ratioPrixRevenu;
  out.push(section('Abordabilité et croissance', `<div class="grid2">
      ${row('Prix médian d\'une maison', money(muni.types?.U?.medEst))}
      ${row('Revenu médian des ménages', money(c.revenuMenage))}
      ${row('Prix / revenu', ratio ? num1(ratio) : '—')}
      ${row('Tendance des prix', `${signedPct(muni.marche.g * 100)} / an`)}
      ${row('Croissance de la population 2016-2021', signedPct(c.croissancePop))}
      ${rep.revenuMenage ? row('Revenu médian, repère québécois', money(rep.revenuMenage)) : ''}
      ${muni.taxes?.tauxResidentiel ? row(`Taux de taxe foncière résidentiel ${muni.taxes.annee}`, `${muni.taxes.tauxResidentiel.toFixed(4).replace('.', ',')} $ / 100 $`) : ''}
    </div>
    ${ratio ? `<h4 class="sub">Prix / revenu des ménages</h4>${grille5([4, 6, 8, 10], { hautBon: false, valeur: ratio, marque: 'cette municipalité', fmt: num1, libelles: { 2: 'Très abordable', 1: 'Abordable', 0: 'Modéré', '-1': 'Cher', '-2': 'Très cher' } })}` : ''}`,
  { note: 'Prix / revenu : prix médian estimé d\'une maison divisé par le revenu médian des ménages (recensement 2021).' }));
  return out.join('');
}

/* ---------------------------------------------------------------------------
 * Risques : zone inondable, terrains contaminés, nuisances et âge du bâtiment.
 * ------------------------------------------------------------------------- */
export function risquesHtml({ unit, osm, terrains }) {
  const items = [];
  const add = (niv, titre, texte) => items.push({ niv, titre, texte });
  if (unit.zi === 2) add(-2, 'Zone inondable de grand courant (0-20 ans)', 'Construction et agrandissement très encadrés, assurance inondation coûteuse ou refusée. Vérifiez auprès de la municipalité.');
  else if (unit.zi === 1) add(-1, 'Zone inondable de faible courant (20-100 ans)', 'Certaines normes de construction s\'appliquent ; demandez un devis d\'assurance avant l\'offre.');
  else if (unit.zi === 0) add(1, 'Hors des zones inondables cartographiées', 'Selon la Base de données des zones inondables du Québec (ne couvre pas tous les cours d\'eau).');
  const proches = (terrains || []).filter((x) => x.d <= 300);
  if (proches.length) {
    const p = proches[0];
    add(p.d <= 60 ? -2 : -1, `Terrain contaminé répertorié à ${dist(p.d)}`, `${esc(p.a || 'Adresse non précisée')} — réhabilitation ${p.e === 'termine' ? 'terminée' : p.e === 'non' ? 'non requise ou non débutée' : 'en cours ou non terminée'}. ${proches.length > 1 ? `${proches.length} terrains dans un rayon de 300 m.` : ''}`);
  } else if (terrains) add(1, 'Aucun terrain contaminé répertorié à moins de 300 m', 'Répertoire des terrains contaminés du ministère de l\'Environnement.');
  if (osm) {
    if (osm.autoroute?.n) add(osm.autoroute.plusProche < 100 ? -2 : -1, `Autoroute à ${dist(osm.autoroute.plusProche)}`, 'Bruit et qualité de l\'air : visitez aux heures de pointe.');
    if (osm.voieFerree?.n) add(osm.voieFerree.plusProche < 60 ? -2 : -1, `Voie ferrée à ${dist(osm.voieFerree.plusProche)}`, 'Bruit et vibrations possibles, sifflets aux passages à niveau.');
    if (osm.industriel?.n) add(-1, `Zone industrielle à ${dist(osm.industriel.plusProche)}`, 'Camionnage, bruit ou odeurs possibles.');
    if (osm.aeroport?.n) add(0, `Aéroport ou aérodrome à ${dist(osm.aeroport.plusProche)}`, 'Vérifiez les couloirs aériens et les heures de vol.');
  }
  const an = unit.an;
  const bat = [];
  if (an) {
    if (an < 1950) bat.push('Fondations, drain français et structure : inspection approfondie');
    if (an < 1970) bat.push('Entrée d\'eau en plomb possible (bâtiments d\'avant 1970) : faites analyser l\'eau');
    if (an >= 1965 && an <= 1976) bat.push('Filage en aluminium possible (1965-1976) : vérification par un maître électricien');
    if (an < 1990) bat.push('Amiante ou vermiculite possibles dans l\'isolation et les revêtements (avant 1990)');
    if (an < 1980) bat.push('Fenêtres, isolation et chauffage souvent à moderniser');
    if (an >= 1990) bat.push('Bâtiment plus récent : vérifiez tout de même l\'entretien de la toiture et la ventilation');
  }
  return `${section('Risques et nuisances', items.length ? `<ul class="risques">${items.map((x) => `<li>${tag5(x.niv, { 2: 'Très bien', 1: 'Bien', 0: 'À vérifier', '-1': 'Attention', '-2': 'Risque élevé' })}<div><b>${x.titre}</b><p>${x.texte}</p></div></li>`).join('')}</ul>`
    : '<p class="loading">Analyse des risques…</p>', { note: 'Sources : ministère de l\'Environnement (zones inondables, terrains contaminés), OpenStreetMap. Indicatif : consultez le certificat de localisation et la municipalité.' })}
    ${bat.length ? section(`Bâtiment de ${an} : points à inspecter`, `<ul class="check">${bat.map((b) => `<li>${b}</li>`).join('')}</ul>`) : ''}`;
}

