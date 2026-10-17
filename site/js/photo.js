// Photos d'une propriété : vue aérienne (imagerie du gouvernement du Québec, licence ouverte)
// et, si une clé est configurée, photo de la façade (Google Street View).
import { CONFIG } from './config.js';

export const ORTHO_TUILES = 'https://servicesmatriciels.mern.gouv.qc.ca/erdas-iws/ogc/wmts/Imagerie_Continue/Imagerie_GQ/default/GoogleMapsCompatibleExt2:epsg:3857/{z}/{y}/{x}.jpg';
export const ORTHO_CREDIT = 'Imagerie : Gouvernement du Québec (CC-BY 4.0)';

const cache = new Map();

function tuile(z, x, y) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = ORTHO_TUILES.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  });
}

const px = (lat, lon, z) => {
  const n = 256 * 2 ** z;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
};

/**
 * Vue aérienne centrée sur la propriété, avec un repère. Renvoie une image JPEG (data URL),
 * utilisable à l'écran comme dans le PDF. Rejette la promesse si l'imagerie est indisponible.
 */
export async function vueAerienne(lat, lon, { w = 640, h = 400, z = 19 } = {}) {
  const key = `${lat.toFixed(5)},${lon.toFixed(5)},${w}x${h}`;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    for (const zoom of [z, z - 1, z - 2]) {
      try {
        return await composer(lat, lon, w, h, zoom);
      } catch { /* niveau de zoom suivant */ }
    }
    throw new Error('imagerie indisponible');
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

async function composer(lat, lon, w, h, z) {
  const [cx, cy] = px(lat, lon, z);
  const x0 = cx - w / 2; const y0 = cy - h / 2;
  const tx0 = Math.floor(x0 / 256); const tx1 = Math.floor((x0 + w) / 256);
  const ty0 = Math.floor(y0 / 256); const ty1 = Math.floor((y0 + h) / 256);
  const jobs = [];
  for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) jobs.push(tuile(z, tx, ty).then((img) => ({ img, tx, ty })));
  const tiles = await Promise.all(jobs);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  for (const { img, tx, ty } of tiles) g.drawImage(img, Math.round(tx * 256 - x0), Math.round(ty * 256 - y0));
  // Une tuile vide (hors couverture) est uniforme : on la refuse.
  const d = g.getImageData(Math.floor(w / 2) - 20, Math.floor(h / 2) - 20, 40, 40).data;
  let min = 255; let max = 0;
  for (let i = 0; i < d.length; i += 4) { min = Math.min(min, d[i]); max = Math.max(max, d[i]); }
  if (max - min < 6) throw new Error('tuile vide');
  // Repère de la propriété
  g.lineWidth = 3;
  g.strokeStyle = '#ffffff';
  g.fillStyle = 'rgba(30,122,79,.35)';
  g.beginPath(); g.arc(w / 2, h / 2, 16, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(w / 2, h / 2, 3.5, 0, Math.PI * 2); g.fill();
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.86), w, h, zoom: z };
}

/** Lien vers la vue de la rue dans Google Maps (aucune clé requise). */
export const lienFacade = (lat, lon) => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;

/** Photo de la façade (Google Street View Static) si une clé est configurée ; sinon null. */
export async function photoFacade(lat, lon, { w = 640, h = 400 } = {}) {
  const k = CONFIG.streetViewKey;
  if (!k) return null;
  const q = `location=${lat},${lon}&source=outdoor&radius=40&key=${encodeURIComponent(k)}`;
  try {
    const meta = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${q}`).then((r) => r.json());
    if (meta.status !== 'OK') return null;
    return { url: `https://maps.googleapis.com/maps/api/streetview?size=${w}x${h}&fov=75&${q}`, date: meta.date || null };
  } catch {
    return null;
  }
}

/** Convertit une image distante en data URL (pour le PDF) ; null si le site ne le permet pas. */
export async function enDataUrl(url) {
  try {
    const blob = await fetch(url).then((r) => (r.ok ? r.blob() : Promise.reject()));
    return await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
