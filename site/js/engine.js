// Moteur de calcul de DataHouse : fonctions pures, sans accès au DOM.
// Toutes les valeurs sont en dollars canadiens.

export const TYPE_ORDER = ['U', 'C', 'P', 'M', 'H', 'R', 'X'];

const round = (x, step = 1) => Math.round(x / step) * step;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Décode une ligne de tuile en objet unité d'évaluation. */
export function decodeUnit(row, codes) {
  const [lon, lat, mi, adr, t, lg, an, aire, ter, vr, va, et, li, id] = row;
  return {
    lon: lon / 1e5, lat: lat / 1e5, muni: codes[mi], adr, t, lg, an, aire, ter, vr, va, et, li, id,
  };
}

/** Estimation de la valeur marchande actuelle et de sa fourchette. */
export function estimate(unit, muni, meta) {
  const m = muni.marche;
  const base = (meta.incertitudeBase || {})[unit.t] ?? 0.1;
  let half = base + (m.incertitudeExtra || 0);
  // Les propriétés hors norme (très grandes ou très anciennes) sont moins prévisibles.
  const ts = muni.types?.[unit.t];
  if (ts && unit.vr && ts.medRole && (unit.vr > 2.5 * ts.medRole || unit.vr < 0.35 * ts.medRole)) half += 0.04;
  half = clamp(half, 0.05, 0.3);
  const value = unit.vr * m.adj;
  return {
    valeur: round(value, 1000),
    bas: round(value * (1 - half), 5000),
    haut: round(value * (1 + half), 5000),
    marge: half,
    facteurs: {
      role: unit.vr,
      fc: m.fc,
      fcAnnee: m.fcAnnee,
      tendance: m.g,
      annees: m.anneesExtrapolees,
      ajustement: m.adj,
      sansFacteur: m.sansFacteur,
      sourceTendance: m.gSource,
    },
  };
}

/** Rang centile d'une valeur dans l'histogramme d'un type de propriété (0-100). */
export function percentile(value, hist) {
  if (!hist || !hist.n?.length) return null;
  const total = hist.n.reduce((a, b) => a + b, 0);
  if (!total) return null;
  const width = (hist.max - hist.min) / hist.n.length;
  if (value <= hist.min) return 5;
  if (value >= hist.max) return 95;
  let acc = 0;
  for (let i = 0; i < hist.n.length; i++) {
    const lo = hist.min + i * width;
    if (value < lo + width) {
      acc += hist.n[i] * ((value - lo) / width);
      break;
    }
    acc += hist.n[i];
  }
  return Math.round(5 + 90 * (acc / total));
}

