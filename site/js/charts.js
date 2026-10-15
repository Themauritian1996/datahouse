// Petits graphiques SVG sans dépendance.
import { kmoney } from './format.js';

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
