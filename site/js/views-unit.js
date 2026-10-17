// Fiche d'une propriété (unité d'évaluation) : estimation et analyses par profil.
import { CONFIG } from './config.js';
import {
  estimate, comparables, percentile, median, analyseAcheteur, analyseVendeur, analyseInvestisseur,
  loyerEstime, indiceRevente, immeuble, fraisCondo, ecartComparables, scores, zonesPrix, palierPrix, zonesLoyer, palierLoyer,
} from './engine.js';
import { loadMuni, unitsAround, getUnit, munisLoaded } from './data.js';
import { environs, prosCons } from './analysis.js';
import { histogram, gauge, meter, rangeBar, zonesBars, scoreCards, palierTag } from './charts.js';
import { money, kmoney, pct, signedPct, num, num1, dist, esc, date, aire, parAire, uniteLabel } from './format.js';
import { vueAerienne, photoFacade, lienFacade, ORTHO_CREDIT } from './photo.js';
import { titreComparables, FACTEURS } from './i18n.js';
import { getPrefs, setPrefs } from './prefs.js';
import { $, $$, kpi, row, section, field, val, icon, toast } from './ui.js';
import * as auth from './auth.js';
import { synthese, pdfReport, saveFile, shareLink, comparablesCsv, isNative } from './report.js';

const LIENS = { 1: 'Détaché', 2: 'Jumelé', 3: 'En rangée (bout)', 4: 'En rangée', 5: 'Intégré (copropriété)' };
const TABS = {
  acheteur: 'Acheteur', vendeur: 'Vendeur', investisseur: 'Investisseur', secteur: 'Secteur', revente: 'Revente',
};

function tabOrder(profil) {
  const keys = Object.keys(TABS);
  const first = profil === 'courtier' ? 'vendeur' : profil;
  return keys.includes(first) ? [first, ...keys.filter((k) => k !== first)] : keys;
}

export async function renderBuilding(ctx, ids, coords) {
  if (coords && ids.some((id) => !getUnit(id))) await unitsAround(coords[1], coords[0], 0);
  const units = ids.map(getUnit).filter(Boolean);
  if (!units.length) {
    ctx.sheet.open('<div class="empty">Immeuble introuvable dans les données actuelles.</div>');
    return;
  }
  if (units.length === 1) return renderUnit(ctx, units[0].id, coords);
  const muni = await loadMuni(units[0].muni);
  const meta = ctx.meta;
  const list = units
    .map((u) => ({ u, e: estimate(u, muni, meta) }))
    .sort((a, b) => a.u.adr.localeCompare(b.u.adr, 'fr', { numeric: true }));
  const adr = units[0].adr.split(',')[0];
  const vals = list.map((x) => x.e.valeur);
  ctx.sheet.open(`
    <div class="sh-head">
      <div class="eyebrow">Immeuble · ${units.length} unités · ${esc(muni.nom)}</div>
      <h2>${esc(adr)}</h2>
    </div>
    <div class="kpis">${kpi('Médiane estimée', kmoney(median(vals)))}${kpi('Plus basse', kmoney(Math.min(...vals)))}${kpi('Plus haute', kmoney(Math.max(...vals)))}</div>
    <section class="card"><h3>Unités</h3>
      <div class="list">${list.map(({ u, e }) => `
        <button class="list-item" data-id="${esc(u.id)}">
          <span><b>${esc(u.adr.split(',')[1]?.trim() || u.adr)}</b><small>${u.aire ? aire(u.aire) : ''}${u.an ? ` · ${u.an}` : ''}</small></span>
          <span class="li-v">${kmoney(e.valeur)}</span>
        </button>`).join('')}
      </div>
    </section>`);
  $$('.list-item', ctx.sheet.body).forEach((b) => b.addEventListener('click', () => ctx.navigate(`#/u/${encodeURIComponent(b.dataset.id)}@${coords[1]},${coords[0]}`)));
}

