// Point d'entrée : coquille, routage, recherche et panneau latéral.
import { CONFIG } from './config.js';
import { loadMeta, searchMunis, geocode, unitsAround, matchAddress } from './data.js';
import { Carte, legend } from './map.js';
import { renderUnit, renderBuilding } from './views-unit.js';
import { renderMuni } from './views-muni.js';
import { pageCompte, pageFavoris, pageTarifs, pageMethodo, pageLegal } from './pages.js';
import * as auth from './auth.js';
import { $, $$, toast, icon } from './ui.js';
import { esc, kmoney } from './format.js';
import { renderHome } from './home.js';

const sheetEl = $('#sheet');
let navCount = 0; // navigations internes (pour un « retour » qui reste dans l'application)
const pageEl = $('#page');
const homeEl = $('#home');
let homeReady = false;

const sheet = {
  body: $('#sheet .sheet-body'),
  open(html) {
    this.body.innerHTML = html;
    this.body.scrollTop = 0;
    pageEl.hidden = true;
    sheetEl.hidden = false;
    sheetEl.classList.add('open');
    if (!sheetEl.classList.contains('full')) sheetEl.classList.add('half');
    document.body.classList.add('sheet-open');
  },
  loading() { this.open('<div class="skeleton"><div></div><div></div><div></div></div>'); },
  close() {
    sheetEl.classList.remove('open', 'half', 'full');
    document.body.classList.remove('sheet-open');
    setTimeout(() => { if (!sheetEl.classList.contains('open')) sheetEl.hidden = true; }, 250);
  },
};

const ctx = {
  meta: null,
  carte: null,
  sheet,
  navigate(hash) { if (location.hash === hash) route(); else location.hash = hash; },
  back() { if (navCount > 0) history.back(); else ctx.navigate('#/carte'); },
  page(html) {
    sheet.close();
    showHome(false);
    pageEl.innerHTML = `<button class="btn icon-btn page-close" aria-label="Fermer">${icon('close')}</button><div class="page-inner">${html}</div>`;
    pageEl.hidden = false;
    pageEl.scrollTop = 0;
    $('.page-close', pageEl).addEventListener('click', () => ctx.back());
  },
};

async function route() {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  try {
    if (!parts.length) {
      sheet.close(); pageEl.hidden = true; showHome(true);
      if (!homeReady) { homeReady = true; await renderHome(ctx, attachSearch).catch((e) => { homeReady = false; throw e; }); }
      return;
    }
    const [kind, arg] = parts;
    showHome(false);
    if (kind === 'carte') {
      sheet.close(); pageEl.hidden = true; ctx.carte.select(null); ctx.carte.resetPadding();
      const [lat, lon] = (params.get('ll') || '').split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lon)) ctx.carte.flyTo(lon, lat, 15.5);
      return;
    }
    if (kind === 'm') { sheet.loading(); await renderMuni(ctx, arg); return; }
    if (kind === 'u' || kind === 'b') {
      const [ids, ll] = decodeURIComponent(arg).split('@');
      const [lat, lon] = (ll || '').split(',').map(Number);
      const coords = Number.isFinite(lat) ? [lon, lat] : null;
      sheet.loading();
      if (coords) ctx.carte.flyTo(lon, lat, Math.max(17, ctx.carte.map.getZoom()));
      if (kind === 'b') await renderBuilding(ctx, ids.split('|'), coords);
      else await renderUnit(ctx, ids, coords);
      return;
    }
    const pages = { compte: pageCompte, favoris: pageFavoris, tarifs: pageTarifs, methodo: pageMethodo, legal: pageLegal };
    if (pages[kind]) { await pages[kind](ctx, params); return; }
    ctx.navigate('#/carte');
  } catch (e) {
    console.error(e);
    toast('Impossible de charger ces données pour le moment.', 'warn');
  }
}

// ---------- Accueil ----------
function showHome(on) {
  homeEl.hidden = !on;
  document.body.classList.toggle('on-home', on);
  if (!on) requestAnimationFrame(() => ctx.carte.resize());
}