/** Distance en mètres (haversine). */
export function distance(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const memeImmeuble = (a, b) => Math.abs(a.lat - b.lat) < 0.00002 && Math.abs(a.lon - b.lon) < 0.00002;

/**
 * Propriétés comparables : même type, taille semblable, les plus proches et les plus semblables.
 * - Condo : condos d'AUTRES immeubles du voisinage (ceux du même immeuble sont fournis à part par `immeuble`).
 * - Plex : même nombre de logements (un triplex se compare à des triplex), à défaut ±1.
 * - Maison : superficie habitable semblable.
 */
export function comparables(unit, units, munis, meta, { max = 8, rayon = 1500 } = {}) {
  const candidats = [];
  for (const u of units) {
    if (u.id === unit.id || u.t !== unit.t) continue;
    if (unit.t === 'C' && memeImmeuble(u, unit)) continue;
    const d = distance(unit, u);
    if (d > rayon) continue;
    const ecartLg = Math.abs((u.lg || 0) - (unit.lg || 0));
    if (unit.t === 'P' && ecartLg > 1) continue;
    const m = munis[u.muni];
    if (!m) continue;
    const ratioAire = unit.aire && u.aire ? Math.max(unit.aire, u.aire) / Math.min(unit.aire, u.aire) : 1.3;
    if (ratioAire > 1.8) continue;
    const ecartAn = unit.an && u.an ? Math.abs(unit.an - u.an) : 15;
    // Pénalité de dissemblance exprimée en « mètres équivalents ».
    const score = d + (ratioAire - 1) * 900 + Math.min(ecartAn, 60) * 8 + (unit.t === 'P' ? ecartLg * 700 : 0);
    const est = estimate(u, m, meta);
    candidats.push({ ...u, d, score, est: est.valeur, m2: u.aire ? est.valeur / u.aire : null, memeLg: ecartLg === 0 });
  }
  candidats.sort((a, b) => a.score - b.score);
  // Un seul condo par immeuble voisin, pour élargir l'échantillon.
  const vus = new Set();
  const out = [];
  for (const c of candidats) {
    if (unit.t === 'C') {
      const k = `${c.lat.toFixed(5)},${c.lon.toFixed(5)}`;
      if (vus.has(k)) continue;
      vus.add(k);
    }
    out.push(c);
    if (out.length >= max) break;
  }
  return out.sort((a, b) => a.d - b.d);
}

/** Portrait de l'immeuble d'un condo : nombre d'unités, valeurs et rang de l'unité. */
export function immeuble(unit, units, muni, meta) {
  const memes = units.filter((u) => memeImmeuble(u, unit) && u.t === unit.t);
  if (!memes.length) return null;
  const vals = memes.map((u) => estimate(u, muni, meta).valeur).sort((a, b) => a - b);
  const aires = memes.map((u) => u.aire).filter(Boolean);
  const mine = estimate(unit, muni, meta).valeur;
  const rang = vals.filter((v) => v < mine).length;
  return {
    unites: memes.length,
    medianeValeur: median(vals),
    min: vals[0],
    max: vals[vals.length - 1],
    medianeAire: median(aires),
    centile: memes.length > 1 ? Math.round((100 * rang) / (memes.length - 1)) : null,
    etages: Math.max(...memes.map((u) => u.et || 0)) || null,
    annee: unit.an || memes.find((u) => u.an)?.an || null,
  };
}

/**
 * Frais de copropriété mensuels estimés (aucune source publique ne les publie).
 * Repère usuel au Québec : environ 0,25 $ à 0,40 $ par pi² habitable par mois, selon l'âge
 * et la taille de l'immeuble (ascenseurs, aires communes, fonds de prévoyance).
 */
export function fraisCondo(unit, nbUnites) {
  if (unit.t !== 'C' || !unit.aire) return null;
  const pi2 = unit.aire * 10.7639;
  let taux = 0.31;
  const facteurs = [];
  if (unit.an) {
    if (unit.an < 1975) { taux += 0.06; facteurs.push('age-ancien'); }
    else if (unit.an < 2000) { taux += 0.03; facteurs.push('age-moyen'); }
    else if (unit.an >= 2015) { taux -= 0.04; facteurs.push('age-recent'); }
  }
  if (nbUnites) {
    if (nbUnites <= 6) { taux -= 0.06; facteurs.push('petit'); }
    else if (nbUnites >= 80) { taux += 0.05; facteurs.push('grand'); }
  }
  const mensuel = round(pi2 * taux, 5);
  return { mensuel, bas: round(mensuel * 0.75, 5), haut: round(mensuel * 1.3, 5), parPi2: taux, facteurs };
}

/**
 * Taxes foncières annuelles estimées : taux résidentiel adopté par la municipalité (MAMH, par 100 $
 * d'évaluation) + taxe scolaire approximative (environ 0,09 $ par 100 $, au-delà de 25 000 $).
 * Les taxes d'arrondissement, tarifs (eau, ordures) et taxes de secteur ne sont pas inclus.
 */
export function taxesFoncieres(unit, muni, tauxDefautPct = 1.0) {
  const vr = unit.vr || 0;
  const t = muni.taxes?.tauxResidentiel;
  if (!t) return { total: round(vr * tauxDefautPct / 100, 10), municipale: null, scolaire: null, taux: null, source: 'defaut' };
  const municipale = (vr * t) / 100;
  const scolaire = Math.max(0, vr - 25000) * 0.0009;
  return { total: round(municipale + scolaire, 10), municipale: round(municipale, 10), scolaire: round(scolaire, 10),
    taux: t, annee: muni.taxes.annee, source: 'mamh' };
}

/** Écart (en %) entre la valeur au m² de la propriété et la médiane de ses comparables. */
export function ecartComparables(unit, est, comps) {
  const m2 = unit.aire ? est.valeur / unit.aire : null;
  const med = median((comps || []).map((c) => c.m2));
  return m2 && med ? ((m2 - med) / med) * 100 : null;
}

/* ---------------------------------------------------------------------------
 * Zones de prix et de loyer, et scores par profil.
 * Paliers : « favorable » (pouce en haut), « neutre », « defavorable » (pouce en bas).
 * ------------------------------------------------------------------------- */
export const PALIERS = { favorable: 65, neutre: 45 };
export const palier = (score) => (score == null ? null : score >= PALIERS.favorable ? 'favorable' : score >= PALIERS.neutre ? 'neutre' : 'defavorable');

/** Revenu net d'exploitation annuel d'un immeuble selon un scénario (indépendant du prix). */
function rneScenario(st) {
  const brut = (st.logements * st.loyer) * 12;
  const eff = brut * (1 - (st.vacance ?? 3) / 100);
  return eff - (st.taxes || 0) - (st.assurances || 0) - (st.fraisCondo || 0) * 12 - eff * ((st.entretien ?? 5) / 100) - eff * ((st.gestion ?? 0) / 100);
}

/**
 * Seuils de prix pour chaque profil.
 * Acheteur et vendeur : selon la fourchette estimée. Investisseur : selon le taux de capitalisation
 * obtenu avec le loyer retenu (5 % ou mieux = favorable, moins de 4 % = défavorable).
 */
export function zonesPrix(est, st, { capFavorable = 5, capDefavorable = 4 } = {}) {
  const bas = round((est.bas + est.valeur) / 2, 1000);
  const haut = round((est.valeur + est.haut) / 2, 1000);
  const zones = {
    acheteur: { favorable: [null, bas], neutre: [bas, haut], defavorable: [haut, null] },
    vendeur: { defavorable: [null, bas], neutre: [bas, haut], favorable: [haut, null] },
  };
  if (st && st.loyer > 0) {
    const rne = rneScenario(st);
    if (rne > 0) {
      const pFav = round(rne / (capFavorable / 100), 1000);
      const pDef = round(rne / (capDefavorable / 100), 1000);
      zones.investisseur = { favorable: [null, pFav], neutre: [pFav, pDef], defavorable: [pDef, null], rne: Math.round(rne) };
    }
  }
  return zones;
}

/** Palier d'un prix donné pour un profil. */
export function palierPrix(zones, profil, prix) {
  const z = zones[profil];
  if (!z) return null;
  for (const k of ['favorable', 'neutre', 'defavorable']) {
    const [lo, hi] = z[k];
    if ((lo == null || prix >= lo) && (hi == null || prix < hi)) return k;
  }
  return null;
}

/** Loyer qui équilibre les liquidités (après hypothèque) et zones de loyer pour l'investisseur. */
export function zonesLoyer(loyerMarche, st) {
  if (!loyerMarche) return null;
  const n = Math.max(1, st.logements || 1);
  const pret = st.prix * (1 - Math.max(20, st.misePct || 20) / 100);
  const service = paiementMensuel(pret, st.taux, st.amort || 25) * 12;
  const vac = 1 - (st.vacance ?? 3) / 100;
  const varPct = ((st.entretien ?? 5) + (st.gestion ?? 0)) / 100;
  const fixes = (st.taxes || 0) + (st.assurances || 0) + (st.fraisCondo || 0) * 12 + service;
  // eff × (1 − var) = fixes  →  loyer = fixes / ((1 − var) × vac × 12 × n)
  const equilibre = round(fixes / ((1 - varPct) * vac * 12 * n), 5);
  return {
    marche: loyerMarche,
    equilibre,
    defavorable: [null, round(loyerMarche * 0.9, 5)],
    neutre: [round(loyerMarche * 0.9, 5), loyerMarche],
    favorable: [loyerMarche, round(loyerMarche * 1.15, 5)],
    risque: round(loyerMarche * 1.15, 5),
  };
}

export function palierLoyer(z, loyer) {
  if (!z || !loyer) return null;
  if (loyer >= z.risque) return 'risque';
  if (loyer >= z.marche) return 'favorable';
  if (loyer >= z.defavorable[1]) return 'neutre';
  return 'defavorable';
}

const lin = (x, x0, x1) => (x == null ? null : clamp(((x - x0) / (x1 - x0)) * 100, 0, 100));
function moyenne(facteurs) {
  const ok = facteurs.filter((f) => f.score != null);
  if (ok.length < 2) return null;
  const poids = ok.reduce((a, f) => a + f.poids, 0);
  return Math.round(ok.reduce((a, f) => a + f.score * f.poids, 0) / poids);
}

/**
 * Scores de 0 à 100 pour l'acheteur, le vendeur et l'investisseur, avec le détail des facteurs.
 * `osm` (commodités) est facultatif.
 */
export function scores({ unit, muni, est, pc, comps, st, osm }) {
  const c = muni.recensement || {};
  const g = muni.marche?.g != null ? muni.marche.g * 100 : null;
  const ecart = ecartComparables(unit, est, comps);
  const rv = indiceRevente(unit, muni, pc);
  const ratio = muni.ratioPrixRevenu;
  let commodites = null;
  if (osm) {
    const pts = [
      osm.rail?.plusProche != null && osm.rail.plusProche <= 1000,
      osm.bus?.plusProche != null && osm.bus.plusProche <= 400,
      osm.epicerie?.plusProche != null && osm.epicerie.plusProche <= 800,
      osm.ecole?.plusProche != null && osm.ecole.plusProche <= 800,
      osm.parc?.plusProche != null && osm.parc.plusProche <= 400,
      osm.sante?.plusProche != null && osm.sante.plusProche <= 1000,
    ].filter(Boolean).length;
    const nuis = ['autoroute', 'voieFerree', 'industriel'].filter((k) => osm[k]?.n).length;
    commodites = clamp(Math.round((pts / 6) * 100 - nuis * 15), 0, 100);
  }
  const prixVsMarche = st?.prix && est.valeur ? (st.prix / est.valeur - 1) * 100 : 0;

  const acheteur = [
    { k: 'prixDemande', poids: 3, score: lin(-prixVsMarche, -15, 10), valeur: prixVsMarche },
    { k: 'valeurVoisins', poids: 2, score: ecart == null ? null : lin(-ecart, -25, 20), valeur: ecart },
    { k: 'abordabilite', poids: 1.5, score: ratio == null ? null : lin(-ratio, -12, -4), valeur: ratio },
    { k: 'revente', poids: 1.5, score: rv?.score ?? null, valeur: rv?.score },
    { k: 'etat', poids: 1, score: unit.an ? lin(unit.an, 1940, 2015) : null, valeur: unit.an },
    { k: 'commodites', poids: 1.5, score: commodites, valeur: commodites },
    { k: 'precision', poids: 0.5, score: lin(-est.marge, -0.25, -0.08), valeur: est.marge * 100 },
  ];
  const vendeur = [
    { k: 'tendance', poids: 2.5, score: g == null ? null : lin(g, -2, 8), valeur: g },
    { k: 'liquidite', poids: 2, score: muni.liquidite?.score ?? null, valeur: muni.liquidite?.score },
    { k: 'positionMarche', poids: 1.5, score: pc == null ? null : clamp(100 - Math.abs(pc - 50) * 1.6, 0, 100), valeur: pc },
    { k: 'valeurVoisins', poids: 1.5, score: ecart == null ? null : lin(ecart, -20, 25), valeur: ecart },
    { k: 'demande', poids: 1, score: c.croissancePop == null ? null : lin(c.croissancePop, -2, 10), valeur: c.croissancePop },
    { k: 'commodites', poids: 1, score: commodites, valeur: commodites },
  ];
  let investisseur = null;
  if (st && st.loyer > 0) {
    const i = analyseInvestisseur({ prix: st.prix, logements: st.logements, loyer: st.loyer, vacancePct: st.vacance,
      taxes: st.taxes, assurances: st.assurances, entretienPct: st.entretien, gestionPct: st.gestion,
      autresDepenses: (st.fraisCondo || 0) * 12, misePct: Math.max(20, st.misePct || 20), taux: st.taux, amort: st.amort || 25 });
    investisseur = [
      { k: 'capitalisation', poids: 3, score: lin(i.tauxCapitalisation, 3, 6.5), valeur: i.tauxCapitalisation },
      { k: 'liquidites', poids: 2, score: lin(i.liquiditeMensuelle / Math.max(1, st.logements), -400, 250), valeur: i.liquiditeMensuelle },
      { k: 'couverture', poids: 1.5, score: i.rcd == null ? null : lin(i.rcd, 0.8, 1.4), valeur: i.rcd },
      { k: 'bassinLocatif', poids: 1, score: c.pctProprio == null ? null : lin(100 - c.pctProprio, 20, 65), valeur: c.pctProprio == null ? null : 100 - c.pctProprio },
      { k: 'capaciteLocataires', poids: 1, score: c.pctInabordableLocataire == null ? null : lin(-c.pctInabordableLocataire, -40, -15), valeur: c.pctInabordableLocataire },
      { k: 'plusValue', poids: 1, score: g == null ? null : lin(g, -1, 7), valeur: g },
    ];
  }
  const pack = (f) => {
    if (!f) return null;
    const score = moyenne(f);
    return { score, palier: palier(score), facteurs: f.filter((x) => x.score != null).map((x) => ({ ...x, score: Math.round(x.score) })) };
  };
  return { acheteur: pack(acheteur), vendeur: pack(vendeur), investisseur: pack(investisseur) };
}

export function median(arr) {
  const v = arr.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Droits sur les mutations immobilières (« taxe de bienvenue »). */
export function droitsMutation(prix, code, meta) {
  const dm = meta.droitsMutation;
  const tranches = dm.municipal?.[code]?.tranches || dm.base;
  let reste = prix;
  let bas = 0;
  let total = 0;
  const detail = [];
  for (const [plafond, taux] of tranches) {
    const haut = plafond ?? Infinity;
    const portion = Math.max(0, Math.min(prix, haut) - bas);
    if (portion > 0) {
      total += portion * taux;
      detail.push({ de: bas, a: plafond, taux, montant: portion * taux });
    }
    bas = haut;
    reste -= portion;
    if (reste <= 0) break;
  }
  return { total: Math.round(total), detail, specifique: Boolean(dm.municipal?.[code]) };
}

/** Prime d'assurance prêt hypothécaire (SCHL) selon la mise de fonds. */
export function primeSCHL(prix, misePct) {
  if (misePct >= 20 || prix >= 1500000) return { taux: 0, montant: 0, admissible: misePct >= 20 };
  let taux;
  if (misePct >= 15) taux = 0.028;
  else if (misePct >= 10) taux = 0.031;
  else if (misePct >= 5) taux = 0.04;
  else return { taux: null, montant: null, admissible: false };
  const pret = prix * (1 - misePct / 100);
  return { taux, montant: Math.round(pret * taux), admissible: true };
}

/** Paiement mensuel d'un prêt hypothécaire canadien (intérêt composé semestriellement). */
export function paiementMensuel(pret, tauxAnnuelPct, ansAmortissement) {
  if (!pret || pret <= 0) return 0;
  const j = tauxAnnuelPct / 100;
  const i = (1 + j / 2) ** (2 / 12) - 1;
  const n = ansAmortissement * 12;
  if (i === 0) return pret / n;
  return (pret * i) / (1 - (1 + i) ** -n);
}

/** Analyse acheteur : coûts d'acquisition, paiements et revenu requis. */
export function analyseAcheteur(p) {
  const {
    prix, misePct, taux, amort, code, meta, taxesAnnuelles, chauffageMensuel = 100, fraisNotaire = 2000,
    inspection = 600, revenu, fraisCondo = 0,
  } = p;
  const mise = prix * (misePct / 100);
  const schl = primeSCHL(prix, misePct);
  const pret = prix - mise + (schl.montant || 0);
  const paiement = paiementMensuel(pret, taux, amort);
  const dm = droitsMutation(prix, code, meta);
  // Taux de qualification (« test de résistance ») : le plus élevé de taux + 2 % ou 5,25 %.
  const tauxQualif = Math.max(taux + 2, 5.25);
  const paiementQualif = paiementMensuel(pret, tauxQualif, amort);
  // Les prêteurs comptent habituellement 50 % des frais de copropriété dans le ratio d'amortissement.
  const logement = paiementQualif + taxesAnnuelles / 12 + chauffageMensuel + fraisCondo * 0.5;
  const revenuRequis = Math.round((logement * 12) / 0.39 / 1000) * 1000;
  // Prix maximal pour un revenu donné (ABD 39 %).
  let prixMax = null;
  if (revenu) {
    const budget = (revenu * 0.39) / 12 - chauffageMensuel - taxesAnnuelles / 12 - fraisCondo * 0.5;
    const i = (1 + tauxQualif / 100 / 2) ** (2 / 12) - 1;
    const n = amort * 12;
    const pretMax = budget > 0 ? (budget * (1 - (1 + i) ** -n)) / i : 0;
    prixMax = Math.round(pretMax / (1 - misePct / 100) / 1000) * 1000;
  }
  return {
    mise: Math.round(mise), schl, pret: Math.round(pret), paiement: Math.round(paiement),
    droits: dm, fraisNotaire, inspection,
    comptant: Math.round(mise + dm.total + fraisNotaire + inspection),
    coutMensuel: Math.round(paiement + taxesAnnuelles / 12 + chauffageMensuel + fraisCondo),
    tauxQualif, revenuRequis, prixMax,
  };
}

/** Analyse vendeur : stratégies de prix et économies de commission. */
export function analyseVendeur({ est, commissionPct, taxesPct = 14.975 }) {
  const strategies = [
    { nom: 'Vente rapide', prix: round(est.bas + (est.valeur - est.bas) * 0.4, 1000),
      note: 'Sous la valeur centrale : attire plus d\'acheteurs, délai plus court.' },
    { nom: 'Équilibrée', prix: round(est.valeur * 1.01, 1000),
      note: 'Proche de la valeur centrale, légère marge de négociation.' },
    { nom: 'Ambitieuse', prix: round(est.valeur + (est.haut - est.valeur) * 0.6, 1000),
      note: 'Haut de fourchette : délai plus long, justifier par l\'état et les rénovations.' },
  ];
  const commission = est.valeur * (commissionPct / 100);
  const taxes = commission * (taxesPct / 100);
  return { strategies, commission: Math.round(commission), taxes: Math.round(taxes),
    total: Math.round(commission + taxes) };
}

/** Analyse investisseur : revenus, dépenses, financement et ratios usuels. */
export function analyseInvestisseur(p) {
  const {
    prix, logements, loyer, autresRevenus = 0, vacancePct = 3, taxes, assurances, entretienPct = 5,
    gestionPct = 0, autresDepenses = 0, misePct = 20, taux, amort = 25,
  } = p;
  const brut = (logements * loyer + autresRevenus) * 12;
  const effectif = brut * (1 - vacancePct / 100);
  const depenses = taxes + assurances + effectif * (entretienPct / 100) + effectif * (gestionPct / 100) + autresDepenses;
  const rne = effectif - depenses; // revenu net d'exploitation
  const pret = prix * (1 - misePct / 100);
  const service = paiementMensuel(pret, taux, amort) * 12;
  const liquidite = rne - service;
  const mise = prix * (misePct / 100);
  return {
    revenusBruts: Math.round(brut), revenusEffectifs: Math.round(effectif), depenses: Math.round(depenses),
    rne: Math.round(rne), serviceDette: Math.round(service), liquiditeAnnuelle: Math.round(liquidite),
    liquiditeMensuelle: Math.round(liquidite / 12),
    tauxCapitalisation: prix ? (rne / prix) * 100 : null,
    rendementBrut: prix ? (brut / prix) * 100 : null,
    mrb: brut ? prix / brut : null, // multiplicateur de revenus bruts
    rcd: service ? rne / service : null, // ratio de couverture de la dette
    rendementMise: mise ? (liquidite / mise) * 100 : null,
    prixParPorte: logements ? Math.round(prix / logements) : null,
  };
}

/** Loyer mensuel estimé par logement, ajusté selon la superficie. */
export function loyerEstime(unit, muni) {
  const base = muni.loyer?.estime;
  if (!base) return null;
  const n = Math.max(1, unit.lg || 1);
  const aireLog = unit.aire ? unit.aire / n : null;
  const f = aireLog ? clamp((aireLog / 75) ** 0.3, 0.8, 1.3) : 1;
  return round(base * f, 5);
}

/** Indice de facilité de revente (0-100) propre à la propriété. */
export function indiceRevente(unit, muni, pct) {
  const baseScore = muni.liquidite?.score;
  if (baseScore == null) return null;
  const ajustType = { U: 4, C: 2, P: 0, M: -8, H: -10, R: -12, X: -10 }[unit.t] ?? 0;
  let ajustPrix = 0;
  if (pct != null) {
    if (pct > 90) ajustPrix = -8;
    else if (pct > 75) ajustPrix = -3;
    else if (pct < 10) ajustPrix = -2;
    else if (pct >= 25 && pct <= 65) ajustPrix = 3;
  }
  const score = clamp(Math.round(baseScore + ajustType + ajustPrix), 0, 100);
  let niveau = 'Moyenne';
  if (score >= 70) niveau = 'Élevée';
  else if (score >= 55) niveau = 'Bonne';
  else if (score < 35) niveau = 'Faible';
  return { score, niveau, ajustType, ajustPrix };
}