export async function renderUnit(ctx, id, coords) {
  let unit = getUnit(id);
  if (!unit && coords) {
    await unitsAround(coords[1], coords[0], 0);
    unit = getUnit(id);
  }
  if (!unit) {
    ctx.sheet.open('<div class="empty">Propriété introuvable. Elle a peut-être changé depuis la dernière mise à jour des données.</div>');
    return;
  }
  const meta = ctx.meta;
  const muni = await loadMuni(unit.muni);
  const est = estimate(unit, muni, meta);
  const ts = muni.types?.[unit.t];
  const pc = ts ? percentile(est.valeur, ts.hist) : null;
  const typeLabel = meta.typeLabels[unit.t] || 'Résidentiel';
  const user = auth.getUser();
  ctx.carte.select(unit.id);

  const f = est.facteurs;
  const m2 = unit.aire ? est.valeur / unit.aire : null;
  const head = `
    <div class="sh-head">
      <div class="eyebrow">${esc(typeLabel)} · <a href="#/m/${muni.code}">${esc(muni.nom)}</a></div>
      <h2>${esc(unit.adr || 'Adresse non inscrite')}</h2>
      <div class="sh-actions">
        <button class="btn icon-btn" id="fav" title="Ajouter aux favoris" aria-label="Favori">${icon('star')}</button>
        <button class="btn icon-btn" id="share" title="Partager" aria-label="Partager">${icon('share')}</button>
        <span class="pdf-wrap"><button class="btn" id="pdf" title="Télécharger le rapport PDF" aria-haspopup="true">${icon('download')}<span>Rapport PDF</span></button>
          <span class="pdf-menu" id="pdf-menu" hidden>
            <button data-lang="fr">Rapport en français</button><button data-lang="en">Report in English</button>
            <span class="pdf-u">Superficies : <button data-u="m2">m²</button><button data-u="pi2">pi²</button></span>
          </span></span>
        ${isNative() ? '' : `<button class="btn icon-btn" id="print" title="Imprimer" aria-label="Imprimer">${icon('print')}</button>`}
      </div>
    </div>`;
  const photo = `
    <figure class="photos" id="photos">
      <div class="ph" id="ph-aer"><div class="ph-load"></div></div>
      <figcaption><span id="ph-cap">${icon('camera')} Vue aérienne</span>
        <a href="${lienFacade(unit.lat, unit.lon)}" target="_blank" rel="noopener">Voir la façade (Street View)</a></figcaption>
    </figure>`;
  const hero = `
    <section class="hero">
      <div class="eyebrow">Valeur marchande estimée aujourd'hui</div>
      <div class="big">${money(est.valeur)}</div>
      ${rangeBar(est.bas, est.valeur, est.haut)}
      <p class="sub">Fourchette indicative de ±${Math.round(est.marge * 100)} %. Estimation statistique, pas une évaluation agréée.</p>
      <details class="how"><summary>${icon('info')} Comment c'est calculé</summary>
        <div class="calc">
          ${row(`Valeur au rôle ${muni.role.annee || ''}`, money(f.role))}
          ${f.fc ? row(`× Facteur comparatif MAMH ${f.fcAnnee}`, f.fc.toFixed(2).replace('.', ',')) : row('Facteur comparatif', 'non publié (repli)')}
          ${row(`× Tendance locale (${signedPct(f.tendance * 100)}/an × ${num1(f.annees)} an)`, ((1 + f.tendance) ** f.annees).toFixed(3).replace('.', ','))}
          ${row('= Valeur estimée', money(est.valeur))}
          <p class="note">Le facteur comparatif est publié par le ministère des Affaires municipales à partir des ventes réelles
          de la municipalité. La tendance provient de ${esc(f.sourceTendance || 'la médiane régionale')}.
          Valeurs au rôle en date du ${date(muni.role.dateRef)}.</p>
        </div>
      </details>
    </section>`;
  const kpis = `<div class="kpis">
      ${kpi(`Rôle ${muni.role.annee || ''}`, kmoney(unit.vr), unit.va ? `rôle antérieur ${kmoney(unit.va)}` : '')}
      ${kpi(`Prix au ${uniteLabel()}`, parAire(m2).replace(/ \/ (m²|pi²)$/, ''), ts?.medM2 ? `médiane ${parAire(ts.medM2).replace(/ \/ (m²|pi²)$/, '')}` : '')}
      ${kpi('Tendance annuelle', signedPct(muni.marche.g * 100), 'municipalité', muni.marche.g >= 0 ? 'up' : 'down')}
    </div>`;
  const carac = section('Caractéristiques', `
    <div class="grid2">
      ${row('Année de construction', unit.an || '—')}
      ${row('Aire habitable (étages)', aire(unit.aire))}
      ${row('Terrain', aire(unit.ter))}
      ${row('Étages', unit.et || '—')}
      ${row('Logements', unit.lg || '—')}
      ${row('Implantation', LIENS[unit.li] || '—')}
    </div>`, { note: 'Source : rôle d\'évaluation foncière (MAMH). Le propriétaire n\'est jamais affiché.' });
  let imm = null; let frais = null; let immHtml = '';
  if (unit.t === 'C') {
    imm = immeuble(unit, await unitsAround(unit.lat, unit.lon, 0), muni, meta);
    frais = fraisCondo(unit, imm?.unites);
    if (imm || frais) {
      immHtml = section('L\'immeuble', `<div class="grid2">
        ${imm ? row('Unités de copropriété', num(imm.unites)) : ''}
        ${imm?.etages ? row('Étages', imm.etages) : ''}
        ${imm && imm.unites > 1 ? row('Valeur médiane des unités', kmoney(imm.medianeValeur)) : ''}
        ${imm && imm.unites > 1 ? row('Plus basse à plus haute', `${kmoney(imm.min)} à ${kmoney(imm.max)}`) : ''}
        ${imm?.centile != null ? row('Rang de cette unité', `plus chère que ${imm.centile} % des unités`) : ''}
        ${imm?.medianeAire ? row('Superficie médiane', aire(imm.medianeAire)) : ''}
        ${frais ? row('Frais de copropriété estimés', `${money(frais.mensuel)} / mois`) : ''}
        ${frais ? row('Fourchette des frais', `${money(frais.bas)} à ${money(frais.haut)}`) : ''}
      </div>`, { note: 'Frais estimés selon la superficie, l\'âge et la taille de l\'immeuble (repère québécois : 0,25 $ à 0,40 $ par pi² par mois). Les frais réels figurent au budget du syndicat ; demandez aussi l\'étude du fonds de prévoyance.' });
    }
  }
  const position = ts ? section(`Position parmi les ${typeLabel.toLowerCase()}s de ${muni.nom}`, `
      ${histogram(ts.hist, est.valeur)}
      <p class="lead">${pc != null ? `Plus élevée que <b>${pc} %</b> des propriétés comparables de la municipalité. ` : ''}
      Médiane : <b>${kmoney(ts.medEst)}</b> (moitié centrale : ${kmoney(ts.p25)} à ${kmoney(ts.p75)}).</p>`) : '';

  ctx.sheet.open(`${head}${photo}${hero}${kpis}${carac}${immHtml}${position}<div id="gated"></div>`);
  const body = ctx.sheet.body;
  chargerPhotos(body, unit);

  $('#fav', body).addEventListener('click', async () => {
    if (!auth.getUser()) { ctx.navigate('#/compte'); toast('Connectez-vous pour enregistrer des favoris.'); return; }
    try {
      const added = await auth.toggleFavori({ id: unit.id, adr: unit.adr, muni: muni.nom, lat: unit.lat, lon: unit.lon,
        valeur: est.valeur, type: typeLabel });
      $('#fav', body).classList.toggle('on', added);
      toast(added ? 'Ajouté aux favoris.' : 'Retiré des favoris.');
    } catch (e) {
      if (e.message === 'limite-favoris') toast('Limite de favoris atteinte pour votre forfait.', 'warn');
    }
  });
  auth.getFavoris().then((l) => $('#fav', body)?.classList.toggle('on', l.some((x) => x.id === unit.id)));
  $('#share', body).addEventListener('click', async () => {
    const r = await shareLink(`${unit.adr} — ${CONFIG.appName}`, `Valeur estimée : ${money(est.valeur)}`);
    if (r === 'copie') toast('Lien copié dans le presse-papiers.');
  });

  const gated = $('#gated', body);
  if (!user) {
    gated.innerHTML = `<section class="card cta">
      <h3>Analyse complète gratuite</h3>
      <p>Comparables, coûts d'achat, stratégie de vente, rendement locatif, commodités du secteur et facilité de revente.</p>
      <a class="btn primary" href="#/compte?inscription">Créer un compte gratuit</a>
      <a class="btn ghost" href="#/compte">J'ai déjà un compte</a></section>`;
    for (const id of ['#print', '#pdf']) $(id, body)?.addEventListener('click', () => { toast('Créez un compte gratuit pour obtenir le rapport.'); ctx.navigate('#/compte?inscription'); });
    return;
  }
  const quota = await auth.useAnalysis(unit.id);
  if (!quota.ok) {
    gated.innerHTML = `<section class="card cta"><h3>Quota mensuel atteint</h3>
      <p>Votre forfait inclut ${quota.quota} analyses détaillées par mois. Passez au forfait Pro pour des analyses illimitées.</p>
      <a class="btn primary" href="#/tarifs">Voir les forfaits</a></section>`;
    return;
  }

  // Comparables : condos d'autres immeubles, plex du même nombre de logements, maisons semblables.
  const around = await unitsAround(unit.lat, unit.lon, 1);
  const comps = comparables(unit, around, munisLoaded, meta);
  const compM2 = median(comps.map((c) => c.m2));
  const ecart = ecartComparables(unit, est, comps);
  const compsHtml = comps.length ? section(titreComparables(unit), `
      <div class="table comps"><div class="tr th"><span>Adresse</span><span>Dist.</span><span>Aire</span><span>${unit.t === 'P' ? 'Log.' : 'Année'}</span><span>Est.</span></div>
      ${comps.map((c) => `<a class="tr" href="#/u/${encodeURIComponent(c.id)}@${c.lat},${c.lon}">
        <span>${esc(c.adr)}</span><span>${dist(c.d)}</span><span>${aire(c.aire)}</span><span>${unit.t === 'P' ? (c.lg || '—') : (c.an || '—')}</span><span>${kmoney(c.est)}</span></a>`).join('')}
      </div>
      ${compM2 && m2 ? `<p class="lead">Prix au ${uniteLabel()} des comparables : <b>${parAire(compM2)}</b> (cette propriété : ${parAire(m2)},
        ${signedPct(ecart, 0)}).</p>` : ''}`,
  { note: 'Valeurs estimées par la même méthode, à partir du rôle d\'évaluation. Ce ne sont pas des prix de vente. '
    + '<a href="#" id="csv">Exporter en CSV</a>' }) : '';

  const st = {
    prix: est.valeur, misePct: CONFIG.defauts.misePct, taux: meta.hypotheque?.tauxAffiche5ans || 5,
    amort: CONFIG.defauts.amortissement,
    taxes: Math.round((unit.vr * CONFIG.defauts.tauxTaxesFoncieresPct) / 100 / 10) * 10,
    commission: CONFIG.defauts.commissionPct, revenu: 0,
    logements: Math.max(1, unit.lg || 1), loyer: loyerEstime(unit, muni) || 0,
    vacance: CONFIG.defauts.vacancePct, entretien: CONFIG.defauts.entretienPct,
    assurances: CONFIG.defauts.assuranceParLogement * Math.max(1, unit.lg || 1), gestion: 0,
    fraisCondo: frais?.mensuel || 0,
  };
  if (unit.t === 'C') st.assurances = 400; // l'assurance de l'immeuble est incluse dans les frais de copropriété
  const order = tabOrder(user.profil);
  const resume = section('Synthèse', `<p class="synth">${esc(synthese({ unit, muni, est, pc, comps, st, meta, imm, frais }))}</p>`);
  gated.innerHTML = `${resume}<div id="decision"></div>${compsHtml}
    <nav class="tabs" role="tablist">${order.map((k, i) => `<button role="tab" class="tab${i ? '' : ' on'}" data-tab="${k}">${TABS[k]}</button>`).join('')}</nav>
    <div id="tabpanel" class="tabpanel"></div>
    ${Number.isFinite(quota.restant) ? `<p class="note center">Analyses restantes ce mois-ci : ${quota.restant}</p>` : ''}`;
  const panel = $('#tabpanel', body);
  const ctxTab = { unit, muni, est, meta, st, pc, comps, imm, frais, osm: null };
  const decision = $('#decision', body);
  let tDecision = null;
  ctxTab.majDecision = () => { clearTimeout(tDecision); tDecision = setTimeout(() => decision.isConnected && (decision.innerHTML = decisionHtml(ctxTab)), 120); };
  st.onChange = ctxTab.majDecision;
  decision.innerHTML = decisionHtml(ctxTab);
  environs(unit.lat, unit.lon).then((osm) => { if (osm) { ctxTab.osm = osm; ctxTab.majDecision(); } }).catch(() => {});
  const show = (k) => {
    $$('.tab', body).forEach((t) => t.classList.toggle('on', t.dataset.tab === k));
    RENDER[k](panel, ctxTab);
  };
  $$('.tab', body).forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
  show(order[0]);

  $('#csv', body)?.addEventListener('click', async (e) => {
    e.preventDefault();
    await saveFile(comparablesCsv(unit, comps), 'DataHouse-comparables.csv', 'Comparables');
  });
  const needPro = () => {
    if (auth.forfait().rapports) return false;
    toast('Les rapports PDF et imprimables font partie du forfait Pro.', 'warn');
    ctx.navigate('#/tarifs');
    return true;
  };
  $('#print', body)?.addEventListener('click', () => { if (!needPro()) printReport(ctxTab, user); });
  const menu = $('#pdf-menu', body);
  const majMenu = () => $$('[data-u]', menu).forEach((b) => b.classList.toggle('on', b.dataset.u === getPrefs().unites));
  $('#pdf', body).addEventListener('click', (e) => {
    e.stopPropagation();
    if (needPro()) return;
    majMenu();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.pdf-wrap')) menu.hidden = true; });
  $$('[data-u]', menu).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); setPrefs({ unites: b.dataset.u }, { silencieux: true }); majMenu(); }));
  $$('[data-lang]', menu).forEach((b) => b.addEventListener('click', async () => {
    menu.hidden = true;
    const lang = b.dataset.lang;
    setPrefs({ langueRapport: lang }, { silencieux: true });
    const btn = $('#pdf', body);
    btn.disabled = true;
    btn.querySelector('span').textContent = lang === 'en' ? 'Preparing…' : 'Préparation…';
    try {
      const { blob, filename } = await pdfReport(ctxTab, auth.getUser(), auth.forfait(), { lang, unites: getPrefs().unites });
      await saveFile(blob, filename, 'Rapport DataHouse');
      toast(lang === 'en' ? 'PDF report ready.' : 'Rapport PDF prêt.');
    } catch (err) {
      console.error(err);
      toast('Impossible de générer le PDF pour le moment.', 'warn');
    } finally {
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Rapport PDF';
    }
  }));
}

