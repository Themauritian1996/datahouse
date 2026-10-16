// Fiche d'une municipalité : marché, loyers, démographie, revente et nouvelles.
import { loadMuni } from './data.js';
import { prosCons } from './analysis.js';
import { histogram, gauge, meter } from './charts.js';
import { money, kmoney, pct, signedPct, num, num1, esc, date } from './format.js';
import { kpi, row, section, $$ } from './ui.js';
import { TYPE_ORDER } from './engine.js';
import { prosConsHtml, newsHtml } from './views-unit.js';

export async function renderMuni(ctx, code) {
  let muni;
  try {
    muni = await loadMuni(code);
  } catch {
    ctx.sheet.open('<div class="empty">Aucune donnée pour cette municipalité.</div>');
    return;
  }
  const meta = ctx.meta;
  ctx.carte.fitMuni(code, muni.centre);
  const m = muni.marche;
  const types = TYPE_ORDER.filter((t) => muni.types?.[t]?.n);
  const main = muni.types?.U || muni.types?.C || muni.types?.[types[0]];
  const c = muni.recensement || {};
  const liq = muni.liquidite || {};
  const labels = { tailleMarche: 'Taille du marché', croissanceDemo: 'Croissance démographique', tendancePrix: 'Tendance des prix',
    mobilite: 'Mobilité résidentielle', abordabilite: 'Abordabilité' };

  ctx.sheet.open(`
    <div class="sh-head">
      <div class="eyebrow">${esc([...new Set([muni.mrc, muni.region].filter((x) => x && x !== muni.nom))].join(' · ') || 'Municipalité')}</div>
      <h2>${esc(muni.nom)}</h2>
    </div>
    <div class="kpis">
      ${kpi('Unifamiliale médiane', kmoney(muni.types?.U?.medEst), 'valeur estimée')}
      ${kpi('Tendance', `${signedPct(m.g * 100)}`, 'par an', m.g >= 0 ? 'up' : 'down')}
      ${kpi('Loyer médian', muni.loyer?.estime ? money(muni.loyer.estime) : '—', 'estimé, en place')}
    </div>
    <div class="type-chips">${types.map((t, i) => `<button class="chip${i ? '' : ' on'}" data-t="${t}">${esc(meta.typeLabels[t])}</button>`).join('')}</div>
    <div id="type-panel"></div>
    ${section('Marché locatif', `
      ${row('Loyer médian en place (estimé)', money(muni.loyer?.estime))}
      ${muni.loyer?.affiche2ch ? row(`Loyer affiché moyen, 2 chambres (${esc(muni.loyer.periodeAffiche || '')})`, money(muni.loyer.affiche2ch)) : ''}
      ${row('Rendement brut médian des plex', muni.rendementPlex ? pct(muni.rendementPlex) : '—')}
      ${row('Locataires', c.pctProprio != null ? pct(100 - c.pctProprio, 0) : '—')}`,
    { note: muni.loyer?.source === 'affiche' ? 'Loyer de référence : loyer affiché moyen d\'un 2 chambres de la région métropolitaine (nouveaux baux), réduit de 10 %. Les loyers en place sont souvent plus bas.' : 'Loyer en place : médiane du recensement 2021 indexée selon l\'IPC des loyers du Québec. Loyer affiché : nouveaux baux, région métropolitaine.' })}
    ${section('Facilité de revente', `
      <div class="gauge-wrap">${gauge(liq.score, { label: 'Facilité de revente' })}<p class="lead">Indice expérimental (0 à 100) : taille et dynamisme du marché, mobilité et abordabilité.</p></div>
      ${Object.entries(labels).map(([k, l]) => `<div class="mrow"><span>${l}</span>${meter(liq.composantes?.[k])}</div>`).join('')}`)}
    ${section('Avantages et inconvénients', prosConsHtml(prosCons({ muni, meta })))}
    ${section('Démographie (recensement 2021)', `<div class="grid2">
      ${row('Population', num(c.pop2021))}
      ${row('Croissance 2016-2021', signedPct(c.croissancePop))}
      ${row('Revenu médian des ménages', money(c.revenuMenage))}
      ${row('Propriétaires', pct(c.pctProprio, 0))}
      ${row('Âge moyen', num1(c.ageMoyen))}
      ${row('Ont déménagé en 1 an', pct(c.pctDemenage1an, 0))}
      ${row('Valeur déclarée médiane (2021)', money(c.valeurDeclaree2021))}
      ${row('Prix / revenu', muni.ratioPrixRevenu ? num1(muni.ratioPrixRevenu) : '—')}
    </div>`)}
    ${newsHtml(muni)}
    ${section('Méthode', `
      ${row('Rôle d\'évaluation en vigueur', muni.role.annee || '—')}
      ${row('Date de référence du marché', date(muni.role.dateRef))}
      ${row(`Facteur comparatif MAMH ${m.fcAnnee || ''}`, m.fc ? m.fc.toFixed(2).replace('.', ',') : 'non publié')}
      ${row('Tendance retenue', `${signedPct(m.g * 100)} / an`)}
      ${row('Unités résidentielles analysées', num(muni.role.nbUnites))}`,
    { note: `Tendance : ${esc(m.gSource || '')}. <a href="#/methodo">Voir la méthodologie complète</a>.` })}
    <p class="hint">Zoomez sur la carte pour voir chaque propriété, ou cherchez une adresse.</p>`);

  const panel = ctx.sheet.body.querySelector('#type-panel');
  const showType = (t) => {
    const s = muni.types[t];
    $$('.chip', ctx.sheet.body).forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    panel.innerHTML = section(`${meta.typeLabels[t]} · ${num(s.n)} propriétés`, `
      ${histogram(s.hist, s.medEst, { label: 'médiane' })}
      <div class="grid2">
        ${row('Valeur médiane estimée', money(s.medEst))}
        ${row('Moitié centrale', `${kmoney(s.p25)} à ${kmoney(s.p75)}`)}
        ${row('Prix médian au m²', s.medM2 ? `${num(s.medM2)} $` : '—')}
        ${row('Aire médiane', s.medAire ? `${num(s.medAire)} m²` : '—')}
        ${row('Année médiane', s.medAnnee || '—')}
        ${row('Hausse rôle antérieur → actuel', s.croissance3ans != null ? signedPct(s.croissance3ans * 100) : '—')}
      </div>`);
  };
  $$('.chip', ctx.sheet.body).forEach((b) => b.addEventListener('click', () => showType(b.dataset.t)));
  if (main) showType(types.find((t) => muni.types[t] === main) || types[0]);
}
