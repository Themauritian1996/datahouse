// Préférences de l'utilisateur : unités de superficie et langue des rapports.
// Conservées dans ce navigateur, et dans le profil quand l'utilisateur est connecté.
const KEY = 'datahouse:prefs';
const DEFAUTS = { unites: 'm2', langueRapport: 'fr' };
const listeners = new Set();

let prefs = { ...DEFAUTS };
try { prefs = { ...DEFAUTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* stockage indisponible */ }

export const getPrefs = () => ({ ...prefs });
export const unites = () => prefs.unites;
export const langueRapport = () => prefs.langueRapport;

export function setPrefs(patch, { silencieux = false } = {}) {
  const avant = JSON.stringify(prefs);
  prefs = { ...prefs, ...Object.fromEntries(Object.entries(patch).filter(([k, v]) => k in DEFAUTS && v)) };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* stockage indisponible */ }
  if (!silencieux && JSON.stringify(prefs) !== avant) listeners.forEach((cb) => cb(getPrefs()));
}

export const onPrefs = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
