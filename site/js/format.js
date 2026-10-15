// Mise en forme (français canadien).
const nf0 = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const money0 = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });

export const num = (x) => (x == null || Number.isNaN(x) ? '—' : nf0.format(x));
export const num1 = (x) => (x == null || Number.isNaN(x) ? '—' : nf1.format(x));
export const money = (x) => (x == null || Number.isNaN(x) ? '—' : money0.format(x));
export const pct = (x, digits = 1) => (x == null || Number.isNaN(x)
  ? '—'
  : `${new Intl.NumberFormat('fr-CA', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(x)} %`);
export const signedPct = (x, digits = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${pct(x, digits)}`);

/** Montant compact : 725 k$, 1,25 M$. */
export function kmoney(x) {
  if (x == null || Number.isNaN(x)) return '—';
  if (Math.abs(x) >= 1e6) return `${new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2 }).format(x / 1e6)} M$`;
  if (Math.abs(x) >= 1e3) return `${nf0.format(x / 1e3)} k$`;
  return `${nf0.format(x)} $`;
}

export function dist(m) {
  if (m == null) return '—';
  return m < 1000 ? `${nf0.format(Math.round(m / 10) * 10)} m` : `${nf1.format(m / 1000)} km`;
}

export function date(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString('fr-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/** Normalise pour la recherche (minuscules, sans accents). */
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
