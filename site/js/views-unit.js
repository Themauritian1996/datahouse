// Fiche d'une propriété (unité d'évaluation) : estimation et analyses par profil.
import { CONFIG } from './config.js';
import {
  estimate, comparables, percentile, median, analyseAcheteur, analyseVendeur, analyseInvestisseur,
  loyerEstime, indiceRevente,
} from './engine.js';
import { loadMuni, unitsAround, getUnit, munisLoaded } from './data.js';
import { environs, prosCons } from './analysis.js';
import { histogram, gauge, meter, rangeBar } from './charts.js';
import { money, kmoney, pct, signedPct, num, num1, dist, esc, date } from './format.js';
import { $, $$, kpi, row, section, field, val, icon, toast } from './ui.js';
import * as auth from './auth.js';

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
          <span><b>${esc(u.adr.split(',')[1]?.trim() || u.adr)}</b><small>${u.aire ? `${num(u.aire)} m²` : ''}${u.an ? ` · ${u.an}` : ''}</small></span>
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
        <button class="btn icon-btn" id="print" title="Rapport imprimable" aria-label="Rapport">${icon('print')}</button>
      </div>
    </div>`;
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
      ${kpi('Prix au m²', m2 ? `${num(m2)} $` : '—', ts?.medM2 ? `médiane ${num(ts.medM2)} $` : '')}
      ${kpi('Tendance annuelle', signedPct(muni.marche.g * 100), 'municipalité', muni.marche.g >= 0 ? 'up' : 'down')}
    </div>`;
  const carac = section('Caractéristiques', `
    <div class="grid2">
      ${row('Année de construction', unit.an || '—')}
      ${row('Aire habitable (étages)', unit.aire ? `${num(unit.aire)} m² (${num(unit.aire * 10.764)} pi²)` : '—')}
      ${row('Terrain', unit.ter ? `${num(unit.ter)} m²` : '—')}
      ${row('Étages', unit.et || '—')}
      ${row('Logements', unit.lg || '—')}
      ${row('Implantation', LIENS[unit.li] || '—')}
    </div>`, { note: 'Source : rôle d\'évaluation foncière (MAMH). Le propriétaire n\'est jamais affiché.' });
  const position = ts ? section(`Position parmi les ${typeLabel.toLowerCase()}s de ${muni.nom}`, `
      ${histogram(ts.hist, est.valeur)}
      <p class="lead">${pc != null ? `Plus élevée que <b>${pc} %</b> des propriétés comparables de la municipalité. ` : ''}
      Médiane : <b>${kmoney(ts.medEst)}</b> (moitié centrale : ${kmoney(ts.p25)} à ${kmoney(ts.p75)}).</p>`) : '';

  ctx.sheet.open(`${head}${hero}${kpis}${carac}${position}<div id="gated"></div>`);
  const body = ctx.sheet.body;

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

  const gated = $('#gated', body);
  if (!user) {
    gated.innerHTML = `<section class="card cta">
      <h3>Analyse complète gratuite</h3>
      <p>Comparables, coûts d'achat, stratégie de vente, rendement locatif, commodités du secteur et facilité de revente.</p>
      <a class="btn primary" href="#/compte?inscription">Créer un compte gratuit</a>
      <a class="btn ghost" href="#/compte">J'ai déjà un compte</a></section>`;
    $('#print', body).addEventListener('click', () => ctx.navigate('#/compte'));
    return;
  }
  const quota = await auth.useAnalysis(unit.id);
  if (!quota.ok) {
    gated.innerHTML = `<section class="card cta"><h3>Quota mensuel atteint</h3>
      <p>Votre forfait inclut ${quota.quota} analyses détaillées par mois. Passez au forfait Pro pour des analyses illimitées.</p>
      <a class="btn primary" href="#/tarifs">Voir les forfaits</a></section>`;
    return;
  }

  // Comparables
  const around = await unitsAround(unit.lat, unit.lon, 1);
  const comps = comparables(unit, around, munisLoaded, meta);
  const compM2 = median(comps.map((c) => c.m2));
  const compsHtml = comps.length ? section('Propriétés comparables à proximité', `
      <div class="table"><div class="tr th"><span>Adresse</span><span>Dist.</span><span>Aire</span><span>Est.</span></div>
      ${comps.map((c) => `<a class="tr" href="#/u/${encodeURIComponent(c.id)}@${c.lat},${c.lon}">
        <span>${esc(c.adr)}</span><span>${dist(c.d)}</span><span>${c.aire ? `${num(c.aire)} m²` : '—'}</span><span>${kmoney(c.est)}</span></a>`).join('')}
      </div>
      ${compM2 && m2 ? `<p class="lead">Prix au m² des comparables : <b>${num(compM2)} $</b> (cette propriété : ${num(m2)} $,
        ${signedPct(((m2 - compM2) / compM2) * 100, 0)}).</p>` : ''}`,
  { note: 'Valeurs estimées par la même méthode, à partir du rôle d\'évaluation. Ce ne sont pas des prix de vente.' }) : '';

  const st = {
    prix: est.valeur, misePct: CONFIG.defauts.misePct, taux: meta.hypotheque?.tauxAffiche5ans || 5,
    amort: CONFIG.defauts.amortissement,
    taxes: Math.round((unit.vr * CONFIG.defauts.tauxTaxesFoncieresPct) / 100 / 10) * 10,
    commission: CONFIG.defauts.commissionPct, revenu: 0,
    logements: Math.max(1, unit.lg || 1), loyer: loyerEstime(unit, muni) || 0,
    vacance: CONFIG.defauts.vacancePct, entretien: CONFIG.defauts.entretienPct,
    assurances: CONFIG.defauts.assuranceParLogement * Math.max(1, unit.lg || 1), gestion: 0,
  };
  const order = tabOrder(user.profil);
  gated.innerHTML = `${compsHtml}
    <nav class="tabs" role="tablist">${order.map((k, i) => `<button role="tab" class="tab${i ? '' : ' on'}" data-tab="${k}">${TABS[k]}</button>`).join('')}</nav>
    <div id="tabpanel" class="tabpanel"></div>
    ${Number.isFinite(quota.restant) ? `<p class="note center">Analyses restantes ce mois-ci : ${quota.restant}</p>` : ''}`;
  const panel = $('#tabpanel', body);
  const ctxTab = { unit, muni, est, meta, st, pc, comps };
  const show = (k) => {
    $$('.tab', body).forEach((t) => t.classList.toggle('on', t.dataset.tab === k));
    RENDER[k](panel, ctxTab);
  };
  $$('.tab', body).forEach((t) => t.addEventListener('click', () => show(t.dataset.tab)));
  show(order[0]);

  $('#print', body).addEventListener('click', () => {
    if (!auth.forfait().rapports) { toast('Les rapports imprimables font partie du forfait Pro.', 'warn'); ctx.navigate('#/tarifs'); return; }
    printReport(ctxTab, user);
  });
}