// ---------- Recherche (barre du haut et accueil) ----------
function attachSearch(input, box, form = null) {
  let ctrl = null; let timer = null; let items = []; let active = -1;
  const close = () => { box.hidden = true; active = -1; };
  const render = () => {
    box.hidden = !items.length;
    box.innerHTML = items.map((it, i) => `<button class="res${i === active ? ' on' : ''}" data-i="${i}">
      ${icon(it.kind === 'muni' ? 'layers' : 'pin')}<span><b>${esc(it.l1)}</b><small>${esc(it.l2)}</small></span></button>`).join('');
    $$('.res', box).forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); choose(items[+b.dataset.i]); }));
  };
  async function choose(it) {
    close();
    input.blur();
    input.value = it.l1;
    if (it.kind === 'muni') { ctx.navigate(`#/m/${it.code}`); return; }
    showHome(false);
    ctx.carte.flyTo(it.lon, it.lat, 17.5);
    sheet.loading();
    const units = await unitsAround(it.lat, it.lon, 1);
    const u = matchAddress(units, it);
    if (u) ctx.navigate(`#/u/${encodeURIComponent(u.id)}@${u.lat},${u.lon}`);
    else {
      ctx.navigate('#/carte');
      toast('Aucune propriété résidentielle trouvée à cette adresse. Touchez un point sur la carte.');
    }
  }
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { items = []; render(); return; }
    timer = setTimeout(async () => {
      const munis = (await searchMunis(q, /\d/.test(q) ? 2 : 5)).map((m) => ({ kind: 'muni', code: m.c, l1: m.n,
        l2: [m.r, m.v ? `unifamiliale médiane ${kmoney(m.v)}` : ''].filter(Boolean).join(' · ') }));
      items = munis; render();
      if (q.length >= 4 && (/\d/.test(q) || munis.length < 3)) {
        ctrl?.abort();
        ctrl = new AbortController();
        try {
          const adr = await geocode(q, ctrl.signal);
          items = [...adr.filter((a) => a.numero).map((a) => ({ kind: 'adr', ...a, l1: a.ligne1, l2: a.ligne2 })), ...munis].slice(0, 7);
          render();
        } catch { /* requête annulée */ }
      }
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    if (e.key === 'Enter' && items.length) { choose(items[Math.max(0, active)]); e.preventDefault(); }
    if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (items.length) { choose(items[Math.max(0, active)]); return; }
    const q = input.value.trim();
    if (q.length < 2) { input.focus(); return; }
    const m = await searchMunis(q, 1);
    if (m.length) { choose({ kind: 'muni', code: m[0].c, l1: m[0].n }); return; }
    try {
      const adr = (await geocode(q)).filter((a) => a.numero);
      if (adr.length) { choose({ kind: 'adr', ...adr[0], l1: adr[0].ligne1, l2: adr[0].ligne2 }); return; }
    } catch { /* géocodeur indisponible */ }
    toast('Aucun résultat. Essayez avec le numéro, la rue et la ville.');
  });
}

