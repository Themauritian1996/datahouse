// Chargement des données statiques (méta, municipalités, tuiles) et géocodage.
import { decodeUnit, distance } from './engine.js';
import { fold } from './format.js';
import { CONFIG } from './config.js';

const BASE = CONFIG.dataUrl.replace(/\/$/, '');
const V = (window.PIGNON_VERSION || 'dev');
const jsonCache = new Map();
const muniCache = new Map();
const tileCache = new Map();
const unitById = new Map();

async function getJSON(path) {
  if (jsonCache.has(path)) return jsonCache.get(path);
  const p = fetch(`${BASE}/${path}?v=${V}`).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${path}`);
    return r.json();
  });
  jsonCache.set(path, p);
  p.catch(() => jsonCache.delete(path));
  return p;
}

export const loadMeta = () => getJSON('meta.json');
export const loadIndex = () => getJSON('municipalites.json');
export const loadBoundaries = () => getJSON('munis.geojson');

export async function loadMuni(code) {
  if (!muniCache.has(code)) {
    muniCache.set(code, getJSON(`muni/${code}.json`).catch((e) => { muniCache.delete(code); throw e; }));
  }
  return muniCache.get(code);
}

/** Municipalités déjà chargées (pour les calculs synchrones). */
export const munisLoaded = {};

const cellKey = (la, lo) => `${la}_${lo}`;

export async function loadCell(la, lo) {
  const key = cellKey(la, lo);
  if (tileCache.has(key)) return tileCache.get(key);
  const p = getJSON(`tuiles/${la}/${key}.json`)
    .then(async (t) => {
      const units = t.u.map((r) => decodeUnit(r, t.m));
      await Promise.all(t.m.map(async (c) => { munisLoaded[c] = await loadMuni(c).catch(() => null); }));
      for (const u of units) unitById.set(u.id, u);
      return units;
    })
    .catch(() => []);
  tileCache.set(key, p);
  return p;
}

/** Unités dans une boîte (limite de cellules pour garder la carte fluide). */
export async function unitsInBox(w, s, e, n, maxCells = 36) {
  const la0 = Math.floor(s * 100); const la1 = Math.floor(n * 100);
  const lo0 = Math.floor(w * 100); const lo1 = Math.floor(e * 100);
  const cells = [];
  for (let la = la0; la <= la1; la++) for (let lo = lo0; lo <= lo1; lo++) cells.push([la, lo]);
  if (cells.length > maxCells) return null;
  const parts = await Promise.all(cells.map(([la, lo]) => loadCell(la, lo)));
  return parts.flat();
}

/** Unités autour d'un point (cellule + voisines). */
export async function unitsAround(lat, lon, ring = 1) {
  const la = Math.floor(lat * 100); const lo = Math.floor(lon * 100);
  const cells = [];
  for (let a = -ring; a <= ring; a++) for (let b = -ring; b <= ring; b++) cells.push(loadCell(la + a, lo + b));
  return (await Promise.all(cells)).flat();
}

export const getUnit = (id) => unitById.get(id);

/** Recherche locale de municipalités. */
export async function searchMunis(q, limit = 5) {
  const idx = await loadIndex();
  const f = fold(q).trim();
  if (f.length < 2) return [];
  const starts = []; const contains = [];
  for (const m of idx) {
    const n = fold(m.n);
    if (n.startsWith(f)) starts.push(m);
    else if (n.includes(f)) contains.push(m);
  }
  const byPop = (a, b) => (b.p || 0) - (a.p || 0);
  return [...starts.sort(byPop), ...contains.sort(byPop)].slice(0, limit);
}

/** Géocodage d'adresses (Photon / OpenStreetMap), limité au Québec. */
export async function geocode(q, signal) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=fr&limit=6&bbox=-79.8,44.9,-57.1,62.6`;
  try {
    const r = await fetch(url, { signal });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    return j.features
      .filter((f) => !f.properties.state || /qu[ée]bec/i.test(f.properties.state))
      .map((f) => {
        const p = f.properties;
        const ligne1 = [p.housenumber, p.street || p.name].filter(Boolean).join(' ');
        const ligne2 = [p.city || p.town || p.village || p.county, p.postcode].filter(Boolean).join(', ');
        return { lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], ligne1, ligne2,
          numero: p.housenumber, rue: p.street || p.name };
      });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return [];
  }
}

/** Trouve l'unité d'évaluation correspondant le mieux à une adresse géocodée. */
export function matchAddress(units, hit) {
  if (!units.length) return null;
  const no = hit.numero ? parseInt(hit.numero, 10) : null;
  const rue = fold(hit.rue || '').replace(/\b(rue|avenue|boulevard|chemin|rang|route|de|du|des|la|le|l)\b/g, '').trim();
  let best = null; let bestScore = -Infinity;
  for (const u of units) {
    const d = distance(hit, u);
    if (d > 400) continue;
    let score = -d / 40;
    const adr = fold(u.adr);
    const m = adr.match(/^(\d+)(?:\D*-(\d+))?/);
    if (no && m) {
      const a = parseInt(m[1], 10); const b = m[2] ? parseInt(m[2], 10) : a;
      if (no >= Math.min(a, b) && no <= Math.max(a, b)) score += 12;
    }
    if (rue && rue.split(' ').filter((w) => w.length > 2).every((w) => adr.includes(w))) score += 6;
    if (score > bestScore) { bestScore = score; best = u; }
  }
  return bestScore > -3 ? best : null;
}
