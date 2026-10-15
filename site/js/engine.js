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

/** Propriétés comparables : même type, logements semblables, les plus proches. */
export function comparables(unit, units, munis, meta, { max = 8, rayon = 1500 } = {}) {
  const out = [];
  for (const u of units) {
    if (u.id === unit.id || u.t !== unit.t) continue;
    if (unit.t === 'P' && Math.abs((u.lg || 0) - (unit.lg || 0)) > 1) continue;
    if (unit.t === 'C' && u.lat === unit.lat && u.lon === unit.lon && u.aire === unit.aire) continue;
    const d = distance(unit, u);
    if (d > rayon) continue;
    const m = munis[u.muni];
    if (!m) continue;
    const est = estimate(u, m, meta);
    out.push({ ...u, d, est: est.valeur, m2: u.aire ? est.valeur / u.aire : null });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, max);
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
    inspection = 600, revenu,
  } = p;
  const mise = prix * (misePct / 100);
  const schl = primeSCHL(prix, misePct);
  const pret = prix - mise + (schl.montant || 0);
  const paiement = paiementMensuel(pret, taux, amort);
  const dm = droitsMutation(prix, code, meta);
  // Taux de qualification (« test de résistance ») : le plus élevé de taux + 2 % ou 5,25 %.
  const tauxQualif = Math.max(taux + 2, 5.25);
  const paiementQualif = paiementMensuel(pret, tauxQualif, amort);
  const logement = paiementQualif + taxesAnnuelles / 12 + chauffageMensuel;
  const revenuRequis = Math.round((logement * 12) / 0.39 / 1000) * 1000;
  // Prix maximal pour un revenu donné (ABD 39 %).
  let prixMax = null;
  if (revenu) {
    const budget = (revenu * 0.39) / 12 - chauffageMensuel - taxesAnnuelles / 12;
    const i = (1 + tauxQualif / 100 / 2) ** (2 / 12) - 1;
    const n = amort * 12;
    const pretMax = budget > 0 ? (budget * (1 - (1 + i) ** -n)) / i : 0;
    prixMax = Math.round(pretMax / (1 - misePct / 100) / 1000) * 1000;
  }
  return {
    mise: Math.round(mise), schl, pret: Math.round(pret), paiement: Math.round(paiement),
    droits: dm, fraisNotaire, inspection,
    comptant: Math.round(mise + dm.total + fraisNotaire + inspection),
    coutMensuel: Math.round(paiement + taxesAnnuelles / 12 + chauffageMensuel),
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