// ---------- Panneau (glisser sur mobile) ----------
function setupSheet() {
  const handle = $('#sheet .handle');
  let startY = null; let startState = null;
  handle.addEventListener('pointerdown', (e) => { startY = e.clientY; startState = sheetEl.classList.contains('full') ? 'full' : 'half'; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointerup', (e) => {
    if (startY == null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (Math.abs(dy) < 8) { sheetEl.classList.toggle('full'); sheetEl.classList.toggle('half'); return; }
    if (dy < -40) { sheetEl.classList.add('full'); sheetEl.classList.remove('half'); }
    else if (dy > 40) {
      if (startState === 'full') { sheetEl.classList.remove('full'); sheetEl.classList.add('half'); }
      else ctx.navigate('#/carte');
    }
  });
  $('#sheet .sheet-close').addEventListener('click', () => ctx.navigate('#/carte'));
  // Sur mobile, faire défiler le contenu agrandit le panneau.
  sheet.body.addEventListener('scroll', () => {
    if (sheet.body.scrollTop > 30 && sheetEl.classList.contains('half') && innerWidth < 900) {
      sheetEl.classList.replace('half', 'full');
    }
  }, { passive: true });
}

// ---------- Légende et couches ----------
function setupLegend() {
  const draw = (metric) => {
    const l = legend(metric);
    $('#legend').innerHTML = `<div class="lg-t">${esc(l.titre)}</div>${l.items.map((i) => `<div class="lg-i"><span style="background:${i.c}"></span>${esc(i.t)}</div>`).join('')}`;
  };
  $$('#metrics .chip').forEach((b) => b.addEventListener('click', () => {
    $$('#metrics .chip').forEach((x) => x.classList.toggle('on', x === b));
    ctx.carte.setMetric(b.dataset.m);
    draw(b.dataset.m);
  }));
  $('#legend-toggle').addEventListener('click', () => $('#legend').classList.toggle('show'));
  draw('v');
}

function setupTheme() {
  const apply = (t) => {
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  let t = localStorage.getItem('datahouse:theme') || 'auto';
  apply(t);
  $('#theme').addEventListener('click', () => {
    t = { auto: 'dark', dark: 'light', light: 'auto' }[t];
    localStorage.setItem('datahouse:theme', t);
    apply(t);
    ctx.carte.applyBase();
    toast({ auto: 'Thème automatique', dark: 'Thème sombre', light: 'Thème clair' }[t]);
  });
}

function setupAccount() {
  auth.onUser((u) => {
    const b = $('#account');
    b.innerHTML = u ? `<span class="avatar">${esc((u.nom || u.email || '?').trim()[0].toUpperCase())}</span>` : icon('user');
    b.title = u ? 'Mon compte' : 'Connexion';
    $('#menu-fav').hidden = !u;
  });
  $('#account').addEventListener('click', () => $('#menu').classList.toggle('show'));
  document.addEventListener('click', (e) => { if (!e.target.closest('#menu, #account')) $('#menu').classList.remove('show'); });
  $$('#menu a').forEach((a) => a.addEventListener('click', () => $('#menu').classList.remove('show')));
}

async function main() {
  document.title = `${CONFIG.appName} — ${CONFIG.slogan}`;
  ctx.meta = await loadMeta();
  if (window.Capacitor?.isNativePlatform?.()) {
    $('#menu-apk').hidden = true;
    document.body.classList.add('native');
    // La taille de police du téléphone ne doit pas déformer la mise en page (les zooms restent possibles).
    window.Capacitor.Plugins?.TextZoom?.set({ value: 1 }).catch(() => {});
  }
  if (ctx.meta.demo) { $('#demo').hidden = false; document.body.classList.add('has-demo'); }
  setupTheme();
  ctx.carte = new Carte($('#map'), {
    onUnitClick: (ids, c) => ctx.navigate(ids.length > 1
      ? `#/b/${encodeURIComponent(ids.join('|'))}@${c[1]},${c[0]}`
      : `#/u/${encodeURIComponent(ids[0])}@${c[1]},${c[0]}`),
    onMuniClick: (code) => ctx.navigate(`#/m/${code}`),
    onUnitsState: (s) => { $('#zoomhint').hidden = s !== 'zoom'; $('#zoomhint').classList.toggle('loading', s === 'chargement'); },
  });
  attachSearch($('#q'), $('#results'));
  setupSheet();
  setupLegend();
  setupAccount();
  await auth.initAuth();
  window.addEventListener('hashchange', () => { navCount += 1; route(); });
  window.addEventListener('resize', () => ctx.carte.resize());
  window.datahouse = ctx; // utile pour le débogage et les tests
  route();
}

main().catch((e) => {
  console.error(e);
  document.body.insertAdjacentHTML('beforeend', '<div class="fatal">Les données ne sont pas encore disponibles. Réessayez dans quelques minutes.</div>');
});
