// Carte interactive (MapLibre GL) : choroplèthe des municipalités et unités d'évaluation.
import { loadBoundaries, unitsInBox, munisLoaded } from './data.js';
import { kmoney } from './format.js';
import { ORTHO_TUILES, ORTHO_CREDIT } from './photo.js';

/* global maplibregl */
const STYLES = {
  clair: 'https://tiles.openfreemap.org/styles/positron',
  sombre: 'https://tiles.openfreemap.org/styles/dark',
};
const BLANK = (bg) => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }] });
const UNIT_ZOOM = 14.5;

export const METRICS = {
  v: { label: 'Prix médian estimé (unifamiliale)', stops: [350000, 500000, 650000, 850000, 1100000], fmt: kmoney, type: 'seq' },
  g: { label: 'Tendance annuelle des valeurs', stops: [0, 2, 4, 6, 8], fmt: (x) => `${x} %`, type: 'div' },
  y: { label: 'Rendement brut des plex', stops: [3.5, 4.5, 5.5, 6.5, 7.5], fmt: (x) => `${x} %`, type: 'seq' },
  l: { label: 'Facilité de revente', stops: [35, 45, 55, 65, 75], fmt: (x) => `${x}`, type: 'div' },
};

const dark = () => document.documentElement.dataset.theme === 'dark'
  || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);

function ramp(type) {
  if (type === 'div') return dark()
    ? ['#c2413b', '#7a4a3c', '#3d4a3f', '#2f6b47', '#2f9a5c', '#3fd17a']
    : ['#d64541', '#eba49a', '#e7ece8', '#a8dcb9', '#4fb978', '#14864a'];
  return dark()
    ? ['#1d2a22', '#24402f', '#2b5a3c', '#2f7a4c', '#34a05f', '#4cd47f']
    : ['#eef6f0', '#c9e8d3', '#93d0a8', '#55b37b', '#23894f', '#0d5c31'];
}

export function legend(metric) {
  const m = METRICS[metric];
  const r = ramp(m.type);
  const labels = [`< ${m.fmt(m.stops[0])}`, ...m.stops.slice(0, -1).map((s, i) => `${m.fmt(s)} – ${m.fmt(m.stops[i + 1])}`), `≥ ${m.fmt(m.stops.at(-1))}`];
  return { titre: m.label, items: r.map((c, i) => ({ c, t: labels[i] })) };
}

function stepExpr(prop, stops, colors) {
  const e = ['step', ['to-number', ['get', prop], -1e9], colors[0]];
  stops.forEach((s, i) => e.push(s, colors[i + 1]));
  return ['case', ['==', ['get', prop], null], dark() ? '#2a2a2a' : '#e9e9e9', e];
}

