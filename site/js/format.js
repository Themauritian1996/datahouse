// Mise en forme (français ou anglais canadien) et unités de superficie.
import { unites } from './prefs.js';

export const PI2_PAR_M2 = 10.7639;

/** Fonctions de mise en forme pour une langue donnée ('fr' ou 'en'). */
export function fmt(lang = 'fr') {
  const loc = lang === 'en' ? 'en-CA' : 'fr-CA';
  const nf0 = new Intl.NumberFormat(loc, { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat(loc, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const money0 = new Intl.NumberFormat(loc, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  const nil = (x) => x == null || Number.isNaN(x);
  const sp = lang === 'en' ? '' : ' ';
  const pct = (x, digits = 1) => (nil(x) ? '—'
    : `${new Intl.NumberFormat(loc, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(x)}${sp}%`);
  const f = {
    lang,
    num: (x) => (nil(x) ? '—' : nf0.format(x)),
    num1: (x) => (nil(x) ? '—' : nf1.format(x)),
    dec: (x, d = 2) => (nil(x) ? '—' : new Intl.NumberFormat(loc, { minimumFractionDigits: d, maximumFractionDigits: d }).format(x)),
    money: (x) => (nil(x) ? '—' : money0.format(x)),
    pct,
    signedPct: (x, digits = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${pct(x, digits)}`),
    kmoney(x) {
      if (nil(x)) return '—';
      if (lang === 'en') {
        if (Math.abs(x) >= 1e6) return `$${new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }).format(x / 1e6)}M`;
        if (Math.abs(x) >= 1e3) return `$${nf0.format(x / 1e3)}k`;
        return `$${nf0.format(x)}`;
      }
      if (Math.abs(x) >= 1e6) return `${new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }).format(x / 1e6)} M$`;
      if (Math.abs(x) >= 1e3) return `${nf0.format(x / 1e3)} k$`;
      return `${nf0.format(x)} $`;
    },
    dist(m) {
      if (m == null) return '—';
      return m < 1000 ? `${nf0.format(Math.round(m / 10) * 10)} m` : `${nf1.format(m / 1000)} km`;
    },
    date(iso) {
      if (!iso) return '—';
      const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
      return d.toLocaleDateString(loc, { year: 'numeric', month: 'long', day: 'numeric' });
    },
    /** Superficie dans l'unité choisie (la donnée source est toujours en m²). */
    aire(m2, u = unites()) {
      if (nil(m2) || !m2) return '—';
      return u === 'pi2' ? `${nf0.format(m2 * PI2_PAR_M2)} ${lang === 'en' ? 'sq ft' : 'pi²'}` : `${nf0.format(m2)} m²`;
    },
    /** Montant par unité de superficie (la donnée source est en $/m²). */
    parAire(parM2, u = unites()) {
      if (nil(parM2) || !parM2) return '—';
      const v = u === 'pi2' ? parM2 / PI2_PAR_M2 : parM2;
      return `${money0.format(v)}${lang === 'en' ? (u === 'pi2' ? '/sq ft' : '/m²') : (u === 'pi2' ? ' / pi²' : ' / m²')}`;
    },
    uniteLabel: (u = unites()) => (u === 'pi2' ? (lang === 'en' ? 'sq ft' : 'pi²') : 'm²'),
  };
  return f;
}

const FR = fmt('fr');
export const { num, num1, money, pct, signedPct, kmoney, dist, date, aire, parAire, uniteLabel } = FR;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/** Normalise pour la recherche (minuscules, sans accents). */
export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
