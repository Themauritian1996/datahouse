// Petits graphiques SVG sans dépendance.
import { kmoney, money, esc } from './format.js';
import { icon } from './ui.js';

/** Histogramme de distribution avec repère de la propriété. */
export function histogram(hist, marker, { label = 'Cette propriété' } = {}) {
  if (!hist) return '';
  const W = 320; const H = 96; const pad = 4; const n = hist.n.length;
  const max = Math.max(...hist.n, 1);
  const bw = (W - pad * 2) / n;
  const bars = hist.n.map((v, i) => {
    const h = Math.max(1, (v / max) * (H - 30));
    return `<rect x="${pad + i * bw + 1}" y="${H - 18 - h}" width="${bw - 2}" height="${h}" rx="2" class="hbar"/>`;
  }).join('');
  let mk = '';
  if (marker != null) {
    const x = pad + Math.max(0, Math.min(1, (marker - hist.min) / (hist.max - hist.min))) * (W - pad * 2);
    mk = `<line x1="${x}" x2="${x}" y1="6" y2="${H - 18}" class="hmark"/><circle cx="${x}" cy="6" r="4" class="hdot"/>`;
  }
  return `<svg class="hist" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribution des valeurs estimées; ${label}">
    ${bars}${mk}
    <text x="${pad}" y="${H - 3}" class="htick">${kmoney(hist.min)}</text>
    <text x="${W - pad}" y="${H - 3}" class="htick" text-anchor="end">${kmoney(hist.max)}</text>
  </svg>`;
}

/** Jauge semi-circulaire 0-100. */
export function gauge(score, { label = '' } = {}) {
  if (score == null) return '';
  const r = 52; const cx = 64; const cy = 60;
  const a = Math.PI * (1 - score / 100);
  const x = cx + r * Math.cos(a); const y = cy - r * Math.sin(a);
  const large = 0;
  const tone = score >= 55 ? 'good' : score < 35 ? 'bad' : 'mid';
  return `<svg class="gauge ${tone}" viewBox="0 0 128 72" role="img" aria-label="${label} ${score} sur 100">
    <path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}" class="gtrack"/>
    <path d="M${cx - r},${cy} A${r},${r} 0 ${large} 1 ${x.toFixed(2)},${y.toFixed(2)}" class="gval"/>
    <text x="${cx}" y="${cy - 6}" text-anchor="middle" class="gnum">${score}</text>
  </svg>`;
}

/** Barre horizontale 0-100. */
export function meter(v) {
  if (v == null) return '<div class="meter na"><span style="width:0"></span></div>';
  const tone = v >= 55 ? 'good' : v < 35 ? 'bad' : 'mid';
  return `<div class="meter ${tone}"><span style="width:${Math.max(2, v)}%"></span></div>`;
}

/** Fourchette d'estimation : bas — valeur — haut. */
export function rangeBar(bas, valeur, haut) {
  const p = ((valeur - bas) / (haut - bas || 1)) * 100;
  return `<div class="range"><div class="range-track"><span class="range-dot" style="left:${p}%"></span></div>
    <div class="range-labels"><span>${kmoney(bas)}</span><span>${kmoney(haut)}</span></div></div>`;
}

const PAL = { favorable: 'Favorable', neutre: 'Neutre', defavorable: 'Défavorable', risque: 'Risque' };
const ICO = { favorable: 'up', neutre: 'neutral', defavorable: 'down', risque: 'down' };

/** Pastille de palier avec pouce. */
export const palierTag = (p, texte = PAL[p]) => (p ? `<span class="palier ${p}">${icon(ICO[p])}<span>${esc(texte)}</span></span>` : '');

/**
 * Zones de prix pour plusieurs profils sur une même échelle, avec repères (valeur estimée, prix analysé).
 * `rangees` : [{ label, zones: {favorable:[lo,hi], neutre:[lo,hi], defavorable:[lo,hi]} }]
 */
export function zonesBars(rangees, reperes, { fmtv = kmoney } = {}) {
  const bornes = [];
  for (const r of rangees) for (const k of ['favorable', 'neutre', 'defavorable', 'risque']) for (const b of r.zones[k] || []) if (b != null) bornes.push(b);
  for (const m of reperes) bornes.push(m.v);
  if (!bornes.length) return '';
  const lo0 = Math.min(...bornes); const hi0 = Math.max(...bornes);
  const span = hi0 - lo0 || hi0 * 0.2 || 1;
  const lo = lo0 - span * 0.18; const hi = hi0 + span * 0.18;
  const x = (v) => ((Math.min(hi, Math.max(lo, v ?? lo)) - lo) / (hi - lo)) * 100;
  const seg = (k, z) => {
    const a = x(z[0] ?? lo); const b = x(z[1] ?? hi);
    return b > a ? `<span class="zseg ${k}" style="left:${a}%;width:${b - a}%"></span>` : '';
  };
  const cles = (z) => ['favorable', 'neutre', 'defavorable', 'risque'].filter((k) => z[k]);
  const lignes = rangees.map((r) => `
    <div class="zrow"><span class="zlab">${esc(r.label)}</span>
      <div class="ztrack">${cles(r.zones).map((k) => seg(k, r.zones[k])).join('')}
        ${reperes.map((m) => `<span class="zmark ${m.cls || ''}" style="left:${x(m.v)}%"></span>`).join('')}</div>
      <span class="zcap">${r.cap ?? (r.zones.favorable[0] == null ? `${icon('up')} &lt; ${fmtv(r.zones.favorable[1])}` : `${icon('up')} ${r.zones.favorable[1] == null ? '&gt; ' : ''}${fmtv(r.zones.favorable[0])}${r.zones.favorable[1] != null ? `–${fmtv(r.zones.favorable[1])}` : ''}`)}</span>
    </div>`).join('');
  return `<div class="zones">${lignes}
    <div class="zlegend">${reperes.map((m) => `<span><i class="zmark-l ${m.cls || ''}"></i>${esc(m.label)} : <b>${fmtv(m.v)}</b></span>`).join('')}</div></div>`;
}

/** Cartes de score par profil (pouce + score + palier) avec le détail des facteurs. */
export function scoreCards(sc, labels, facteursLabels) {
  const cards = Object.entries(labels).map(([k, nom]) => {
    const s = sc[k];
    if (!s || s.score == null) return `<div class="scard na"><div class="sc-n">${esc(nom)}</div><div class="sc-v">—</div><small>Données insuffisantes</small></div>`;
    return `<details class="scard ${s.palier}"><summary>
        <div class="sc-n">${esc(nom)}</div>
        <div class="sc-row"><span class="sc-ico">${icon(ICO[s.palier])}</span><span class="sc-v">${s.score}</span><small>/100</small></div>
        <div class="sc-p">${PAL[s.palier]}</div></summary>
      <ul class="sc-f">${s.facteurs.map((f) => `<li><span>${esc(facteursLabels[f.k] || f.k)}</span>${meter(f.score)}</li>`).join('')}</ul>
    </details>`;
  }).join('');
  return `<div class="scards">${cards}</div>`;
}