function bindInputs(panel, st, map, recalc) {
  for (const [id, key] of Object.entries(map)) {
    const el = $(`#${id}`, panel);
    el?.addEventListener('input', () => { st[key] = val(id, panel); recalc(); });
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
        ${field('a-revenu', 'Revenu du ménage (optionnel)', st.revenu || '', { suffix: '$', step: 1000 })}
      </div>`, { note: tauxNote })}
      <div id="a-out"></div>`;
    bindInputs(panel, st, { 'a-prix': 'prix', 'a-mise': 'misePct', 'a-taux': 'taux', 'a-amort': 'amort', 'a-taxes': 'taxes', 'a-revenu': 'revenu' }, () => {
      const r = analyseAcheteur({ prix: st.prix, misePct: st.misePct, taux: st.taux, amort: st.amort, code: muni.code, meta,
        taxesAnnuelles: st.taxes, revenu: st.revenu, fraisNotaire: CONFIG.defauts.fraisNotaire,
        inspection: CONFIG.defauts.inspection, chauffageMensuel: CONFIG.defauts.chauffageMensuel });
      let pos = '';
      if (st.prix > est.haut) pos = `<p class="flag bad">Ce prix dépasse le haut de la fourchette estimée (${kmoney(est.haut)}). Négociez ou justifiez par l'état et les rénovations.</p>`;
      else if (st.prix < est.bas) pos = `<p class="flag good">Ce prix est sous la fourchette estimée (${kmoney(est.bas)}) : bonne affaire potentielle, vérifiez l'état du bâtiment.</p>`;
      else pos = '<p class="flag">Ce prix se situe dans la fourchette estimée.</p>';
      $('#a-out', panel).innerHTML = `${pos}
        <div class="kpis">${kpi('Paiement hypothécaire', `${money(r.paiement)}`, '/ mois')}${kpi('Coût mensuel total', money(r.coutMensuel), 'hypothèque, taxes, chauffage')}${kpi('Comptant requis', kmoney(r.comptant))}</div>
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
        { note: 'Calcul basé sur un ratio d\'amortissement brut de la dette de 39 %, sans autres dettes. Consultez votre institution financière.' })}
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
        ${field('i-mise', 'Mise de fonds', Math.max(st.misePct, 20), { suffix: '%', step: 1 })}
        ${field('i-taux', 'Taux hypothécaire', st.taux, { suffix: '%', step: 0.05 })}
      </div>`, { note: `Repères : ${refs || 'aucun loyer de référence disponible pour ce secteur'}. Au Québec, les hausses de loyer
        des baux en cours sont encadrées par le Tribunal administratif du logement.` })}
      <div id="i-out"></div>`;
    if (st.misePct < 20) st.misePct = 20;
    bindInputs(panel, st, { 'i-prix': 'prix', 'i-log': 'logements', 'i-loyer': 'loyer', 'i-vac': 'vacance', 'i-taxes': 'taxes',
      'i-ass': 'assurances', 'i-ent': 'entretien', 'i-ges': 'gestion', 'i-mise': 'misePct', 'i-taux': 'taux' }, () => {
      const r = analyseInvestisseur({ prix: st.prix, logements: st.logements, loyer: st.loyer, vacancePct: st.vacance,
        taxes: st.taxes, assurances: st.assurances, entretienPct: st.entretien, gestionPct: st.gestion,
        misePct: st.misePct, taux: st.taux, amort: st.amort });
      const tone = (x, a, b) => (x == null ? '' : x >= a ? 'up' : x < b ? 'down' : '');
      $('#i-out', panel).innerHTML = `
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
        ${muni.rendementPlex ? `<p class="lead">Rendement brut médian des plex à ${esc(muni.nom)} : <b>${pct(muni.rendementPlex)}</b>.</p>` : ''}`;
    });
  },

  async secteur(panel, { unit, muni, est, meta }) {
    const c = muni.recensement || {};
    panel.innerHTML = `
      <div id="s-pc">${section('Avantages et inconvénients', '<p class="loading">Analyse des commodités autour de l\'adresse…</p>')}</div>
      ${section(`Portrait de ${muni.nom}`, `<div class="grid2">
        ${row('Population (2021)', num(c.pop2021))}
        ${row('Croissance 2016-2021', signedPct(c.croissancePop))}
        ${row('Revenu médian des ménages (2020)', money(c.revenuMenage))}
        ${row('Propriétaires', pct(c.pctProprio, 0))}
        ${row('Âge moyen', num1(c.ageMoyen))}
        ${row('65 ans et plus', pct(c.pct65, 0))}
        ${row('Ont déménagé en 1 an', pct(c.pctDemenage1an, 0))}
        ${row('Densité', c.densite ? `${num(c.densite)} hab./km²` : '—')}
      </div>`, { note: 'Source : Statistique Canada, Recensement de 2021.' })}
      <div id="s-env"></div>
      ${newsHtml(muni)}`;
    const osm = await environs(unit.lat, unit.lon);
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

export function prosConsHtml(pcs) {
  if (!pcs.length) return '<p class="empty">Aucun élément marquant.</p>';
  const cls = { '+': 'pro', '−': 'con', '±': 'mix' };
  return `<ul class="pc">${pcs.map((p) => `<li class="${cls[p.signe]}"><b>${p.signe}</b><span>${esc(p.texte)}${p.pour !== 'tous' ? ` <em>(${p.pour})</em>` : ''}</span></li>`).join('')}</ul>`;
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
      <div>${row('Valeur au rôle', money(unit.vr))}${row('Année', unit.an || '—')}${row('Aire habitable', unit.aire ? `${num(unit.aire)} m²` : '—')}
      ${row('Terrain', unit.ter ? `${num(unit.ter)} m²` : '—')}${row('Logements', unit.lg || '—')}${pc != null ? row('Centile local', `${pc}e`) : ''}</div></div>
    <h2>Comparables</h2><table><tr><th>Adresse</th><th>Distance</th><th>Aire</th><th>Estimation</th></tr>
      ${comps.map((c) => `<tr><td>${esc(c.adr)}</td><td>${dist(c.d)}</td><td>${c.aire ? `${num(c.aire)} m²` : '—'}</td><td>${money(c.est)}</td></tr>`).join('')}</table>
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
