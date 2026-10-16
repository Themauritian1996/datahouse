// Page d'accueil : recherche par adresse, villes principales, profils, méthode.
import { CONFIG } from './config.js';
import { loadIndex, unitsAround, munisLoaded } from './data.js';
import { kmoney, num, esc } from './format.js';
import { $, icon } from './ui.js';

const PLATEAU = { lat: 45.5245, lon: -73.5835 };

export async function renderHome(ctx, attachSearch) {
  const el = $('#home');
  const meta = ctx.meta;
  const idx = await loadIndex();
  const villes = [...idx].filter((m) => m.v).sort((a, b) => (b.p || 0) - (a.p || 0)).slice(0, 8);
  const majDate = new Date(meta.genere).toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });

  el.innerHTML = `
  <div class="home-inner">
    <section class="hero-home">
      <div class="hero-text">
        <h1>Combien vaut cette propriété&nbsp;?</h1>
        <p class="hero-lead">Une estimation du prix, des comparables, le rendement locatif et le portrait du secteur
          pour ${num(meta.nbUnites)} propriétés résidentielles du Québec, calculés à partir des données publiques.</p>
        <form class="hero-search" role="search" id="home-form">
          ${icon('search')}
          <input id="home-q" type="search" placeholder="Adresse, ville ou quartier" autocomplete="off"
            aria-label="Rechercher une adresse ou une ville">
          <button class="btn primary" type="submit">Estimer</button>
          <div id="home-results" class="results" hidden></div>
        </form>
        <div class="villes" aria-label="Villes principales">
          ${villes.map((v) => `<a class="ville" href="#/m/${v.c}"><b>${esc(v.n)}</b><span>${kmoney(v.v)}</span></a>`).join('')}
        </div>
        <p class="villes-note">Prix médian estimé d'une maison unifamiliale. Données du ${majDate}.</p>
      </div>
      <figure class="hero-plan">
        <canvas id="plan" aria-label="Carte des propriétés du Plateau-Mont-Royal colorées selon leur valeur estimée"></canvas>
        <figcaption>Chaque point est une propriété du Plateau-Mont-Royal, du plus pâle (moins cher) au plus foncé (plus cher).
          <a href="#/carte?ll=${PLATEAU.lat},${PLATEAU.lon}">Explorer la carte</a></figcaption>
      </figure>
    </section>

    <section class="profils">
      <h2>Ce que DataHouse calcule pour vous</h2>
      <div class="profil-grid">
        <a class="profil" href="#/carte"><h3>Acheter</h3>
          <p>Savoir si le prix demandé est raisonnable avant de faire une offre.</p>
          <ul><li>Fourchette de valeur et comparables</li><li>Mise de fonds, droits de mutation, paiement</li><li>Revenu requis et prix maximal</li></ul></a>
        <a class="profil" href="#/carte"><h3>Vendre</h3>
          <p>Fixer un prix défendable, avec ou sans courtier.</p>
          <ul><li>Trois stratégies de prix</li><li>Économie de commission chiffrée</li><li>Arguments de vente prêts à utiliser</li></ul></a>
        <a class="profil" href="#/carte"><h3>Investir</h3>
          <p>Analyser un plex en quelques secondes.</p>
          <ul><li>Taux de capitalisation, MRB, RCD</li><li>Liquidités après hypothèque</li><li>Comparateur de propriétés</li></ul></a>
        <a class="profil" href="#/tarifs"><h3>Courtiers</h3>
          <p>Remettre une analyse claire à vos clients.</p>
          <ul><li>Rapport PDF à votre nom</li><li>Synthèse rédigée</li><li>Export des comparables</li></ul></a>
      </div>
    </section>

    <section class="methode">
      <h2>Comment l'estimation est calculée</h2>
      <ol class="etapes">
        <li><b>Valeur au rôle d'évaluation</b><span>Chaque propriété du Québec y est inscrite par sa municipalité, avec ses caractéristiques.</span></li>
        <li><b>Facteur comparatif du ministère</b><span>Publié chaque année à partir des ventes réelles de la municipalité, il ramène le rôle à la valeur du marché.</span></li>
        <li><b>Tendance locale</b><span>L'évolution récente des valeurs prolonge l'estimation jusqu'à aujourd'hui, avec une fourchette.</span></li>
      </ol>
      <p class="methode-note">Une estimation statistique, pas une évaluation agréée. <a href="#/methodo">Méthodologie et sources</a></p>
    </section>

    <section class="cta-band">
      <div><h2>Toute la province sur une carte</h2>
        <p>Prix, tendance, rendement et facilité de revente, municipalité par municipalité, puis propriété par propriété.</p></div>
      <div class="cta-actions">
        <a class="btn primary" href="#/carte">${icon('layers')}<span>Ouvrir la carte</span></a>
        ${window.Capacitor?.isNativePlatform?.() ? '' : `<a class="btn" href="https://github.com/Themauritian1996/datahouse/releases/download/apk/DataHouse.apk">${icon('phone')}<span>Application Android</span></a>`}
      </div>
    </section>

    <footer class="home-foot">
      <span>${CONFIG.appName}</span>
      <a href="#/methodo">Méthodologie et sources</a>
      <a href="#/tarifs">Forfaits</a>
      <a href="#/legal">Conditions et confidentialité</a>
    </footer>
  </div>`;

  attachSearch($('#home-q'), $('#home-results'), $('#home-form'));
  drawPlan($('#plan'), PLATEAU)
    .catch(() => (villes[0] ? drawPlan($('#plan'), { lat: villes[0].y, lon: villes[0].x }, villes[0].n, 0.025) : Promise.reject()))
    .catch(() => { $('.hero-plan')?.classList.add('vide'); });
}

