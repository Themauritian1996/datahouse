// Petits utilitaires d'interface partagés.
import { esc } from './format.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

let toastTimer;
export function toast(msg, ton = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast show ${ton}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3800);
}

export const kpi = (label, valeur, sous = '', ton = '') => `
  <div class="kpi ${ton}"><div class="kpi-l">${esc(label)}</div><div class="kpi-v">${valeur}</div>${sous ? `<div class="kpi-s">${sous}</div>` : ''}</div>`;

export const row = (label, valeur, ton = '') => `<div class="row ${ton}"><span>${esc(label)}</span><b>${valeur}</b></div>`;

export const section = (titre, corps, { id = '', note = '' } = {}) => `
  <section class="card" ${id ? `id="${id}"` : ''}>
    <h3>${esc(titre)}</h3>${corps}${note ? `<p class="note">${note}</p>` : ''}
  </section>`;

/** Champ numérique de calculateur. */
export const field = (id, label, value, { step = 'any', suffix = '', min = 0 } = {}) => `
  <label class="field"><span>${esc(label)}</span>
    <div class="input-wrap"><input type="number" inputmode="decimal" id="${id}" value="${value ?? ''}" step="${step}" min="${min}">${suffix ? `<i>${suffix}</i>` : ''}</div>
  </label>`;

export const val = (id, root = document) => {
  const v = parseFloat(String($(`#${id}`, root)?.value).replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};

export const icon = (name) => {
  const p = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    print: '<path d="M7 9V3h10v6M7 18H4v-7h16v7h-3M7 14h10v7H7z"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  }[name] || '';
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
};