export class Carte {
  constructor(el, handlers) {
    this.handlers = handlers;
    this.metric = 'v';
    this.selectedId = null;
    this.unitFeatures = [];
    this.map = new maplibregl.Map({
      container: el,
      style: BLANK(dark() ? '#121212' : '#f4f4f2'),
      center: [-72.4, 46.4], zoom: 5.3, minZoom: 4, maxZoom: 19, attributionControl: false,
      maxBounds: [[-82, 43], [-55, 64]],
    });
    this.map.addControl(new maplibregl.AttributionControl({ compact: true,
      customAttribution: 'Données : MAMH, Statistique Canada (CC-BY / Licence ouverte)' }));
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    this.map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), 'bottom-right');
    this.map.on('load', () => this.applyBase());
    // L'attribution reste repliée (icône ⓘ) pour ne pas masquer la carte sur téléphone.
    this.map.once('idle', () => this.map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
    this.map.on('style.load', () => this.addLayers());
    this.map.on('moveend', () => this.refreshUnits());
    this.map.on('click', (e) => this.onClick(e));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyBase());
  }

  async applyBase() {
    const url = dark() ? STYLES.sombre : STYLES.clair;
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (!r.ok) throw new Error(r.status);
      this.map.setStyle(url, { diff: false });
    } catch {
      this.map.setStyle(BLANK(dark() ? '#121212' : '#f4f4f2'), { diff: false });
    }
  }

  async addLayers() {
    const map = this.map;
    if (map.getSource('munis')) return;
    const geo = await loadBoundaries();
    if (map.getSource('munis')) return;
    const style = map.getStyle();
    if (!style?.layers) return; // un changement de style est en cours : style.load sera relancé
    const firstSymbol = style.layers.find((l) => l.type === 'symbol')?.id;
    map.addSource('ortho', { type: 'raster', tiles: [ORTHO_TUILES], tileSize: 256, maxzoom: 19, attribution: ORTHO_CREDIT });
    map.addLayer({ id: 'ortho', type: 'raster', source: 'ortho', layout: { visibility: this.satellite ? 'visible' : 'none' } }, firstSymbol);
    map.addSource('munis', { type: 'geojson', data: geo, promoteId: 'code' });
    map.addLayer({ id: 'munis-fill', type: 'fill', source: 'munis', maxzoom: UNIT_ZOOM + 0.5,
      paint: { 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.72, UNIT_ZOOM, 0.12] } }, firstSymbol);
    map.addLayer({ id: 'munis-line', type: 'line', source: 'munis',
      paint: { 'line-color': dark() ? '#5a5a5a' : '#9a9a9a', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.3, 12, 1.2] } }, firstSymbol);
    map.addLayer({ id: 'munis-hover', type: 'line', source: 'munis',
      paint: { 'line-color': dark() ? '#ffffff' : '#000000', 'line-width': 2,
        'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0] } }, firstSymbol);
    map.addSource('units', { type: 'geojson', data: { type: 'FeatureCollection', features: this.unitFeatures } });
    map.addLayer({ id: 'units', type: 'circle', source: 'units', minzoom: UNIT_ZOOM - 0.5,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, ['case', ['>', ['get', 'n'], 1], 5, 3], 18,
          ['case', ['>', ['get', 'n'], 1], 12, 8]],
        'circle-stroke-width': ['case', ['boolean', ['get', 'sel'], false], 4, 1],
        'circle-stroke-color': ['case', ['boolean', ['get', 'sel'], false], dark() ? '#ffffff' : '#0b0b0b', dark() ? '#0b0b0b' : '#ffffff'],
      } });
    this.setMetric(this.metric);
    if (this.satellite) this.setSatellite(true);
    let hovered = null;
    map.on('mousemove', 'munis-fill', (e) => {
      if (hovered !== null) map.setFeatureState({ source: 'munis', id: hovered }, { hover: false });
      hovered = e.features[0]?.id ?? null;
      if (hovered !== null) map.setFeatureState({ source: 'munis', id: hovered }, { hover: true });
    });
    map.on('mouseleave', 'munis-fill', () => {
      if (hovered !== null) map.setFeatureState({ source: 'munis', id: hovered }, { hover: false });
      hovered = null;
    });
    map.on('mouseenter', 'units', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'units', () => { map.getCanvas().style.cursor = ''; });
    this.handlers.onReady?.();
    this.refreshUnits();
  }

  /** Affiche ou masque la vue satellite (orthophotos du Québec). */
  setSatellite(on) {
    this.satellite = on;
    if (this.map.getLayer('ortho')) this.map.setLayoutProperty('ortho', 'visibility', on ? 'visible' : 'none');
    if (this.map.getLayer('munis-fill')) this.map.setPaintProperty('munis-fill', 'fill-opacity', on
      ? ['interpolate', ['linear'], ['zoom'], 9, 0.45, UNIT_ZOOM, 0] : ['interpolate', ['linear'], ['zoom'], 9, 0.72, UNIT_ZOOM, 0.12]);
  }

  setMetric(metric) {
    this.metric = metric;
    const m = METRICS[metric];
    const colors = ramp(m.type);
    if (this.map.getLayer('munis-fill')) this.map.setPaintProperty('munis-fill', 'fill-color', stepExpr(metric, m.stops, colors));
    const u = METRICS.v;
    if (this.map.getLayer('units')) this.map.setPaintProperty('units', 'circle-color', stepExpr('est', u.stops, ramp('seq')));
  }

  async refreshUnits() {
    const map = this.map;
    if (!map.getSource('units')) return;
    if (map.getZoom() < UNIT_ZOOM - 0.5) {
      this.handlers.onUnitsState?.('zoom');
      return;
    }
    const b = map.getBounds();
    this.handlers.onUnitsState?.('chargement');
    const units = await unitsInBox(b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
    if (!units) { this.handlers.onUnitsState?.('zoom'); return; }
    const groups = new Map();
    for (const u of units) {
      const k = `${u.lon},${u.lat}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(u);
    }
    this.unitFeatures = [...groups.values()].map((g) => {
      const adj = munisLoaded[g[0].muni]?.marche?.adj || 1;
      const ests = g.map((u) => u.vr * adj);
      return {
        type: 'Feature', geometry: { type: 'Point', coordinates: [g[0].lon, g[0].lat] },
        properties: { id: g[0].id, n: g.length, est: Math.round(ests.reduce((a, b) => a + b, 0) / g.length),
          sel: g.some((u) => u.id === this.selectedId), ids: g.map((u) => u.id).join('|') },
      };
    });
    map.getSource('units').setData({ type: 'FeatureCollection', features: this.unitFeatures });
    this.handlers.onUnitsState?.(units.length ? 'ok' : 'vide');
  }

  select(id) {
    this.selectedId = id;
    if (!this.map.getSource('units')) return;
    for (const f of this.unitFeatures) f.properties.sel = f.properties.ids.split('|').includes(id);
    this.map.getSource('units').setData({ type: 'FeatureCollection', features: this.unitFeatures });
  }

  onClick(e) {
    const u = this.map.queryRenderedFeatures(e.point, { layers: ['units'] });
    if (u.length) {
      this.handlers.onUnitClick?.(u[0].properties.ids.split('|'), u[0].geometry.coordinates);
      return;
    }
    const m = this.map.queryRenderedFeatures(e.point, { layers: ['munis-fill'] });
    if (m.length) this.handlers.onMuniClick?.(m[0].properties.code);
  }

  /** Marge pour que le point reste visible à côté du panneau ouvert. */
  sheetPadding() {
    const mobile = innerWidth < 900;
    return mobile ? { top: 40, bottom: Math.round(innerHeight * 0.52), left: 0, right: 0 }
      : { top: 0, bottom: 0, left: 0, right: 460 };
  }

  flyTo(lon, lat, zoom = 17) {
    this.map.flyTo({ center: [lon, lat], zoom, speed: 1.6, padding: this.sheetPadding() });
  }

  resetPadding() { this.map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 300 }); }

  fitMuni(code, centre) {
    const src = this.map.getSource('munis');
    const f = src?._data?.features?.find((x) => x.properties.code === code);
    if (f) {
      const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates.flat() : f.geometry.coordinates.flat(2);
      const xs = coords.map((c) => c[0]); const ys = coords.map((c) => c[1]);
      this.map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]],
        { padding: { top: 60, left: 30, right: innerWidth < 900 ? 30 : 490, bottom: innerWidth < 900 ? innerHeight * 0.52 : 30 },
          maxZoom: 13, duration: 900 });
    } else if (centre) this.flyTo(centre[0], centre[1], 12);
  }

  resize() { this.map.resize(); }
}