/** Nuage de points réels : les propriétés d'un quartier colorées par valeur estimée. */
async function drawPlan(canvas, centre, nom = null, span = 0.012) {
  const units = await unitsAround(centre.lat, centre.lon, 1);
  if (!units.length || !canvas.isConnected) throw new Error('vide');
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  const W = box.width; const H = box.height;
  const kx = Math.cos((centre.lat * Math.PI) / 180);
  const spanX = (span * (W / H)) / kx;
  const vals = [];
  const pts = [];
  const seen = new Set();
  for (const u of units) {
    const key = `${u.lon},${u.lat}`;
    if (seen.has(key)) continue; // un point par bâtiment (copropriétés superposées)
    seen.add(key);
    const x = ((u.lon - (centre.lon - spanX / 2)) / spanX) * W;
    const y = H - ((u.lat - (centre.lat - span / 2)) / span) * H;
    if (x < -4 || y < -4 || x > W + 4 || y > H + 4) continue;
    const m = munisLoaded[u.muni];
    const v = u.vr * (m?.marche?.adj || 1) / Math.max(1, u.aire || 100);
    pts.push([x, y, v]);
    vals.push(v);
  }
  if (pts.length < 30) throw new Error('vide');
  vals.sort((a, b) => a - b);
  const q = [0.2, 0.4, 0.6, 0.8].map((p) => vals[Math.floor(p * (vals.length - 1))]);
  const css = getComputedStyle(document.documentElement);
  const brand = css.getPropertyValue('--brand').trim() || '#1e7a4f';
  const alphas = [0.18, 0.32, 0.5, 0.72, 1];
  const r = W > 500 ? 2.4 : 2;
  for (const [x, y, v] of pts) {
    let k = 0;
    while (k < 4 && v > q[k]) k++;
    g.globalAlpha = alphas[k];
    g.fillStyle = brand;
    g.fillRect(x - r / 2, y - r / 2, r, r);
  }
  g.globalAlpha = 1;
  canvas.classList.add('pret');
  if (nom) {
    const cap = canvas.parentElement.querySelector('figcaption');
    cap.firstChild.textContent = `Chaque point est une propriété de ${nom}, du plus pâle (moins cher) au plus foncé (plus cher). `;
    cap.querySelector('a').href = `#/carte?ll=${centre.lat},${centre.lon}`;
  }
}