function bindInputs(panel, st, map, recalc) {
  for (const [id, key] of Object.entries(map)) {
    const el = $(`#${id}`, panel);
    el?.addEventListener('input', () => { st[key] = val(id, panel); recalc(); st.onChange?.(); });
  }
  recalc();
}

const RENDER = {
  acheteur(panel, { unit, muni, est, meta, st }) {
    const tauxNote = `Taux affiché des banques (Banque du Canada, ${date(meta.hypotheque?.date)}). Les taux négociés sont souvent plus bas : ajustez.`;
    panel.innerHTML = `
      ${section('Votre scénario d\'achat', `<div class="form-grid">
        ${field('a-prix', 'Prix d\'achat', st.prix, { suffix: '$', step: 1000 })}
        ${field('a-mise', 'Mise de fonds', st.misePct, { suffix: '%', step: 1 })}
        ${field('a-taux', 'Taux hypothécaire', st.taux, { suffix: '%', step: 0.05 })}
        ${field('a-amort', 'Amortissement', st.amort, { suffix: 'ans', step: 1 })}
        ${field('a-taxes', 'Taxes foncières / an', st.taxes, { suffix: '$', step: 50 })}
        ${unit.t === 'C' ? field('a-frais', 'Frais de copropriété / mois', st.fraisCondo, { suffix: '$', step: 10 }) : ''}
        ${field('a-revenu', 'Revenu du ménage (optionnel)', st.revenu || '', { suffix: '$', step: 1000 })}
      </div>`, { note: tauxNote })}
      <div id="a-out"></div>`;
    bindInputs(panel, st, { 'a-prix': 'prix', 'a-mise': 'misePct', 'a-taux': 'taux', 'a-amort': 'amort', 'a-taxes': 'taxes', 'a-revenu': 'revenu', 'a-frais': 'fraisCondo' }, () => {
      const r = analyseAcheteur({ prix: st.prix, misePct: st.misePct, taux: st.taux, amort: st.amort, code: muni.code, meta,
        taxesAnnuelles: st.taxes, revenu: st.revenu, fraisNotaire: CONFIG.defauts.fraisNotaire, fraisCondo: st.fraisCondo,
        inspection: CONFIG.defauts.inspection, chauffageMensuel: CONFIG.defauts.chauffageMensuel });
      const zp = zonesPrix(est, st);
      const pa = palierPrix(zp, 'acheteur', st.prix);
      const txt = {
        favorable: `Bon prix pour l'acheteur : sous ${kmoney(zp.acheteur.favorable[1])}. Vérifiez l'état du bâtiment, un prix bas a souvent une raison.`,
        neutre: `Prix dans la zone juste (${kmoney(zp.acheteur.neutre[0])} à ${kmoney(zp.acheteur.neutre[1])}).`,
        defavorable: `Prix élevé pour l'acheteur : au-delà de ${kmoney(zp.acheteur.defavorable[0])}. Négociez ou faites-le justifier par l'état et les rénovations.`,
      }[pa];
      const pos = `<div class="flag ${pa === 'favorable' ? 'good' : pa === 'defavorable' ? 'bad' : ''}">${palierTag(pa)} ${esc(txt)}</div>`;
      $('#a-out', panel).innerHTML = `${pos}
        <div class="kpis">${kpi('Paiement hypothécaire', `${money(r.paiement)}`, '/ mois')}${kpi('Coût mensuel total', money(r.coutMensuel), unit.t === 'C' ? 'hypothèque, taxes, chauffage, frais' : 'hypothèque, taxes, chauffage')}${kpi('Comptant requis', kmoney(r.comptant))}</div>
        ${section('Coûts d\'acquisition', `
          ${row('Mise de fonds', money(r.mise))}
          ${row(`Droits de mutation${r.droits.specifique ? ` (${muni.nom})` : ''}`, money(r.droits.total))}
          ${row('Notaire (hypothèse)', money(r.fraisNotaire))}
          ${row('Inspection (hypothèse)', money(r.inspection))}
          ${r.schl.taux ? row(`Prime SCHL (${pct(r.schl.taux * 100, 2)}, ajoutée au prêt)`, money(r.schl.montant)) : ''}
          ${row('Montant du prêt', money(r.pret))}`,
        { note: r.droits.specifique ? '' : esc(meta.droitsMutation.note) })}
        ${section('Capacité d\'emprunt', `
          ${row('Taux de qualification (test de résistance)', pct(r.tauxQualif, 2))}
          ${row('Revenu familial requis (approx.)', money(r.revenuRequis))}
          ${r.prixMax ? row('Prix maximal avec votre revenu (approx.)', money(r.prixMax), r.prixMax >= st.prix ? 'good' : 'bad') : ''}
          ${r.schl.admissible === false && st.misePct < 5 ? '<p class="flag bad">Mise de fonds minimale : 5 % (davantage au-delà de 500 000 $).</p>' : ''}`,
        { note: `Calcul basé sur un ratio d'amortissement brut de la dette de 39 %, sans autres dettes${unit.t === 'C' ? ', en comptant 50 % des frais de copropriété' : ''}. Consultez votre institution financière.` })}
        ${section('À vérifier avant d\'acheter', `<ul class="check">
          <li>Certificat de localisation récent et conforme</li><li>Inspection préachat par un inspecteur membre d'un ordre ou d'une association</li>
          <li>Déclarations du vendeur et historique des rénovations</li><li>Zone inondable et règlements de zonage (site de la municipalité)</li>
          ${unit.t === 'C' ? '<li>Déclaration de copropriété, fonds de prévoyance, étude du fonds et procès-verbaux</li>' : ''}
          ${unit.lg > 1 ? '<li>Baux en vigueur, loyers réels et dossiers au Tribunal administratif du logement</li>' : ''}
        </ul>`)}`;
    });
  },

  vendeur(panel, { muni, est, st, pc, comps }) {
    panel.innerHTML = `${section('Commission de courtage', `<div class="form-grid">
        ${field('v-com', 'Taux de commission', st.commission, { suffix: '%', step: 0.25 })}</div>`)}<div id="v-out"></div>`;
    bindInputs(panel, st, { 'v-com': 'commission' }, () => {
      const r = analyseVendeur({ est, commissionPct: st.commission });
      $('#v-out', panel).innerHTML = `
        ${section('Prix d\'affichage suggérés', `<div class="strategies">${r.strategies.map((s) => `
          <div class="strat"><div class="strat-n">${s.nom}</div><div class="strat-p">${money(s.prix)}</div><p>${s.note}</p></div>`).join('')}</div>`,
        { note: 'Basé sur la fourchette estimée. L\'état réel, les rénovations et la saison influencent le prix obtenu.' })}
        ${section('Vendre sans courtier', `
          ${row('Commission évitée', money(r.commission))}
          ${row('TPS et TVQ sur la commission', money(r.taxes))}
          ${row('Économie potentielle', money(r.total), 'good')}
          <ul class="check">
            <li>Faire préparer un certificat de localisation à jour</li>
            <li>Remplir une déclaration du vendeur complète (vices connus, rénovations, sinistres)</li>
            <li>Photos professionnelles et mise en marché sur une plateforme de vente entre particuliers</li>
            <li>Encadrer la promesse d'achat (conditions de financement, d'inspection) — un notaire ou un avocat peut vous accompagner</li>
            <li>Choisir le notaire (habituellement choisi par l'acheteur) et préparer les documents</li>
          </ul>`, { note: 'Avec un courtier, vous bénéficiez de sa mise en marché, de sa négociation et de l\'encadrement de l\'OACIQ.' })}
        ${section('Arguments de vente', `<ul class="check">
          ${pc != null ? `<li>Valeur estimée au ${pc}<sup>e</sup> centile de ${esc(muni.nom)} pour ce type de propriété</li>` : ''}
          ${comps.length ? `<li>${comps.length} propriétés comparables analysées dans un rayon de 1,5 km</li>` : ''}
          ${muni.marche.g > 0.03 ? `<li>Marché local en hausse (${signedPct(muni.marche.g * 100)} par an)</li>` : ''}
          ${muni.liquidite?.score >= 55 ? '<li>Municipalité où la revente est généralement facile</li>' : ''}
        </ul>`)}`;
    });
  },

  investisseur(panel, { unit, muni, est, meta, st }) {
    const loyerMarche = loyerEstime(unit, muni);
    const ref = muni.loyer || {};
    const refs = [
      ref.estime ? `loyer de référence : <b>${money(ref.estime)}</b> (${ref.source === 'affiche' ? 'loyer affiché régional réduit de 10 %, à valider localement' : 'recensement 2021 indexé selon l\'IPC des loyers'})` : '',
      ref.affiche2ch ? `loyer affiché moyen d'un 2 chambres dans la région : <b>${money(ref.affiche2ch)}</b> (${esc(ref.periodeAffiche || '')})` : '',
    ].filter(Boolean).join(' ; ');
    panel.innerHTML = `
      ${section('Revenus et dépenses', `<div class="form-grid">
        ${field('i-prix', 'Prix d\'achat', st.prix, { suffix: '$', step: 1000 })}
        ${field('i-log', 'Logements', st.logements, { step: 1, min: 1 })}
        ${field('i-loyer', 'Loyer moyen / logement', st.loyer, { suffix: '$', step: 10 })}
        ${field('i-vac', 'Inoccupation', st.vacance, { suffix: '%', step: 0.5 })}
        ${field('i-taxes', 'Taxes foncières / an', st.taxes, { suffix: '$', step: 50 })}
        ${field('i-ass', 'Assurances / an', st.assurances, { suffix: '$', step: 50 })}
        ${field('i-ent', 'Entretien', st.entretien, { suffix: '% rev.', step: 0.5 })}
        ${field('i-ges', 'Gestion', st.gestion, { suffix: '% rev.', step: 0.5 })}
        ${unit.t === 'C' ? field('i-frais', 'Frais de copropriété / mois', st.fraisCondo, { suffix: '$', step: 10 }) : ''}
        ${field('i-mise', 'Mise de fonds', Math.max(st.misePct, 20), { suffix: '%', step: 1 })}
        ${field('i-taux', 'Taux hypothécaire', st.taux, { suffix: '%', step: 0.05 })}
      </div>`, { note: `Repères : ${refs || 'aucun loyer de référence disponible pour ce secteur'}. Au Québec, les hausses de loyer
        des baux en cours sont encadrées par le Tribunal administratif du logement.` })}
      <div id="i-out"></div>`;
    if (st.misePct < 20) st.misePct = 20;
    bindInputs(panel, st, { 'i-prix': 'prix', 'i-log': 'logements', 'i-loyer': 'loyer', 'i-vac': 'vacance', 'i-taxes': 'taxes',
      'i-ass': 'assurances', 'i-ent': 'entretien', 'i-ges': 'gestion', 'i-mise': 'misePct', 'i-taux': 'taux', 'i-frais': 'fraisCondo' }, () => {
      const r = analyseInvestisseur({ prix: st.prix, logements: st.logements, loyer: st.loyer, vacancePct: st.vacance,
        taxes: st.taxes, assurances: st.assurances, entretienPct: st.entretien, gestionPct: st.gestion, autresDepenses: (st.fraisCondo || 0) * 12,
        misePct: st.misePct, taux: st.taux, amort: st.amort });
      const tone = (x, a, b) => (x == null ? '' : x >= a ? 'up' : x < b ? 'down' : '');
      const zl = zonesLoyer(loyerMarche, st);
      const pl = palierLoyer(zl, st.loyer);
      const zp = zonesPrix(est, st);
      const pi = palierPrix(zp, 'investisseur', st.prix);
      const loyerHtml = zl ? section('Zones de loyer', `
          ${zonesBars([{ label: 'Loyer / log.', zones: { defavorable: zl.defavorable, neutre: zl.neutre, favorable: zl.favorable, risque: [zl.risque, null] },
            cap: `${palierTag(pl, { favorable: 'Au marché', neutre: 'Un peu bas', defavorable: 'Sous le marché', risque: 'Risque d\'inoccupation' }[pl])}` }],
          [{ v: zl.marche, label: 'Loyer du marché', cls: 'est' }, { v: st.loyer, label: 'Loyer retenu', cls: 'prix' }, { v: zl.equilibre, label: 'Loyer d\'équilibre', cls: 'eq' }],
          { fmtv: (v) => money(v) })}
          <p class="lead">${st.loyer >= zl.equilibre
            ? `Au loyer retenu, l'immeuble couvre ses dépenses et l'hypothèque (loyer d'équilibre : <b>${money(zl.equilibre)}</b> par logement).`
            : `Il faudrait <b>${money(zl.equilibre)}</b> par logement pour couvrir les dépenses et l'hypothèque (${money(zl.equilibre - st.loyer)} de plus que le loyer retenu).`}</p>`,
        { note: 'Sous 90 % du loyer du marché : revenus faibles (au Québec, les hausses en cours de bail sont encadrées par le TAL). Au-delà de 115 % : risque d\'inoccupation.' }) : '';
      const prixInv = zp.investisseur ? `<div class="flag ${pi === 'favorable' ? 'good' : pi === 'defavorable' ? 'bad' : ''}">${palierTag(pi)}
          Pour un investisseur, ce prix est ${{ favorable: 'intéressant', neutre: 'acceptable', defavorable: 'élevé' }[pi]} :
          favorable sous ${kmoney(zp.investisseur.favorable[1])} (capitalisation de 5 % ou plus), défavorable au-delà de ${kmoney(zp.investisseur.defavorable[0])} (moins de 4 %).</div>` : '';
      $('#i-out', panel).innerHTML = `${prixInv}
        <div class="kpis">
          ${kpi('Liquidités / mois', money(r.liquiditeMensuelle), 'après hypothèque', r.liquiditeMensuelle >= 0 ? 'up' : 'down')}
          ${kpi('Taux de capitalisation', pct(r.tauxCapitalisation, 2), 'RNE / prix', tone(r.tauxCapitalisation, 5, 3.5))}
          ${kpi('Rendement sur mise', pct(r.rendementMise, 1), 'liquidités / mise', tone(r.rendementMise, 5, 0))}
        </div>
        ${section('Détail', `
          ${row('Revenus bruts annuels', money(r.revenusBruts))}
          ${row('Revenus effectifs (après inoccupation)', money(r.revenusEffectifs))}
          ${row('Dépenses d\'exploitation', money(r.depenses))}
          ${row('Revenu net d\'exploitation (RNE)', money(r.rne))}
          ${row('Service de la dette', money(r.serviceDette))}
          ${row('Multiplicateur de revenus bruts (MRB)', r.mrb ? num1(r.mrb) : '—')}
          ${row('Ratio de couverture de la dette (RCD)', r.rcd ? r.rcd.toFixed(2).replace('.', ',') : '—', r.rcd >= 1.2 ? 'good' : 'bad')}
          ${row('Prix par porte', money(r.prixParPorte))}
          ${row('Rendement brut', pct(r.rendementBrut, 2))}`,
        { note: 'Les prêteurs exigent généralement un RCD d\'au moins 1,1 à 1,2 pour un immeuble locatif. Hypothèses modifiables ci-dessus.' })}
        ${loyerHtml}
        ${muni.rendementPlex ? `<p class="lead">Rendement brut médian des plex à ${esc(muni.nom)} : <b>${pct(muni.rendementPlex)}</b>.</p>` : ''}`;
    });
  },

  async secteur(panel, ctxT) {
    const { unit, muni, est, meta } = ctxT;
    const c = muni.recensement || {};
    panel.innerHTML = `
      <div id="s-pc">${section('Avantages et inconvénients', '<p class="loading">Analyse des commodités autour de l\'adresse…</p>')}</div>
      ${section(`Portrait de ${muni.nom}`, `<div class="grid2">${[
        ['Population (2021)', c.pop2021, num(c.pop2021)],
        ['Croissance 2016-2021', c.croissancePop, signedPct(c.croissancePop)],
        ['Ménages', c.menages, num(c.menages)],
        ['Revenu médian des ménages (2020)', c.revenuMenage, money(c.revenuMenage)],
        ['Hausse du revenu 2015-2020', c.croissanceRevenu, signedPct(c.croissanceRevenu)],
        ['Propriétaires', c.pctProprio, pct(c.pctProprio, 0)],
        ['Locataires au-delà de 30 % du revenu', c.pctInabordableLocataire, pct(c.pctInabordableLocataire, 0)],
        ['Propriétaires au-delà de 30 % du revenu', c.pctInabordableProprio, pct(c.pctInabordableProprio, 0)],
        ['Ménages en besoin impérieux de logement', c.pctBesoinImperieux, pct(c.pctBesoinImperieux, 0)],
        ['Âge moyen', c.ageMoyen, num1(c.ageMoyen)],
        ['Âge médian', c.ageMedian, num1(c.ageMedian)],
        ['65 ans et plus', c.pct65, pct(c.pct65, 0)],
        ['Ont déménagé en 1 an', c.pctDemenage1an, pct(c.pctDemenage1an, 0)],
        ['Valeur médiane déclarée (2021)', c.valeurDeclaree2021, money(c.valeurDeclaree2021)],
        ['Prix médian / revenu', muni.ratioPrixRevenu, num1(muni.ratioPrixRevenu)],
        ['Densité', c.densite, c.densite ? `${num(c.densite)} hab./km²` : '—'],
      ].filter((r) => r[1] != null).map(([l, , v]) => row(l, v)).join('')}
      </div>`, { note: 'Source : Statistique Canada, Recensement de 2021.' })}
      <div id="s-env"></div>
      ${newsHtml(muni)}`;
    const osm = await environs(unit.lat, unit.lon);
    ctxT.osm = osm;
    const pcs = prosCons({ muni, meta, unit, osm, est });
    $('#s-pc', panel).innerHTML = section('Avantages et inconvénients', prosConsHtml(pcs),
      { note: osm ? 'Commodités : OpenStreetMap (contributeurs). Vérifiez sur place.' : 'Commodités indisponibles pour le moment (service OpenStreetMap).' });
    if (osm) {
      $('#s-env', panel).innerHTML = section('À proximité', `<div class="grid2">${Object.values(osm).map((o) =>
        row(o.label, o.plusProche != null ? `${dist(o.plusProche)}${o.nuisance ? '' : ` · ${o.n}`}` : (o.nuisance ? 'aucune' : 'aucun'), o.nuisance && o.n ? 'bad' : '')).join('')}</div>`,
      { note: 'Distance à vol d\'oiseau du plus proche, puis nombre trouvé dans le rayon de recherche.' });
    }
  },

  revente(panel, { unit, muni, pc }) {
    const r = indiceRevente(unit, muni, pc);
    const comp = muni.liquidite?.composantes || {};
    const labels = { tailleMarche: 'Taille du marché', croissanceDemo: 'Croissance démographique', tendancePrix: 'Tendance des prix',
      mobilite: 'Mobilité résidentielle', abordabilite: 'Abordabilité' };
    panel.innerHTML = r ? `${section('Facilité de revente', `
        <div class="gauge-wrap">${gauge(r.score, { label: 'Facilité de revente' })}<div><div class="big2">${r.niveau}</div>
        <p class="lead">Indice expérimental de 0 à 100, combinant le dynamisme de ${esc(muni.nom)} et le profil de la propriété.</p></div></div>
        ${Object.entries(labels).map(([k, l]) => `<div class="mrow"><span>${l}</span>${meter(comp[k])}</div>`).join('')}
        ${row('Ajustement selon le type', signedPct(r.ajustType, 0).replace(' %', ' pts'))}
        ${row('Ajustement selon le prix dans le marché', signedPct(r.ajustPrix, 0).replace(' %', ' pts'))}`,
    { note: 'Les propriétés dans la moitié centrale des prix et les maisons unifamiliales se revendent généralement plus vite. Les délais réels varient selon l\'état, le prix demandé et la saison.' })}`
      : section('Facilité de revente', '<p class="empty">Données insuffisantes pour cette municipalité.</p>');
  },
};

/** Scores par profil et zones de prix (se met à jour quand le scénario change). */
function decisionHtml(ctxT) {
  const { unit, muni, est, pc, comps, st, osm } = ctxT;
  const sc = scores({ unit, muni, est, pc, comps, st, osm });
  const zp = zonesPrix(est, st);
  const rangees = [
    { label: 'Acheteur', zones: zp.acheteur },
    { label: 'Vendeur', zones: zp.vendeur, cap: `${icon('up')} &gt; ${kmoney(zp.vendeur.favorable[0])}` },
  ];
  if (zp.investisseur) rangees.push({ label: 'Investisseur', zones: zp.investisseur });
  const reperes = [{ v: est.valeur, label: 'Valeur estimée', cls: 'est' }];
  if (Math.abs(st.prix - est.valeur) > 500) reperes.push({ v: st.prix, label: 'Prix analysé', cls: 'prix' });
  const tags = ['acheteur', 'vendeur', 'investisseur'].filter((k) => zp[k]).map((k) =>
    `<span class="ztag"><b>${{ acheteur: 'Acheteur', vendeur: 'Vendeur', investisseur: 'Investisseur' }[k]}</b> ${palierTag(palierPrix(zp, k, st.prix))}</span>`).join('');
  return `${section('Scores par profil', scoreCards(sc, { acheteur: 'Acheteur', vendeur: 'Vendeur', investisseur: 'Investisseur' }, FACTEURS.fr),
    { note: `Score de 0 à 100 : favorable à partir de 65, neutre de 45 à 64, défavorable sous 45. Touchez une carte pour voir les facteurs.${osm ? '' : ' Les commodités s\'ajoutent dès qu\'elles sont chargées.'}` })}
    ${section('Zones de prix', `${zonesBars(rangees, reperes)}<div class="ztags">Prix analysé (${kmoney(st.prix)}) : ${tags}</div>`,
    { note: `Acheteur et vendeur : selon la fourchette estimée. Investisseur : capitalisation de 5 % ou plus (favorable) et sous 4 % (défavorable) avec un loyer de ${money(st.loyer)} par logement${unit.lg > 1 ? ` × ${st.logements}` : ''}. Modifiez le prix ou le loyer dans les onglets pour mettre à jour.` })}`;
}

/** Vue aérienne (imagerie du Québec) et, si configurée, photo de la façade. */
async function chargerPhotos(body, unit) {
  const box = $('#ph-aer', body);
  const w = 720; const h = 400;
  try {
    const [aer, fac] = await Promise.all([vueAerienne(unit.lat, unit.lon, { w, h }).catch(() => null), photoFacade(unit.lat, unit.lon, { w, h })]);
    if (!box.isConnected) return;
    if (!aer && !fac) { $('#photos', body).classList.add('vide'); box.innerHTML = '<p class="note">Imagerie indisponible pour cette adresse.</p>'; return; }
    box.innerHTML = `${fac ? `<img src="${esc(fac.url)}" alt="Façade de la propriété (Street View)" loading="lazy">` : ''}
      ${aer ? `<img src="${aer.dataUrl}" alt="Vue aérienne de la propriété" width="${w}" height="${h}">` : ''}`;
    box.classList.toggle('duo', Boolean(fac && aer));
    $('#ph-cap', body).innerHTML = `${icon('camera')} ${[fac ? `Façade${fac.date ? ` (${fac.date})` : ''}` : '', aer ? 'Vue aérienne' : ''].filter(Boolean).join(' et ')} · <small>${aer ? ORTHO_CREDIT : 'Google Street View'}</small>`;
  } catch {
    box.innerHTML = '';
  }
}

export function prosConsHtml(pcs) {
  if (!pcs.length) return '<p class="empty">Aucun élément marquant.</p>';
  const cls = { '+': 'pro', '−': 'con', '±': 'mix' };
  return `<ul class="pc">${pcs.map((p) => `<li class="${cls[p.signe]}"><b>${p.signe}</b><span>${esc(p.texte)}${p.cle !== 'tous' ? ` <em>(${p.pour})</em>` : ''}</span></li>`).join('')}</ul>`;
}

export function newsHtml(muni) {
  const n = muni.nouvelles;
  if (!n || !n.items?.length) return '';
  const fx = { hausse: 'pro', baisse: 'con', neutre: 'mix', incertain: 'mix' };
  return section('Nouvelles récentes du secteur', `<ul class="news">${n.items.slice(0, 8).map((it) => `
    <li class="${fx[it.effet] || ''}"><a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.titre)}</a>
      <small>${esc(it.source)} · ${date(it.date)}${it.effet ? ` · effet possible : ${esc(it.effet)}${it.horizon ? ` (${esc(it.horizon)})` : ''}` : ''}</small>
      ${it.explication ? `<p>${esc(it.explication)}</p>` : ''}</li>`).join('')}</ul>`,
  { note: n.analyse ? `Effets estimés par intelligence artificielle à partir des seuls titres (mise à jour ${date(n.maj)}). À valider.` : `Mise à jour ${date(n.maj)}.` });
}

function printReport({ unit, muni, est, meta, st, comps, pc }, user) {
  const plan = auth.forfait();
  const brand = plan.marque && user.courtier?.nom
    ? `<div class="pr-brand"><b>${esc(user.courtier.nom)}</b>${user.courtier.agence ? ` · ${esc(user.courtier.agence)}` : ''}<br>${esc(user.courtier.tel || '')} ${esc(user.courtier.courriel || '')}</div>`
    : `<div class="pr-brand"><b>${CONFIG.appName}</b> · ${CONFIG.slogan}</div>`;
  const a = analyseAcheteur({ prix: st.prix, misePct: st.misePct, taux: st.taux, amort: st.amort, code: muni.code, meta,
    taxesAnnuelles: st.taxes, fraisNotaire: CONFIG.defauts.fraisNotaire, inspection: CONFIG.defauts.inspection });
  const v = analyseVendeur({ est, commissionPct: st.commission });
  const i = analyseInvestisseur({ prix: st.prix, logements: st.logements, loyer: st.loyer, vacancePct: st.vacance, taxes: st.taxes,
    assurances: st.assurances, entretienPct: st.entretien, gestionPct: st.gestion, misePct: Math.max(20, st.misePct), taux: st.taux, amort: st.amort });
  const pcs = prosCons({ muni, meta, unit, est });
  $('#rapport').innerHTML = `
    <header class="pr-head">${brand}<div>Rapport généré le ${date(new Date().toISOString())}</div></header>
    <h1>${esc(unit.adr)}</h1><p>${esc(meta.typeLabels[unit.t])} · ${esc(muni.nom)}${muni.mrc ? ` (${esc(muni.mrc)})` : ''}</p>
    <div class="pr-hero"><div><small>Valeur marchande estimée</small><div class="big">${money(est.valeur)}</div>
      <small>Fourchette : ${money(est.bas)} à ${money(est.haut)}</small></div>
      <div>${row('Valeur au rôle', money(unit.vr))}${row('Année', unit.an || '—')}${row('Aire habitable', aire(unit.aire))}
      ${row('Terrain', aire(unit.ter))}${row('Logements', unit.lg || '—')}${pc != null ? row('Centile local', `${pc}e`) : ''}</div></div>
    <h2>Synthèse</h2><p>${esc(synthese({ unit, muni, est, pc, comps, st, meta }))}</p>
    <h2>Comparables</h2><table><tr><th>Adresse</th><th>Distance</th><th>Aire</th><th>Estimation</th></tr>
      ${comps.map((c) => `<tr><td>${esc(c.adr)}</td><td>${dist(c.d)}</td><td>${aire(c.aire)}</td><td>${money(c.est)}</td></tr>`).join('')}</table>
    <div class="pr-cols">
      <div><h2>Acheteur</h2>${row('Prix', money(st.prix))}${row('Mise de fonds', `${st.misePct} %`)}${row('Paiement mensuel', money(a.paiement))}
        ${row('Droits de mutation', money(a.droits.total))}${row('Comptant requis', money(a.comptant))}${row('Revenu requis (approx.)', money(a.revenuRequis))}</div>
      <div><h2>Vendeur</h2>${v.strategies.map((s) => row(s.nom, money(s.prix))).join('')}${row('Économie sans courtier', money(v.total))}</div>
      <div><h2>Investisseur</h2>${row('Revenus bruts', money(i.revenusBruts))}${row('RNE', money(i.rne))}${row('Taux de capitalisation', pct(i.tauxCapitalisation, 2))}
        ${row('MRB', i.mrb ? num1(i.mrb) : '—')}${row('Liquidités / mois', money(i.liquiditeMensuelle))}</div>
    </div>
    <h2>Secteur</h2>${prosConsHtml(pcs)}
    <footer class="pr-foot">Estimation statistique fondée sur des données publiques (rôle d'évaluation foncière et facteurs comparatifs du MAMH,
    Statistique Canada, Banque du Canada). Elle ne constitue ni une évaluation agréée ni un avis de courtage. Données au ${date(meta.genere)}.</footer>`;
  document.body.classList.add('printing');
  setTimeout(() => { window.print(); document.body.classList.remove('printing'); }, 60);
}
