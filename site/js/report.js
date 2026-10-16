// Synthèse rédigée, rapport PDF téléchargeable, partage et exports.
import { CONFIG } from './config.js';
import { analyseAcheteur, analyseVendeur, analyseInvestisseur, indiceRevente, median } from './engine.js';
import { prosCons, environs } from './analysis.js';
import { money, kmoney, pct, signedPct, num, num1, dist, date } from './format.js';

export const isNative = () => Boolean(window.Capacitor?.isNativePlatform?.());

/* ---------------------------------------------------------------------------
 * Synthèse : un résumé rédigé, en langage clair, à partir des chiffres calculés.
 * ------------------------------------------------------------------------- */
export function synthese({ unit, muni, est, pc, comps, st, meta }) {
  const phrases = [];
  const type = (meta.typeLabels[unit.t] || 'propriété').toLowerCase();
  const m = muni.marche;
  phrases.push(`Cette ${type} de ${muni.nom} est estimée à environ ${kmoney(est.valeur)}, `
    + `dans une fourchette de ${kmoney(est.bas)} à ${kmoney(est.haut)}.`);

  if (pc != null) {
    const pos = pc >= 75 ? 'dans le haut du marché local' : pc <= 25 ? 'dans le bas du marché local' : 'dans la moyenne du marché local';
    phrases.push(`Elle se situe ${pos} (plus élevée que ${pc} % des propriétés comparables de la municipalité).`);
  }
  const m2 = unit.aire ? est.valeur / unit.aire : null;
  const compM2 = median((comps || []).map((c) => c.m2));
  if (m2 && compM2) {
    const ecart = ((m2 - compM2) / compM2) * 100;
    if (Math.abs(ecart) >= 8) {
      phrases.push(`Son prix au mètre carré est ${ecart > 0 ? 'supérieur' : 'inférieur'} de ${Math.abs(Math.round(ecart))} % `
        + 'à celui des propriétés semblables du voisinage.');
    } else phrases.push('Son prix au mètre carré est cohérent avec celui des propriétés semblables du voisinage.');
  }
  if (m.g != null) {
    const g = m.g * 100;
    const tend = g >= 6 ? 'en forte hausse' : g >= 3 ? 'en hausse soutenue' : g >= 0.5 ? 'en hausse modérée' : g > -0.5 ? 'stable' : 'en baisse';
    phrases.push(`Le marché de ${muni.nom} est ${tend} (environ ${signedPct(g)} par an).`);
  }
  if (st) {
    const i = analyseInvestisseur({ prix: st.prix, logements: st.logements, loyer: st.loyer, vacancePct: st.vacance,
      taxes: st.taxes, assurances: st.assurances, entretienPct: st.entretien, gestionPct: st.gestion,
      misePct: Math.max(20, st.misePct), taux: st.taux, amort: st.amort });
    if (st.loyer && (unit.lg || 1) > 1) {
      const qual = i.tauxCapitalisation >= 5 ? 'intéressant' : i.tauxCapitalisation >= 3.5 ? 'correct' : 'faible';
      phrases.push(`Sur le plan locatif, le rendement est ${qual} : taux de capitalisation d'environ ${pct(i.tauxCapitalisation)} `
        + `et liquidités de ${money(i.liquiditeMensuelle)} par mois après hypothèque (20 % de mise de fonds).`);
    }
    const a = analyseAcheteur({ prix: st.prix, misePct: st.misePct, taux: st.taux, amort: st.amort, code: muni.code, meta,
      taxesAnnuelles: st.taxes });
    phrases.push(`À l'achat, prévoyez environ ${kmoney(a.comptant)} comptant (mise de fonds, droits de mutation et frais) `
      + `et un paiement hypothécaire d'environ ${money(a.paiement)} par mois.`);
  }
  const rv = indiceRevente(unit, muni, pc);
  if (rv) phrases.push(`La facilité de revente est jugée ${rv.niveau.toLowerCase()} (${rv.score}/100).`);
  if (est.marge >= 0.15) phrases.push('Comme la propriété est atypique pour son secteur, une évaluation agréée est recommandée avant toute décision.');
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

export async function pdfReport(ctx, user, plan) {
  const { unit, muni, est, meta, st, comps, pc } = ctx;
  const JsPDF = await loadPdf();
  const doc = new JsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 42;
  const green = [20, 134, 74];
  const red = [211, 59, 55];
  let y = M;

  const t = (txt, x, yy, opts = {}) => doc.text(clean(txt), x, yy, opts);
  const ensure = (h) => { if (y + h > H - 60) { doc.addPage(); y = M; } };
  const h2 = (txt) => {
    ensure(40);
    y += 14;
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(0);
    t(txt.toUpperCase(), M, y);
    doc.setDrawColor(0).setLineWidth(1.2).line(M, y + 5, W - M, y + 5);
    y += 20;
    doc.setFont('helvetica', 'normal').setFontSize(10);
  };
  const para = (txt, size = 10, color = 30) => {
    doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(color);
    const lines = doc.splitTextToSize(clean(txt), W - 2 * M);
    ensure(lines.length * size * 1.35);
    doc.text(lines, M, y);
    y += lines.length * size * 1.35 + 4;
  };
  const table = (head, body, opts = {}) => {
    doc.autoTable({
      startY: y, head: head ? [head.map(clean)] : undefined, body: body.map((r) => r.map(clean)), margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 4, textColor: 30, lineColor: [225, 225, 222], lineWidth: 0.5 },
      headStyles: { fillColor: [11, 11, 11], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 246, 244] }, theme: 'grid', rowPageBreak: 'avoid', ...opts,
    });
    y = doc.lastAutoTable.finalY + 10;
  };

  // En-tête
  doc.setFillColor(11, 11, 11).rect(0, 0, W, 64, 'F');
  doc.setTextColor(255).setFont('helvetica', 'bold').setFontSize(18);
  const brand = plan.marque && user.courtier?.nom ? user.courtier.nom : CONFIG.appName;
  t(brand, M, 30);
  doc.setFont('helvetica', 'normal').setFontSize(9);
  t(plan.marque && user.courtier?.nom
    ? [user.courtier.agence, user.courtier.tel, user.courtier.courriel].filter(Boolean).join('  ·  ')
    : CONFIG.slogan, M, 46);
  t(`Rapport du ${date(new Date().toISOString())}`, W - M, 30, { align: 'right' });
  y = 96;

  doc.setTextColor(0).setFont('helvetica', 'bold').setFontSize(20);
  t(unit.adr || 'Propriété', M, y);
  y += 16;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(100);
  t(`${meta.typeLabels[unit.t]} · ${muni.nom}${muni.mrc && muni.mrc !== muni.nom ? ` (${muni.mrc})` : ''}`, M, y);
  y += 26;

  // Bloc valeur
  doc.setFillColor(242, 242, 240).roundedRect(M, y, W - 2 * M, 74, 8, 8, 'F');
  doc.setTextColor(100).setFontSize(9);
  t('VALEUR MARCHANDE ESTIMÉE', M + 16, y + 20);
  doc.setTextColor(0).setFont('helvetica', 'bold').setFontSize(28);
  t(money(est.valeur), M + 16, y + 52);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(60);
  t(`Fourchette : ${money(est.bas)} à ${money(est.haut)}`, W - M - 16, y + 34, { align: 'right' });
  t(`Rôle ${muni.role.annee || ''} : ${money(unit.vr)}`, W - M - 16, y + 50, { align: 'right' });
  y += 92;

  h2('Synthèse');
  para(synthese({ unit, muni, est, pc, comps, st, meta }), 10.5, 20);

  h2('Caractéristiques');
  const m2 = unit.aire ? est.valeur / unit.aire : null;
  table(null, [
    ['Année de construction', unit.an || '—', 'Aire habitable', unit.aire ? `${num(unit.aire)} m² (${num(unit.aire * 10.764)} pi²)` : '—'],
    ['Terrain', unit.ter ? `${num(unit.ter)} m²` : '—', 'Logements', unit.lg || '—'],
    ['Prix estimé au m²', m2 ? `${num(m2)} $` : '—', 'Centile local', pc != null ? `${pc}e` : '—'],
    ['Tendance municipale', `${signedPct(muni.marche.g * 100)} / an`, 'Facteur comparatif MAMH', muni.marche.fc ? muni.marche.fc.toFixed(2) : '—'],
  ], { columnStyles: { 0: { textColor: 100 }, 2: { textColor: 100 } } });

  if (comps?.length) {
    h2('Propriétés comparables à proximité');
    table(['Adresse', 'Distance', 'Année', 'Aire', 'Estimation'],
      comps.map((c) => [c.adr, dist(c.d), c.an || '—', c.aire ? `${num(c.aire)} m²` : '—', money(c.est)]),
      { columnStyles: { 4: { halign: 'right' } } });
  }

  const a = analyseAcheteur({ prix: st.prix, misePct: st.misePct, taux: st.taux, amort: st.amort, code: muni.code, meta,
    taxesAnnuelles: st.taxes, fraisNotaire: CONFIG.defauts.fraisNotaire, inspection: CONFIG.defauts.inspection,
    chauffageMensuel: CONFIG.defauts.chauffageMensuel });
  const v = analyseVendeur({ est, commissionPct: st.commission });
  const i = analyseInvestisseur({ prix: st.prix, logements: st.logements, loyer: st.loyer, vacancePct: st.vacance, taxes: st.taxes,
    assurances: st.assurances, entretienPct: st.entretien, gestionPct: st.gestion, misePct: Math.max(20, st.misePct), taux: st.taux, amort: st.amort });

  ensure(170);
  h2('Scénarios');
  table(['Acheteur', '', 'Vendeur', '', 'Investisseur', ''], [
    ['Prix', money(st.prix), v.strategies[0].nom, money(v.strategies[0].prix), 'Revenus bruts / an', money(i.revenusBruts)],
    ['Mise de fonds', `${st.misePct} %`, v.strategies[1].nom, money(v.strategies[1].prix), 'Revenu net (RNE)', money(i.rne)],
    ['Paiement / mois', money(a.paiement), v.strategies[2].nom, money(v.strategies[2].prix), 'Taux de capitalisation', pct(i.tauxCapitalisation, 2)],
    ['Droits de mutation', money(a.droits.total), 'Commission évitée', money(v.commission), 'MRB', i.mrb ? num1(i.mrb) : '—'],
    ['Comptant requis', money(a.comptant), 'Taxes sur commission', money(v.taxes), 'Liquidités / mois', money(i.liquiditeMensuelle)],
    ['Revenu requis', money(a.revenuRequis), 'Économie totale', money(v.total), 'Loyer retenu / log.', money(st.loyer)],
  ], { styles: { fontSize: 8.5, cellPadding: 3.5 }, columnStyles: { 0: { textColor: 100 }, 2: { textColor: 100 }, 4: { textColor: 100 } } });
  para(`Hypothèses : taux hypothécaire ${pct(st.taux, 2)}, amortissement ${st.amort} ans, taxes foncières ${money(st.taxes)} / an, `
    + `inoccupation ${pct(st.vacance, 1)}, entretien ${pct(st.entretien, 1)} des revenus. Revenu requis calculé avec un ratio `
    + 'd\'amortissement brut de la dette de 39 % et le taux de qualification.', 8.5, 100);

  h2('Secteur : avantages et inconvénients');
  const osm = ctx.osm || await environs(unit.lat, unit.lon).catch(() => null);
  const pcs = prosCons({ muni, meta, unit, osm, est });
  for (const p of pcs.slice(0, 14)) {
    const col = p.signe === '+' ? green : p.signe === '−' ? red : [120, 120, 120];
    doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(...col);
    ensure(16);
    t(p.signe === '−' ? '-' : p.signe, M + 4, y);
    doc.setFont('helvetica', 'normal').setTextColor(30);
    const lines = doc.splitTextToSize(clean(p.texte), W - 2 * M - 20);
    doc.text(lines, M + 20, y);
    y += lines.length * 13 + 3;
  }

  const news = muni.nouvelles?.items?.filter((n) => n.explication || !muni.nouvelles.analyse).slice(0, 5);
  if (news?.length) {
    h2('Nouvelles récentes du secteur');
    for (const n of news) {
      para(`${n.titre} (${n.source}, ${date(n.date)})${n.effet ? ` — effet possible : ${n.effet}` : ''}${n.explication ? `. ${n.explication}` : ''}`, 9, 40);
    }
  }

  // Pied de page sur chaque page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(120);
    const foot = doc.splitTextToSize(clean('Estimation statistique fondée sur des données publiques (rôle d\'évaluation foncière et facteurs '
      + 'comparatifs du MAMH, Statistique Canada, Banque du Canada, OpenStreetMap). Ne constitue ni une évaluation agréée, ni un avis '
      + `de courtage, juridique ou financier. Données au ${date(meta.genere)}.`), W - 2 * M - 40);
    doc.text(foot, M, H - 34);
    doc.text(`${p} / ${pages}`, W - M, H - 34, { align: 'right' });
  }
  const slug = (unit.adr || 'propriete').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return { blob: doc.output('blob'), filename: `DataHouse-${slug}.pdf` };
}
