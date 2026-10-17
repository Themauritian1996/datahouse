// Synthèse rédigée, rapport PDF téléchargeable, partage et exports.
import { CONFIG } from './config.js';
import {
  analyseAcheteur, analyseVendeur, analyseInvestisseur, indiceRevente, median, scores, zonesPrix, palierPrix, zonesLoyer, palierLoyer,
  loyerEstime, ecartComparables, taxesFoncieres, grillePrix, grilleLoyer,
} from './engine.js';
import { prosCons, environs } from './analysis.js';
import { fmt, uniteLabel } from './format.js';
import { TYPES, R, PROFILS, PALIERS, FACTEURS, NIVEAUX, titreComparables } from './i18n.js';
import { vueAerienne, photoFacade, enDataUrl, ORTHO_CREDIT } from './photo.js';
import { langueRapport, unites } from './prefs.js';
import { lieuxAutour, scoreProximite, niveau5 } from './quartier.js';

export const isNative = () => Boolean(window.Capacitor?.isNativePlatform?.());

/* ---------------------------------------------------------------------------
 * Synthèse : un résumé rédigé, en langage clair, à partir des chiffres calculés (français ou anglais).
 * ------------------------------------------------------------------------- */
export function synthese({ unit, muni, est, pc, comps, st, meta, imm, frais }, lang = 'fr') {
  const en = lang === 'en';
  const F = fmt(lang);
  const phrases = [];
  const type = (en ? TYPES.en[unit.t] : (meta.typeLabels[unit.t] || 'propriété')).toLowerCase();
  const m = muni.marche;
  phrases.push(en
    ? `This ${type} in ${muni.nom} is estimated at about ${F.kmoney(est.valeur)}, within a range of ${F.kmoney(est.bas)} to ${F.kmoney(est.haut)}.`
    : `Cette ${type} de ${muni.nom} est estimée à environ ${F.kmoney(est.valeur)}, dans une fourchette de ${F.kmoney(est.bas)} à ${F.kmoney(est.haut)}.`);
  if (pc != null) {
    const pos = en ? (pc >= 75 ? 'in the upper end of the local market' : pc <= 25 ? 'in the lower end of the local market' : 'in the middle of the local market')
      : (pc >= 75 ? 'dans le haut du marché local' : pc <= 25 ? 'dans le bas du marché local' : 'dans la moyenne du marché local');
    phrases.push(en ? `It sits ${pos} (higher than ${pc}% of comparable properties in the municipality).`
      : `Elle se situe ${pos} (plus élevée que ${pc} % des propriétés comparables de la municipalité).`);
  }
  const m2 = unit.aire ? est.valeur / unit.aire : null;
  const compM2 = median((comps || []).map((c) => c.m2));
  if (m2 && compM2) {
    const ecart = ((m2 - compM2) / compM2) * 100;
    const qui = unit.t === 'C' ? (en ? 'condos in nearby buildings' : 'condos des immeubles voisins')
      : (en ? 'similar nearby properties' : 'propriétés semblables du voisinage');
    if (Math.abs(ecart) >= 8) {
      phrases.push(en ? `Its price per area is ${Math.abs(Math.round(ecart))}% ${ecart > 0 ? 'higher' : 'lower'} than ${qui}.`
        : `Son prix au ${uniteLabel()} est ${ecart > 0 ? 'supérieur' : 'inférieur'} de ${Math.abs(Math.round(ecart))} % à celui des ${qui}.`);
    } else phrases.push(en ? `Its price per area is in line with ${qui}.` : `Son prix au ${uniteLabel()} est cohérent avec celui des ${qui}.`);
  }
  if (imm && imm.unites > 1) {
    phrases.push(en ? `The building has ${imm.unites} condo units${imm.centile != null ? `; this unit is worth more than ${imm.centile}% of them` : ''}.`
      : `L'immeuble compte ${imm.unites} unités de copropriété${imm.centile != null ? ` ; cette unité vaut plus que ${imm.centile} % d'entre elles` : ''}.`);
  }
  if (frais) {
    phrases.push(en ? `Condo fees are estimated at about ${F.money(frais.mensuel)} per month (to be confirmed with the syndicate's budget).`
      : `Les frais de copropriété sont estimés à environ ${F.money(frais.mensuel)} par mois (à confirmer avec le budget du syndicat).`);
  }
  if (m.g != null) {
    const g = m.g * 100;
    const tend = en ? (g >= 6 ? 'rising fast' : g >= 3 ? 'rising steadily' : g >= 0.5 ? 'rising moderately' : g > -0.5 ? 'stable' : 'declining')
      : (g >= 6 ? 'en forte hausse' : g >= 3 ? 'en hausse soutenue' : g >= 0.5 ? 'en hausse modérée' : g > -0.5 ? 'stable' : 'en baisse');
    phrases.push(en ? `The ${muni.nom} market is ${tend} (about ${F.signedPct(g)} per year).` : `Le marché de ${muni.nom} est ${tend} (environ ${F.signedPct(g)} par an).`);
  }
  if (st) {
    const i = analyseInvestisseur({ prix: st.prix, logements: st.logements, loyer: st.loyer, vacancePct: st.vacance,
      taxes: st.taxes, assurances: st.assurances, entretienPct: st.entretien, gestionPct: st.gestion, autresDepenses: (st.fraisCondo || 0) * 12,
      misePct: Math.max(20, st.misePct), taux: st.taux, amort: st.amort });
    if (st.loyer && (unit.lg || 1) > 1) {
      const qual = en ? (i.tauxCapitalisation >= 5 ? 'attractive' : i.tauxCapitalisation >= 3.5 ? 'fair' : 'weak')
        : (i.tauxCapitalisation >= 5 ? 'intéressant' : i.tauxCapitalisation >= 3.5 ? 'correct' : 'faible');
      phrases.push(en ? `As a rental, the return is ${qual}: cap rate of about ${F.pct(i.tauxCapitalisation)} and cash flow of ${F.money(i.liquiditeMensuelle)} per month after the mortgage (20% down).`
        : `Sur le plan locatif, le rendement est ${qual} : taux de capitalisation d'environ ${F.pct(i.tauxCapitalisation)} et liquidités de ${F.money(i.liquiditeMensuelle)} par mois après hypothèque (20 % de mise de fonds).`);
    }
    const a = analyseAcheteur({ prix: st.prix, misePct: st.misePct, taux: st.taux, amort: st.amort, code: muni.code, meta,
      taxesAnnuelles: st.taxes, fraisCondo: st.fraisCondo || 0 });
    phrases.push(en ? `To buy, plan for about ${F.kmoney(a.comptant)} in cash (down payment, welcome tax and fees) and a mortgage payment of about ${F.money(a.paiement)} per month.`
      : `À l'achat, prévoyez environ ${F.kmoney(a.comptant)} comptant (mise de fonds, droits de mutation et frais) et un paiement hypothécaire d'environ ${F.money(a.paiement)} par mois.`);
  }
  const rv = indiceRevente(unit, muni, pc);
  if (rv) {
    const niv = en ? { 'Élevée': 'high', Bonne: 'good', Moyenne: 'average', Faible: 'low' }[rv.niveau] : rv.niveau.toLowerCase();
    phrases.push(en ? `Ease of resale is rated ${niv} (${rv.score}/100).` : `La facilité de revente est jugée ${niv} (${rv.score}/100).`);
  }
  if (est.marge >= 0.15) phrases.push(en ? 'As the property is atypical for its area, a certified appraisal is recommended before any decision.'
    : 'Comme la propriété est atypique pour son secteur, une évaluation agréée est recommandée avant toute décision.');
  return phrases.join(' ');
}

/* ---------------------------------------------------------------------------
 * Téléchargement et partage (navigateur ou application Android).
 * ------------------------------------------------------------------------- */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export async function saveFile(blob, filename, title = filename) {
  const P = window.Capacitor?.Plugins;
  if (isNative() && P?.Filesystem && P?.Share) {
    const data = await blobToBase64(blob);
    const res = await P.Filesystem.writeFile({ path: filename, data, directory: 'CACHE' });
    await P.Share.share({ title, files: [res.uri], dialogTitle: 'Enregistrer ou partager' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function shareLink(title, text) {
  const url = location.href.replace(/[?&]v=\d+/, '');
  const P = window.Capacitor?.Plugins;
  try {
    if (isNative() && P?.Share) { await P.Share.share({ title, text, url }); return 'partage'; }
    if (navigator.share) { await navigator.share({ title, text, url }); return 'partage'; }
  } catch (e) {
    if (e?.name === 'AbortError') return 'annule';
  }
  await navigator.clipboard?.writeText(url);
  return 'copie';
}

export function comparablesCsv(unit, comps) {
  const head = ['Adresse', 'Distance (m)', 'Type', 'Année', 'Aire (m2)', 'Terrain (m2)', 'Logements', 'Valeur au rôle', 'Valeur estimée', 'Prix au m2'];
  const q = (v) => (v == null ? '' : /[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = [[unit.adr, 0, unit.t, unit.an, unit.aire, unit.ter, unit.lg, unit.vr, '', ''],
    ...comps.map((c) => [c.adr, Math.round(c.d), c.t, c.an, c.aire, c.ter, c.lg, c.vr, c.est, c.m2 ? Math.round(c.m2) : ''])];
  const csv = [head, ...rows].map((r) => r.map(q).join(';')).join('\r\n');
  return new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
}

/* ---------------------------------------------------------------------------
 * Rapport PDF (jsPDF, chargé à la demande).
 * ------------------------------------------------------------------------- */
let pdfLibs;
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, onload: resolve, onerror: reject });
    document.head.appendChild(s);
  });
}
async function loadPdf() {
  pdfLibs ??= loadScript('lib/jspdf.umd.min.js').then(() => loadScript('lib/jspdf.plugin.autotable.min.js'));
  await pdfLibs;
  return window.jspdf.jsPDF;
}

// La police standard des PDF ne couvre que le Latin-1 : on remplace les rares caractères hors de cet ensemble.
const clean = (s) => String(s ?? '')
  .replace(/[  ]/g, ' ').replace(/ /g, ' ').replace(/[−–—]/g, '-')
  .replace(/≈/g, '~').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
  .replace(/²/g, '2').replace(/[^\x00-\xff]/g, '');


const C = {
  ink: [22, 24, 29], muted: [93, 102, 98], line: [221, 226, 223], soft: [243, 245, 244],
  good: [30, 122, 79], goodBg: [227, 241, 233], bad: [184, 67, 47], badBg: [248, 231, 227], mid: [138, 122, 46], midBg: [241, 237, 222],
};
const TON = { favorable: C.good, neutre: C.mid, defavorable: C.bad, risque: C.bad };
const TON_BG = { favorable: C.goodBg, neutre: C.midBg, defavorable: C.badBg, risque: C.badBg };

/** Pouce dessiné (haut, bas) ou trait (neutre) dans une pastille de couleur. */
function pouce(doc, cx, cy, palier, r = 10) {
  doc.setFillColor(...(TON[palier] || C.muted)).circle(cx, cy, r, 'F');
  doc.setFillColor(255, 255, 255).setDrawColor(255, 255, 255);
  const s = r * 0.62;
  if (palier === 'neutre' || !palier) { doc.roundedRect(cx - s, cy - 1.2, 2 * s, 2.4, 1, 1, 'F'); return; }
  const k = palier === 'favorable' ? 1 : -1;
  // Manchette, poing, puis pouce (miroir vertical pour le pouce vers le bas).
  const y = (v) => cy + k * v;
  const rect = (x0, y0, w, h, rr) => doc.roundedRect(x0, k > 0 ? y(y0) : y(y0 + h), w, h, rr, rr, 'F');
  rect(cx - s, -s * 0.05, s * 0.42, s * 1.05, 0.6);
  rect(cx - s * 0.48, -s * 0.12, s * 1.4, s * 1.02, 1.6);
  rect(cx - s * 0.2, -s * 1.0, s * 0.55, s * 0.95, 1.4);
}

export async function pdfReport(ctx, user, plan, opts = {}) {
  if (!user?.uid || !plan?.rapports) throw new Error('Rapport réservé aux comptes (forfait Pro).');
  const lang = opts.lang || langueRapport();
  const u2 = opts.unites || unites();
  const L = R[lang];
  const F = fmt(lang);
  const A = (m2) => F.aire(m2, u2);
  const PA = (v) => F.parAire(v, u2);
  const { unit, muni, est, meta, st, comps, pc, imm, frais } = ctx;
  const JsPDF = await loadPdf();
  const doc = new JsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 42;
  let y = M;

  const t = (txt, x, yy, o = {}) => doc.text(clean(txt), x, yy, o);
  const ensure = (h) => { if (y + h > H - 60) { doc.addPage(); y = M; } };
  const h2 = (txt, besoin = 60) => {
    ensure(besoin);
    y += 14;
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...C.ink);
    t(txt.toUpperCase(), M, y);
    doc.setDrawColor(...C.ink).setLineWidth(1.2).line(M, y + 5, W - M, y + 5);
    y += 20;
    doc.setFont('helvetica', 'normal').setFontSize(10);
  };
  const para = (txt, size = 10, color = C.ink) => {
    doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(...(Array.isArray(color) ? color : [color, color, color]));
    const lines = doc.splitTextToSize(clean(txt), W - 2 * M);
    ensure(lines.length * size * 1.35);
    doc.text(lines, M, y);
    y += lines.length * size * 1.35 + 4;
  };
  const table = (head, body, o = {}) => {
    doc.autoTable({
      startY: y, head: head ? [head.map(clean)] : undefined, body: body.map((r) => r.map((c) => clean(c))), margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, textColor: C.ink, lineColor: C.line, lineWidth: 0.5 },
      headStyles: { fillColor: C.ink, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 248, 247] }, theme: 'grid', rowPageBreak: 'avoid', ...o,
    });
    y = doc.lastAutoTable.finalY + 10;
  };

  // ---------- En-tête ----------
  doc.setFillColor(...C.ink).rect(0, 0, W, 64, 'F');
  doc.setTextColor(255).setFont('helvetica', 'bold').setFontSize(18);
  const brand = plan.marque && user.courtier?.nom ? user.courtier.nom : CONFIG.appName;
  t(brand, M, 30);
  doc.setFont('helvetica', 'normal').setFontSize(9);
  t(plan.marque && user.courtier?.nom
    ? [user.courtier.agence, user.courtier.tel, user.courtier.courriel].filter(Boolean).join('  ·  ')
    : (lang === 'en' ? 'The fair price, backed by numbers.' : CONFIG.slogan), M, 46);
  t(`${L.rapportDu} ${F.date(new Date().toISOString())}`, W - M, 30, { align: 'right' });
  y = 96;
  doc.setTextColor(...C.ink).setFont('helvetica', 'bold').setFontSize(20);
  t(unit.adr || (lang === 'en' ? 'Property' : 'Propriété'), M, y);
  y += 16;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(...C.muted);
  t(`${TYPES[lang][unit.t] || ''} · ${muni.nom}${muni.mrc && muni.mrc !== muni.nom ? ` (${muni.mrc})` : ''}`, M, y);
  y += 16;

  // ---------- Photos ----------
  const [aer, fac] = await Promise.all([
    vueAerienne(unit.lat, unit.lon, { w: 720, h: 400 }).catch(() => null),
    photoFacade(unit.lat, unit.lon, { w: 640, h: 400 }).then((f) => (f ? enDataUrl(f.url) : null)).catch(() => null),
  ]);
  const imgs = [fac && { src: fac, cap: L.facade }, aer && { src: aer.dataUrl, cap: `${L.vueAerienne} · ${ORTHO_CREDIT}` }].filter(Boolean);
  if (imgs.length) {
    const gap = 10;
    const iw = (W - 2 * M - gap * (imgs.length - 1)) / imgs.length;
    const ih = Math.min(190, iw * 0.56);
    imgs.forEach((im, k) => {
      const x = M + k * (iw + gap);
      try { doc.addImage(im.src, 'JPEG', x, y, iw, ih); } catch { /* image illisible */ }
      doc.setFontSize(7.5).setTextColor(...C.muted);
      t(im.cap, x, y + ih + 10);
    });
    y += ih + 22;
  }

  // ---------- Valeur ----------
  doc.setFillColor(...C.soft).roundedRect(M, y, W - 2 * M, 74, 8, 8, 'F');
  doc.setTextColor(...C.muted).setFontSize(9);
  t(L.valeurEstimee, M + 16, y + 20);
  doc.setTextColor(...C.ink).setFont('helvetica', 'bold').setFontSize(28);
  t(F.money(est.valeur), M + 16, y + 52);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(60);
  t(`${L.fourchette} : ${F.money(est.bas)} ${L.a} ${F.money(est.haut)}`, W - M - 16, y + 34, { align: 'right' });
  t(`${L.role} ${muni.role.annee || ''} : ${F.money(unit.vr)}`, W - M - 16, y + 50, { align: 'right' });
  y += 90;

  // ---------- Scores ----------
  const osm = ctx.osm || await environs(unit.lat, unit.lon).catch(() => null);
  const sc = scores({ unit, muni, est, pc, comps, st, osm });
  h2(L.scores, 150);
  const profs = ['acheteur', 'vendeur', 'investisseur'];
  const cw = (W - 2 * M - 20) / 3;
  const ch = 112;
  profs.forEach((k, idx) => {
    const s = sc[k];
    const x = M + idx * (cw + 10);
    doc.setFillColor(...(s ? TON_BG[s.palier] : C.soft)).roundedRect(x, y, cw, ch, 8, 8, 'F');
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...C.ink);
    t(PROFILS[lang][k], x + 12, y + 18);
    if (!s || s.score == null) { doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...C.muted); t('—', x + 12, y + 44); return; }
    pouce(doc, x + 24, y + 42, s.palier, 12);
    doc.setFont('helvetica', 'bold').setFontSize(24).setTextColor(...TON[s.palier]);
    t(String(s.score), x + 44, y + 51);
    const sw = doc.getTextWidth(String(s.score));
    doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...C.muted);
    t(`/100 · ${PALIERS[lang][s.palier]}`, x + 44 + sw + 4, y + 51);
    const top = [...s.facteurs].sort((a, b) => Math.abs(b.score - 50) * b.poids - Math.abs(a.score - 50) * a.poids).slice(0, 4);
    doc.setFontSize(7.5);
    top.forEach((f, j) => {
      const yy = y + 70 + j * 10;
      doc.setTextColor(...C.ink);
      t(doc.splitTextToSize(clean(FACTEURS[lang][f.k] || f.k), cw - 60)[0], x + 12, yy);
      doc.setFillColor(...C.line).rect(x + cw - 46, yy - 5, 34, 4, 'F');
      doc.setFillColor(...(f.score >= 65 ? C.good : f.score >= 45 ? C.mid : C.bad)).rect(x + cw - 46, yy - 5, Math.max(1.5, 34 * f.score / 100), 4, 'F');
    });
  });
  y += ch + 8;
  para(L.scoresNote, 8, C.muted);

  // ---------- Zones de prix ----------
  const zp = zonesPrix(est, st);
  const rangees = profs.filter((k) => zp[k]).map((k) => ({ k, label: PROFILS[lang][k], zones: zp[k] }));
  const bornes = [est.valeur, st.prix];
  for (const r of rangees) for (const z of ['favorable', 'neutre', 'defavorable']) for (const b of r.zones[z]) if (b != null) bornes.push(b);
  const lo0 = Math.min(...bornes); const hi0 = Math.max(...bornes); const span = hi0 - lo0 || hi0 * 0.2;
  const lo = lo0 - span * 0.15; const hi = hi0 + span * 0.15;
  h2(L.zonesPrix, 40 + rangees.length * 30 + 40);
  const tx0 = M + 78; const tw = W - M - 150 - tx0;
  const X = (v) => tx0 + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * tw;
  rangees.forEach((r) => {
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...C.ink);
    t(r.label, M, y + 9);
    for (const z of ['favorable', 'neutre', 'defavorable']) {
      const [a, b] = r.zones[z];
      const xa = X(a ?? lo); const xb = X(b ?? hi);
      if (xb > xa) doc.setFillColor(...TON_BG[z]).rect(xa, y, xb - xa, 12, 'F');
      if (xb > xa) doc.setFillColor(...TON[z]).rect(xa, y + 10, xb - xa, 2, 'F');
    }
    doc.setFillColor(...C.ink).rect(X(est.valeur) - 0.8, y - 3, 1.6, 18, 'F');
    if (Math.abs(st.prix - est.valeur) > 500) doc.setFillColor(...C.bad).rect(X(st.prix) - 0.8, y - 3, 1.6, 18, 'F');
    const p = palierPrix(zp, r.k, st.prix);
    pouce(doc, W - M - 138, y + 6, p, 7);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...C.ink);
    const fav = r.zones.favorable;
    t(fav[0] == null ? `< ${F.kmoney(fav[1])}` : `> ${F.kmoney(fav[0])}`, W - M - 126, y + 5);
    doc.setTextColor(...C.muted);
    t(PALIERS[lang][p] || '', W - M - 126, y + 14);
    y += 26;
  });
  doc.setFontSize(8).setTextColor(...C.ink);
  doc.setFillColor(...C.ink).rect(tx0, y + 1, 8, 2, 'F'); t(`${L.valeurEst} : ${F.money(est.valeur)}`, tx0 + 12, y + 4);
  if (Math.abs(st.prix - est.valeur) > 500) { doc.setFillColor(...C.bad).rect(tx0 + 170, y + 1, 8, 2, 'F'); t(`${L.prixRetenu} : ${F.money(st.prix)}`, tx0 + 182, y + 4); }
  y += 14;
  para(L.zonesPrixNote, 8, C.muted);

  // ---------- Zones de loyer ----------
  const loyerMarche = loyerEstime(unit, muni);
  const zl = zonesLoyer(loyerMarche, st);
  if (zl && st.loyer) {
    h2(L.zonesLoyer, 90);
    const vals = [zl.defavorable[1] * 0.85, zl.risque * 1.08, st.loyer, zl.equilibre];
    const l0 = Math.min(...vals); const l1 = Math.max(...vals);
    const XL = (v) => tx0 + ((Math.min(l1, Math.max(l0, v)) - l0) / (l1 - l0)) * tw;
    const segs = [['defavorable', l0, zl.defavorable[1]], ['neutre', zl.neutre[0], zl.neutre[1]], ['favorable', zl.favorable[0], zl.favorable[1]], ['risque', zl.risque, l1]];
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...C.ink);
    t(lang === 'en' ? 'Rent / unit' : 'Loyer / log.', M, y + 9);
    for (const [z, a, b] of segs) {
      doc.setFillColor(...TON_BG[z]).rect(XL(a), y, XL(b) - XL(a), 12, 'F');
      doc.setFillColor(...TON[z]).rect(XL(a), y + 10, XL(b) - XL(a), 2, 'F');
    }
    doc.setFillColor(...C.ink).rect(XL(zl.marche) - 0.8, y - 3, 1.6, 18, 'F');
    doc.setFillColor(...C.bad).rect(XL(st.loyer) - 0.8, y - 3, 1.6, 18, 'F');
    doc.setFillColor(...C.muted).rect(XL(zl.equilibre) - 0.8, y - 3, 1.6, 18, 'F');
    const pl = palierLoyer(zl, st.loyer);
    pouce(doc, W - M - 138, y + 6, pl === 'risque' ? 'defavorable' : pl, 7);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...C.muted);
    t(PALIERS[lang][pl] || '', W - M - 126, y + 9);
    y += 24;
    doc.setFontSize(8).setTextColor(...C.ink);
    t(`${L.loyerMarche} : ${F.money(zl.marche)}   |   ${L.loyerRetenu} : ${F.money(st.loyer)}   |   ${L.loyerEquilibre} : ${F.money(zl.equilibre)}`, tx0, y);
    y += 12;
    para(L.zonesLoyerNote, 8, C.muted);
  }

  // ---------- Repères chiffrés (5 niveaux) ----------
  const N = NIVEAUX[lang];
  const gp = grillePrix(est, st);
  const plage = (g, fm = F.money) => (g.de == null ? `< ${fm(g.a)}` : g.a == null ? `> ${fm(g.de)}` : `${fm(g.de)} - ${fm(g.a)}`);
  const sym = (n) => ({ 2: '++', 1: '+', 0: '=', '-1': '-', '-2': '--' }[n]);
  const ecartV = (g, ref) => {
    const p = (x) => `${x > ref ? '+' : ''}${Math.round((x / ref - 1) * 100)} %`;
    return g.de == null ? `< ${p(g.a)}` : g.a == null ? `> ${p(g.de)}` : `${p(g.de)} / ${p(g.a)}`;
  };
  const tonLigne = (n) => (n > 0 ? C.good : n < 0 ? C.bad : C.mid);
  const colorer = (rows) => ({ didParseCell: (d) => { if (d.section === 'body' && d.column.index === 0) { d.cell.styles.textColor = tonLigne(rows[d.row.index]); d.cell.styles.fontStyle = 'bold'; } } });
  h2(L.reperes, 150);
  const lignesAV = gp.acheteur.map((g, k) => [sym(g.niveau), plage(g), ecartV(g, est.valeur), N.acheteur[g.cle], N.vendeur[gp.vendeur[k].cle]]);
  table([lang === 'en' ? 'Buyer' : 'Ach.', L.prix, lang === 'en' ? 'vs estimate' : 'vs valeur', L.acheteur, L.vendeur], lignesAV,
    { columnStyles: { 0: { halign: 'center', cellWidth: 34 }, 1: { halign: 'right' }, 2: { halign: 'right', textColor: C.muted } }, ...colorer(gp.acheteur.map((g) => g.niveau)) });
  if (gp.investisseur) {
    table([lang === 'en' ? 'Inv.' : 'Inv.', L.prix, L.tga, L.investisseur], gp.investisseur.map((g) => [sym(g.niveau), plage(g), lang === 'en' ? g.cap.replace('et plus', 'or more').replace('moins de', 'under').replace(' à ', ' to ') : g.cap, N.investisseur[g.cle]]),
      { columnStyles: { 0: { halign: 'center', cellWidth: 34 }, 1: { halign: 'right' } }, ...colorer(gp.investisseur.map((g) => g.niveau)) });
  }
  const glo = grilleLoyer(loyerEstime(unit, muni));
  if (glo && st.loyer) {
    table([lang === 'en' ? 'Rent' : 'Loyer', L.loyerLog, lang === 'en' ? 'vs market' : 'vs marché', ''], glo.map((g) => [sym(g.niveau), plage(g), ecartV(g, loyerEstime(unit, muni)), N.loyer[g.cle]]),
      { columnStyles: { 0: { halign: 'center', cellWidth: 34 }, 1: { halign: 'right' }, 2: { halign: 'right', textColor: C.muted } }, ...colorer(glo.map((g) => g.niveau)) });
  }
  para(L.reperesNote, 8, C.muted);

  // ---------- Synthèse ----------
  h2(L.synthese);
  para(synthese({ unit, muni, est, pc, comps, st, meta, imm, frais }, lang), 10.5, C.ink);

  // ---------- Caractéristiques ----------
  h2(L.caracteristiques);
  const m2 = unit.aire ? est.valeur / unit.aire : null;
  table(null, [
    [L.annee, unit.an || '—', L.aireHab, A(unit.aire)],
    [L.terrain, A(unit.ter), L.logements, unit.lg || '—'],
    [`${L.prixAire} / ${F.uniteLabel(u2)}`, PA(m2), L.centile, pc != null ? (lang === 'en' ? `${pc}th` : `${pc}e`) : '—'],
    [L.tendance, `${F.signedPct(muni.marche.g * 100)} ${L.parAn}`, L.fc, muni.marche.fc ? F.dec(muni.marche.fc) : '—'],
    [L.taxes, `${F.money(taxesFoncieres(unit, muni, CONFIG.defauts.tauxTaxesFoncieresPct).total)} ${L.parAn}`, L.roleLabel, F.money(unit.vr)],
  ], { columnStyles: { 0: { textColor: C.muted }, 2: { textColor: C.muted } } });
  if (muni.taxes?.tauxResidentiel) para(L.taxesNote(muni.nom, muni.taxes.annee, F.dec(muni.taxes.tauxResidentiel, 4)), 8, C.muted);

  if (unit.t === 'C' && (imm || frais)) {
    h2(L.immeuble);
    const rows = [];
    if (imm) rows.push([L.unites, F.num(imm.unites), L.etages, imm.etages || '—']);
    if (imm && imm.unites > 1) rows.push([L.medianeImm, F.money(imm.medianeValeur), L.fourchetteImm, `${F.kmoney(imm.min)} ${L.a} ${F.kmoney(imm.max)}`]);
    if (frais) rows.push([L.frais, `${F.money(frais.mensuel)} ${L.parMois}`, L.rangImm, imm?.centile != null ? `${imm.centile} %` : '—']);
    table(null, rows, { columnStyles: { 0: { textColor: C.muted }, 2: { textColor: C.muted } } });
    if (frais) para(L.fraisNote, 8, C.muted);
  }

  if (comps?.length) {
    h2(titreComparables(unit, lang));
    table([L.adresse, L.distance, unit.t === 'P' ? L.logs : L.annee, L.aire, `${lang === 'en' ? 'Per' : 'Par'} ${F.uniteLabel(u2)}`, L.estimation],
      comps.map((c) => [c.adr, F.dist(c.d), unit.t === 'P' ? (c.lg || '—') : (c.an || '—'), A(c.aire), PA(c.m2), F.money(c.est)]),
      { columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' } } });
    const ec = ecartComparables(unit, est, comps);
    para(`${ec != null ? `${L.ecartComp} : ${F.signedPct(ec, 0)}. ` : ''}${L.compNote}`, 8, C.muted);
  }

  // ---------- Démographie ----------
  const c = muni.recensement || {};
  const D = L.demo;
  const items = [
    ['pop2021', c.pop2021, F.num], ['croissancePop', c.croissancePop, F.signedPct], ['menages', c.menages, F.num],
    ['densite', c.densite, F.num], ['revenuMenage', c.revenuMenage, F.money], ['croissanceRevenu', c.croissanceRevenu, F.signedPct],
    ['pctProprio', c.pctProprio, (v) => F.pct(v, 0)], ['pctLocataires', c.pctProprio == null ? null : 100 - c.pctProprio, (v) => F.pct(v, 0)],
    ['pctInabordableLocataire', c.pctInabordableLocataire, (v) => F.pct(v, 0)], ['pctInabordableProprio', c.pctInabordableProprio, (v) => F.pct(v, 0)],
    ['pctBesoinImperieux', c.pctBesoinImperieux, (v) => F.pct(v, 0)], ['ageMoyen', c.ageMoyen, F.num1], ['ageMedian', c.ageMedian, F.num1],
    ['pct65', c.pct65, (v) => F.pct(v, 0)], ['pct20_34', c.pct20_34, (v) => F.pct(v, 0)],
    ['pctMenagesEnfants', c.pctMenagesEnfants, (v) => F.pct(v, 0)], ['menages1', c.menages1, (v) => F.pct(v, 0)],
    ['pctDemenage1an', c.pctDemenage1an, (v) => F.pct(v, 0)], ['valeurDeclaree2021', c.valeurDeclaree2021, F.money],
    ['valeurUnifamiliale2021', c.valeurUnifamiliale2021, F.money], ['ratioPrixRevenu', muni.ratioPrixRevenu, F.num1],
    ['rendementPlex', muni.rendementPlex, (v) => F.pct(v)], ['loyer', muni.loyer?.estime, F.money],
  ].filter((x) => x[1] != null).map(([k, v, f]) => [D[k], f(v)]);
  if (items.length) {
    h2(`${L.demographie} : ${muni.nom}`, 200);
    // Barres : âge, taille des ménages, mode d'occupation
    const groupes = [
      [D.groupesAge, [[D.age0_14, c.pct0_14], [D.age15_64, c.pct15_64], [D.age65, c.pct65]]],
      [D.tailleMenages, [['1', c.menages1], ['2', c.menages2], ['3', c.menages3], ['4', c.menages4], ['5+', c.menages5]]],
      [D.occupation, c.pctProprio == null ? [] : [[D.pctProprio, c.pctProprio], [D.pctLocataires, 100 - c.pctProprio]]],
    ].filter(([, v]) => v.filter((x) => x[1] != null).length >= 2);
    if (groupes.length) {
      const gw = (W - 2 * M - 20 * (groupes.length - 1)) / groupes.length;
      let hMax = 0;
      groupes.forEach(([titre, vals], gi) => {
        const x0 = M + gi * (gw + 20);
        doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...C.ink);
        t(titre, x0, y + 8);
        const max = Math.max(...vals.map((v) => v[1] || 0), 1);
        vals.filter((v) => v[1] != null).forEach(([lab, v], k) => {
          const yy = y + 20 + k * 13;
          doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...C.muted);
          t(lab, x0, yy + 6);
          const bx = x0 + 62; const bw = gw - 62 - 30;
          doc.setFillColor(...C.soft).rect(bx, yy, bw, 7, 'F');
          doc.setFillColor(...C.good).rect(bx, yy, Math.max(1, bw * v / max), 7, 'F');
          doc.setTextColor(...C.ink);
          t(F.pct(v, 0), x0 + gw, yy + 6, { align: 'right' });
          hMax = Math.max(hMax, 20 + (k + 1) * 13);
        });
      });
      y += hMax + 10;
    }
    const rows = [];
    for (let k = 0; k < items.length; k += 2) rows.push([...items[k], ...(items[k + 1] || ['', ''])]);
    table(null, rows, { columnStyles: { 0: { textColor: C.muted }, 2: { textColor: C.muted } } });
    para(lang === 'en' ? 'Source: Statistics Canada, 2021 Census.' : 'Source : Statistique Canada, Recensement de 2021.', 8, C.muted);
  }

  // ---------- Scénarios ----------
  const a = analyseAcheteur({ prix: st.prix, misePct: st.misePct, taux: st.taux, amort: st.amort, code: muni.code, meta,
    taxesAnnuelles: st.taxes, fraisNotaire: CONFIG.defauts.fraisNotaire, inspection: CONFIG.defauts.inspection,
    chauffageMensuel: CONFIG.defauts.chauffageMensuel, fraisCondo: st.fraisCondo || 0 });
  const v = analyseVendeur({ est, commissionPct: st.commission });
  const i = analyseInvestisseur({ prix: st.prix, logements: st.logements, loyer: st.loyer, vacancePct: st.vacance, taxes: st.taxes,
    assurances: st.assurances, entretienPct: st.entretien, gestionPct: st.gestion, autresDepenses: (st.fraisCondo || 0) * 12,
    misePct: Math.max(20, st.misePct), taux: st.taux, amort: st.amort });
  h2(L.scenarios, 170);
  table([L.acheteur, '', L.vendeur, '', L.investisseur, ''], [
    [L.prix, F.money(st.prix), L.strategies[0], F.money(v.strategies[0].prix), L.revenusBruts, F.money(i.revenusBruts)],
    [L.mise, `${st.misePct} %`, L.strategies[1], F.money(v.strategies[1].prix), L.rne, F.money(i.rne)],
    [L.paiement, F.money(a.paiement), L.strategies[2], F.money(v.strategies[2].prix), L.tga, F.pct(i.tauxCapitalisation, 2)],
    [L.droits, F.money(a.droits.total), L.commissionEvitee, F.money(v.commission), L.mrb, i.mrb ? F.num1(i.mrb) : '—'],
    [L.comptant, F.money(a.comptant), L.taxesCommission, F.money(v.taxes), L.liquidites, F.money(i.liquiditeMensuelle)],
    [L.revenuRequis, F.money(a.revenuRequis), L.economie, F.money(v.total), L.loyerLog, F.money(st.loyer)],
  ], { styles: { fontSize: 8.5, cellPadding: 3.5 }, columnStyles: { 0: { textColor: C.muted }, 2: { textColor: C.muted }, 4: { textColor: C.muted } } });
  para(L.hypotheses({ taux: F.pct(st.taux, 2), amort: st.amort, taxes: F.money(st.taxes), vac: F.pct(st.vacance, 1), ent: F.pct(st.entretien, 1) }), 8.5, C.muted);

  // ---------- Quartier, économie, risques ----------
  const LL = (fr, en) => (lang === 'en' ? en : fr);
  const [ecoles, terrains] = await Promise.all([
    ctx.ecoles || lieuxAutour('ecoles', unit.lat, unit.lon, 3000).catch(() => []),
    ctx.terrains || lieuxAutour('terrains', unit.lat, unit.lon, 1000).catch(() => []),
  ]);
  const sp = scoreProximite(osm, ecoles);
  h2(LL('Quartier : services et écoles', 'Neighbourhood: services and schools'), 120);
  if (sp) {
    const nv = niveau5(sp.score, [35, 50, 65, 80]);
    pouce(doc, M + 10, y + 6, nv > 0 ? 'favorable' : nv < 0 ? 'defavorable' : 'neutre', 9);
    doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...C.ink);
    t(`${sp.score}/100`, M + 26, y + 12);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...C.muted);
    const lp = doc.splitTextToSize(clean(LL('Proximité des services essentiels (indice DataHouse : 80+ excellent, 65-79 bon, 50-64 moyen, 35-49 faible, moins de 35 très faible)',
      'Access to essential services (DataHouse index: 80+ excellent, 65-79 good, 50-64 average, 35-49 weak, below 35 very weak)')), W - 2 * M - 92);
    doc.text(lp, M + 92, y + 6);
    y += Math.max(24, lp.length * 11 + 8);
    const det = sp.detail.map((d) => [LL(d.l, { 'Transport collectif': 'Public transit', 'Épicerie': 'Grocery', 'École primaire': 'Elementary school', 'École secondaire': 'High school', Garderie: 'Daycare', Parc: 'Park', 'Pharmacie ou clinique': 'Pharmacy or clinic', 'Restaurants et cafés': 'Restaurants and cafés', 'Sport et loisirs': 'Sports and recreation', 'Bibliothèque, culture': 'Library, culture' }[d.l] || d.l), `${d.v}/100`]);
    const rows = [];
    for (let k = 0; k < det.length; k += 2) rows.push([...det[k], ...(det[k + 1] || ['', ''])]);
    table(null, rows, { styles: { fontSize: 8.5, cellPadding: 3 }, columnStyles: { 0: { textColor: C.muted }, 2: { textColor: C.muted } } });
  }
  const ec = [...ecoles.filter((e) => e.p).slice(0, 3), ...ecoles.filter((e) => e.s && !e.p).slice(0, 3)];
  if (ec.length) {
    table([LL('École', 'School'), LL('Ordre', 'Level'), LL('Réseau', 'Network'), 'IMSE', L.distance],
      ec.map((e) => [e.n, [e.p ? LL('primaire', 'elementary') : '', e.s ? LL('secondaire', 'high school') : ''].filter(Boolean).join(' + '),
        `${e.r === 'prive' ? LL('privé', 'private') : LL('public', 'public')}${e.l ? ` (${e.l === 'en' ? LL('anglo', 'English') : LL('franco', 'French')})` : ''}`, e.imse ? `${e.imse}/10` : '—', F.dist(e.d)]),
      { styles: { fontSize: 8.5, cellPadding: 3 }, columnStyles: { 3: { halign: 'center' }, 4: { halign: 'right' } } });
    para(LL('IMSE : indice de milieu socio-économique des élèves publié par le ministère de l\'Éducation (1 = le plus favorisé, 10 = le plus défavorisé) ; ce n\'est pas un palmarès. L\'école attribuée se vérifie auprès du centre de services scolaire.',
      'IMSE: socio-economic index of students published by the Québec Ministry of Education (1 = most advantaged, 10 = most disadvantaged); not a ranking. The assigned school must be confirmed with the school service centre.'), 8, C.muted);
  }
  const eco = muni.economie || {};
  if (eco.chomage != null || eco.inoccupation != null) {
    h2(LL('Économie régionale', 'Regional economy'), 90);
    const r = [];
    if (eco.chomage != null) r.push([LL(`Taux de chômage (${eco.region || ''}, ${eco.periode})`, `Unemployment rate (${eco.region || ''}, ${eco.periode})`), `${F.pct(eco.chomage)}${eco.chomageVar != null ? ` (${F.signedPct(eco.chomageVar)} ${LL('sur un an', 'yoy')})` : ''}`]);
    if (eco.tauxEmploi != null) r.push([LL('Taux d\'emploi', 'Employment rate'), F.pct(eco.tauxEmploi)]);
    if (eco.inoccupation != null) r.push([LL(`Taux d'inoccupation des logements (SCHL ${eco.anneeInoccupation})`, `Rental vacancy rate (CMHC ${eco.anneeInoccupation})`), F.pct(eco.inoccupation)]);
    if (muni.loyer?.schl2ch) r.push([LL(`Loyer moyen d'un 2 chambres (SCHL ${muni.loyer.anneeSCHL})`, `Average 2-bedroom rent (CMHC ${muni.loyer.anneeSCHL})`), F.money(muni.loyer.schl2ch)]);
    if (muni.ratioPrixRevenu) r.push([LL('Prix médian / revenu des ménages', 'Median price / household income'), F.num1(muni.ratioPrixRevenu)]);
    table(null, r, { columnStyles: { 0: { textColor: C.muted }, 1: { halign: 'right' } } });
    para(LL('Repères : chômage sous 5,5 % = marché de l\'emploi solide ; inoccupation sous 3 % = logements qui se louent vite ; prix/revenu sous 6 = abordable, au-delà de 8 = cher.',
      'Benchmarks: unemployment below 5.5% = strong job market; vacancy below 3% = units rent quickly; price/income below 6 = affordable, above 8 = expensive.'), 8, C.muted);
  }
  const risques = [];
  if (unit.zi === 2) risques.push(['--', LL('Zone inondable de grand courant (0-20 ans)', 'High-velocity flood zone (0-20 years)')]);
  else if (unit.zi === 1) risques.push(['-', LL('Zone inondable de faible courant (20-100 ans)', 'Low-velocity flood zone (20-100 years)')]);
  else if (unit.zi === 0) risques.push(['+', LL('Hors des zones inondables cartographiées (BDZI)', 'Outside mapped flood zones (BDZI)')]);
  const tp = terrains.filter((x) => x.d <= 300);
  risques.push(tp.length ? [tp[0].d <= 60 ? '--' : '-', LL(`Terrain contaminé répertorié à ${F.dist(tp[0].d)} (${tp.length} dans un rayon de 300 m)`, `Listed contaminated site ${F.dist(tp[0].d)} away (${tp.length} within 300 m)`)]
    : ['+', LL('Aucun terrain contaminé répertorié à moins de 300 m', 'No listed contaminated site within 300 m')]);
  if (osm?.autoroute?.n) risques.push(['-', LL(`Autoroute à ${F.dist(osm.autoroute.plusProche)}`, `Highway ${F.dist(osm.autoroute.plusProche)} away`)]);
  if (osm?.voieFerree?.n) risques.push(['-', LL(`Voie ferrée à ${F.dist(osm.voieFerree.plusProche)}`, `Railway ${F.dist(osm.voieFerree.plusProche)} away`)]);
  if (unit.an && unit.an < 1970) risques.push(['=', LL('Bâtiment d\'avant 1970 : faire analyser l\'eau (entrée de service en plomb possible)', 'Built before 1970: have the water tested (possible lead service line)')]);
  if (unit.an && unit.an < 1990) risques.push(['=', LL('Avant 1990 : amiante ou vermiculite possibles', 'Before 1990: possible asbestos or vermiculite')]);
  h2(LL('Risques et points à vérifier', 'Risks and items to check'), 80);
  table(null, risques, { columnStyles: { 0: { halign: 'center', cellWidth: 30, fontStyle: 'bold' } },
    didParseCell: (d) => { if (d.section === 'body' && d.column.index === 0) d.cell.styles.textColor = d.cell.raw.includes('+') ? C.good : d.cell.raw.includes('-') ? C.bad : C.mid; } });

  // ---------- Secteur ----------
  h2(L.secteur);
  const pcs = prosCons({ muni, meta, unit, osm, est }, lang);
  for (const p of pcs.slice(0, 16)) {
    const col = p.signe === '+' ? C.good : p.signe === '−' ? C.bad : C.muted;
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...col);
    ensure(16);
    t(p.signe === '−' ? '-' : p.signe, M + 4, y);
    doc.setFont('helvetica', 'normal').setTextColor(...C.ink);
    const lines = doc.splitTextToSize(clean(p.texte), W - 2 * M - 20);
    doc.text(lines, M + 20, y);
    y += lines.length * 13 + 3;
  }

  const news = muni.nouvelles?.items?.filter((n) => n.explication || !muni.nouvelles.analyse).slice(0, 5);
  if (news?.length) {
    h2(L.nouvelles);
    const effets = lang === 'en' ? { hausse: 'upward', baisse: 'downward', neutre: 'neutral', incertain: 'uncertain' } : {};
    for (const n of news) {
      para(`${n.titre} (${n.source}, ${F.date(n.date)})${n.effet ? ` — ${L.effet} : ${effets[n.effet] || n.effet}` : ''}${n.explication ? `. ${n.explication}` : ''}`, 9, [40, 40, 40]);
    }
  }

  // ---------- Pied de page ----------
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(120);
    doc.text(doc.splitTextToSize(clean(L.pied(F.date(meta.genere))), W - 2 * M - 40), M, H - 34);
    doc.text(`${p} / ${pages}`, W - M, H - 34, { align: 'right' });
  }
  const slug = (unit.adr || 'propriete').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { blob: doc.output('blob'), filename: `DataHouse-${slug}${lang === 'en' ? '-EN' : ''}.pdf` };
}
