// Pages pleine largeur : compte, favoris, forfaits, méthodologie, mentions légales.
import { CONFIG } from './config.js';
import * as auth from './auth.js';
import { money, kmoney, esc, date, num, pct, signedPct } from './format.js';
import { unitsAround, getUnit, loadMuni } from './data.js';
import { estimate, percentile, loyerEstime, indiceRevente } from './engine.js';
import { $, $$, toast, section, row, icon } from './ui.js';

const PROFILS = { acheteur: 'Acheteur', vendeur: 'Vendeur', investisseur: 'Investisseur', courtier: 'Courtier immobilier' };
const profilSelect = (cur) => `<select id="profil">${Object.entries(PROFILS).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v}</option>`).join('')}</select>`;

export function pageCompte(ctx, params) {
  const user = auth.getUser();
  if (!user) return pageConnexion(ctx, params.has('inscription'));
  const plan = auth.forfait();
  ctx.page(`
    <h1>Mon compte</h1>
    ${auth.mode() === 'local' ? '<p class="flag">Mode local : ce compte est conservé seulement dans ce navigateur (aucun serveur configuré).</p>' : ''}
    ${section('Profil', `
      <label class="field"><span>Nom</span><input id="nom" value="${esc(user.nom || '')}"></label>
      <label class="field"><span>Courriel</span><input value="${esc(user.email)}" disabled></label>
      <label class="field"><span>Je suis surtout…</span>${profilSelect(user.profil)}</label>
      <div id="courtier-box" ${user.profil === 'courtier' ? '' : 'hidden'}>
        <p class="note">Coordonnées affichées sur vos rapports (forfait Courtier).</p>
        <label class="field"><span>Nom affiché</span><input id="c-nom" value="${esc(user.courtier?.nom || '')}"></label>
        <label class="field"><span>Agence</span><input id="c-agence" value="${esc(user.courtier?.agence || '')}"></label>
        <label class="field"><span>Téléphone</span><input id="c-tel" value="${esc(user.courtier?.tel || '')}"></label>
        <label class="field"><span>Courriel professionnel</span><input id="c-courriel" value="${esc(user.courtier?.courriel || '')}"></label>
      </div>
      <button class="btn primary" id="save">Enregistrer</button>`)}
    ${section('Forfait', `${row('Forfait actuel', esc(plan.nom))}
      ${row('Analyses détaillées / mois', Number.isFinite(plan.analyses) ? plan.analyses : 'Illimitées')}
      <a class="btn" href="#/tarifs">Changer de forfait</a>`)}
    <button class="btn ghost" id="logout">Se déconnecter</button>`);
  $('#profil').addEventListener('change', (e) => { $('#courtier-box').hidden = e.target.value !== 'courtier'; });
  $('#save').addEventListener('click', async () => {
    await auth.updateProfile({ nom: $('#nom').value.trim(), profil: $('#profil').value,
      courtier: { nom: $('#c-nom').value.trim(), agence: $('#c-agence').value.trim(), tel: $('#c-tel').value.trim(),
        courriel: $('#c-courriel').value.trim() } });
    toast('Profil enregistré.');
  });
  $('#logout').addEventListener('click', async () => { await auth.signOut(); ctx.navigate('#/'); toast('Déconnecté.'); });
}

function pageConnexion(ctx, inscription) {
  ctx.page(`
    <div class="auth-box">
      <h1>${inscription ? 'Créer un compte gratuit' : 'Connexion'}</h1>
      <p class="lead">${inscription ? 'Analyses détaillées, favoris et scénarios personnalisés.' : 'Heureux de vous revoir.'}</p>
      ${auth.mode() === 'local' ? '<p class="flag">Mode démonstration : le compte est conservé seulement dans ce navigateur.</p>' : ''}
      <form id="auth-form">
        ${inscription ? '<label class="field"><span>Nom</span><input id="nom" autocomplete="name" required></label>' : ''}
        <label class="field"><span>Courriel</span><input id="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>Mot de passe</span><input id="pwd" type="password" minlength="8" autocomplete="${inscription ? 'new-password' : 'current-password'}" required></label>
        ${inscription ? `<label class="field"><span>Je suis surtout…</span>${profilSelect('acheteur')}</label>
          <label class="check-line"><input type="checkbox" id="ok" required> J'accepte les <a href="#/legal" target="_blank">conditions et la politique de confidentialité</a>.</label>` : ''}
        <button class="btn primary wide" type="submit">${inscription ? 'Créer mon compte' : 'Se connecter'}</button>
      </form>
      ${auth.canGoogle() ? '<button class="btn wide" id="google">Continuer avec Google</button>' : ''}
      <p class="center">${inscription ? '<a href="#/compte">J\'ai déjà un compte</a>' : '<a href="#/compte?inscription">Créer un compte</a> · <a href="#" id="reset">Mot de passe oublié</a>'}</p>
    </div>`);
  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (inscription) await auth.signUp({ email: $('#email').value, password: $('#pwd').value, nom: $('#nom').value.trim(), profil: $('#profil').value });
      else await auth.signIn({ email: $('#email').value, password: $('#pwd').value });
      toast('Bienvenue !');
      ctx.back();
    } catch (err) {
      toast(frError(err), 'warn');
    } finally { btn.disabled = false; }
  });
  $('#google')?.addEventListener('click', async () => {
    try { await auth.signInGoogle($('#profil')?.value || 'acheteur'); ctx.back(); } catch (err) { toast(frError(err), 'warn'); }
  });
  $('#reset')?.addEventListener('click', async (e) => {
    e.preventDefault();
    try { await auth.resetPassword($('#email').value); toast('Courriel de réinitialisation envoyé.'); } catch (err) { toast(frError(err), 'warn'); }
  });
}

function frError(err) {
  const code = err.code || '';
  if (code.includes('email-already')) return 'Un compte existe déjà avec ce courriel.';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Courriel ou mot de passe invalide.';
  if (code.includes('weak-password')) return 'Mot de passe trop faible (8 caractères minimum).';
  if (code.includes('invalid-email')) return 'Courriel invalide.';
  return err.message || 'Une erreur est survenue.';
}

export async function pageFavoris(ctx) {
  if (!auth.getUser()) { ctx.navigate('#/compte'); return; }
  const list = await auth.getFavoris();
  ctx.page(`<h1>Mes favoris</h1>
    ${list.length ? `<p class="lead">Cochez de 2 à 4 propriétés pour les comparer côte à côte.</p>
      <div class="list">${list.map((f, i) => `
      <div class="list-item fav-row">
        <input type="checkbox" class="cmp" data-i="${i}" aria-label="Comparer">
        <a href="#/u/${encodeURIComponent(f.id)}@${f.lat},${f.lon}">
          <span><b>${esc(f.adr)}</b><small>${esc(f.type)} · ${esc(f.muni)} · ajouté le ${date(f.ajoute)}</small></span></a>
        <span class="li-v">${kmoney(f.valeur)}</span></div>`).join('')}</div>
      <button class="btn primary" id="cmp-go" disabled>${icon('compare')} Comparer</button>
      <div id="cmp-out"></div>`
    : '<p class="empty">Aucun favori pour l\'instant. Touchez l\'étoile sur la fiche d\'une propriété.</p>'}`);
  const boxes = $$('.cmp');
  const go = $('#cmp-go');
  boxes.forEach((b) => b.addEventListener('change', () => {
    const n = boxes.filter((x) => x.checked).length;
    go.disabled = n < 2 || n > 4;
  }));
  go?.addEventListener('click', async () => {
    const chosen = boxes.filter((x) => x.checked).map((x) => list[+x.dataset.i]);
    $('#cmp-out').innerHTML = '<p class="loading">Calcul de la comparaison…</p>';
    $('#cmp-out').innerHTML = await compareHtml(ctx.meta, chosen);
    $('#cmp-out').scrollIntoView({ behavior: 'smooth' });
  });
}

async function compareHtml(meta, favs) {
  const rows = [];
  for (const f of favs) {
    await unitsAround(f.lat, f.lon, 0);
    const u = getUnit(f.id);
    if (!u) continue;
    const m = await loadMuni(u.muni);
    const e = estimate(u, m, meta);
    const ts = m.types?.[u.t];
    const pc = ts ? percentile(e.valeur, ts.hist) : null;
    const loyer = loyerEstime(u, m);
    const brut = loyer ? (12 * loyer * Math.max(1, u.lg || 1) / e.valeur) * 100 : null;
    rows.push({ u, m, e, pc, loyer, brut, rv: indiceRevente(u, m, pc) });
  }
  if (rows.length < 2) return '<p class="empty">Données introuvables pour ces propriétés.</p>';
  const best = (vals, higher = true) => {
    const v = vals.filter((x) => x != null);
    return v.length ? (higher ? Math.max(...v) : Math.min(...v)) : null;
  };
  const line = (label, vals, fmt, higher) => {
    const b = higher === undefined ? null : best(vals, higher);
    return `<tr><th>${esc(label)}</th>${vals.map((v) => `<td class="${b != null && v === b ? 'win' : ''}">${v == null ? '—' : fmt(v)}</td>`).join('')}</tr>`;
  };
  const m2 = rows.map((r) => (r.u.aire ? r.e.valeur / r.u.aire : null));
  return `<section class="card"><h3>Comparaison</h3><div class="cmp-wrap"><table class="cmp-table">
    <tr><th></th>${rows.map((r) => `<th>${esc(r.u.adr)}<small>${esc(r.m.nom)}</small></th>`).join('')}</tr>
    ${line('Valeur estimée', rows.map((r) => r.e.valeur), money)}
    ${line('Fourchette', rows.map((r) => `${kmoney(r.e.bas)} – ${kmoney(r.e.haut)}`), (x) => x)}
    ${line('Type', rows.map((r) => meta.typeLabels[r.u.t]), (x) => x)}
    ${line('Année', rows.map((r) => r.u.an), (x) => x, true)}
    ${line('Aire habitable (m²)', rows.map((r) => r.u.aire), num, true)}
    ${line('Prix au m²', m2, (x) => `${num(x)} $`, false)}
    ${line('Terrain (m²)', rows.map((r) => r.u.ter), num, true)}
    ${line('Logements', rows.map((r) => r.u.lg), (x) => x)}
    ${line('Centile local', rows.map((r) => r.pc), (x) => `${x}e`)}
    ${line('Tendance municipale / an', rows.map((r) => r.m.marche.g * 100), (x) => signedPct(x), true)}
    ${line('Loyer de référence / log.', rows.map((r) => r.loyer), money)}
    ${line('Rendement brut estimé', rows.map((r) => r.brut), (x) => pct(x), true)}
    ${line('Facilité de revente', rows.map((r) => r.rv?.score), (x) => `${x}/100`, true)}
  </table></div><p class="note">En vert : la meilleure valeur de la ligne. Estimations statistiques indicatives.</p></section>`;
}

export function pageTarifs(ctx) {
  const user = auth.getUser();
  const cur = user?.plan || 'gratuit';
  ctx.page(`<h1>Forfaits</h1>
    <p class="lead">Des données publiques, analysées pour vous. Annulez en tout temps.</p>
    ${CONFIG.beta ? '<p class="flag good">Période de test : toutes les fonctions Pro sont offertes gratuitement à chaque compte.</p>' : ''}
    <div class="plans">${Object.entries(CONFIG.forfaits).map(([k, p]) => `
      <div class="plan ${k === 'pro' ? 'featured' : ''}">
        <h3>${esc(p.nom)}</h3>
        <div class="price">${p.prix ? `${money(p.prix).replace(',00', '')}<small>${p.periode}</small>` : 'Gratuit'}</div>
        <ul>${p.points.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        ${k === cur ? '<button class="btn wide" disabled>Forfait actuel</button>'
    : `<button class="btn ${k === 'pro' ? 'primary' : ''} wide" data-plan="${k}">${p.prix ? 'Choisir' : 'Revenir au gratuit'}</button>`}
      </div>`).join('')}</div>
    <p class="note center">Taxes en sus. Les prix affichés peuvent changer.</p>`);
  $$('[data-plan]').forEach((b) => b.addEventListener('click', async () => {
    const plan = b.dataset.plan;
    if (!auth.getUser()) { ctx.navigate('#/compte?inscription'); return; }
    if (auth.mode() === 'local') {
      await auth.setPlanDemo(plan);
      toast(`Forfait ${CONFIG.forfaits[plan].nom} activé (mode démonstration, sans paiement).`);
      pageTarifs(ctx);
      return;
    }
    const link = CONFIG.forfaits[plan].lienPaiement;
    if (!link) { toast('Le paiement en ligne n\'est pas encore configuré.', 'warn'); return; }
    const u = auth.getUser();
    window.location.href = `${link}?client_reference_id=${encodeURIComponent(u.uid)}&prefilled_email=${encodeURIComponent(u.email)}`;
  }));
}

export function pageMethodo(ctx) {
  const meta = ctx.meta;
  ctx.page(`<h1>Méthodologie et sources</h1>
    ${section('Estimation de la valeur', `
      <p>Chaque propriété du Québec figure au rôle d'évaluation foncière de sa municipalité, avec une valeur établie à une date de
      référence (le 1<sup>er</sup> juillet de la 2<sup>e</sup> année précédant l'entrée en vigueur du rôle). DataHouse ramène cette valeur à aujourd'hui :</p>
      <p class="formula">valeur estimée = valeur au rôle × facteur comparatif × (1 + tendance)<sup>années</sup></p>
      <ul class="check">
        <li><b>Facteur comparatif</b> : publié chaque année par le ministère des Affaires municipales et de l'Habitation (MAMH) pour chaque municipalité.
          C'est l'inverse de la proportion médiane, calculée à partir des ventes réelles comparées aux valeurs du rôle.</li>
        <li><b>Tendance</b> : évolution annuelle du facteur comparatif lorsque le même rôle est en vigueur deux années de suite ; sinon,
          hausse médiane entre le rôle antérieur et le rôle actuel des mêmes propriétés. Les petites municipalités sont lissées vers la médiane de leur MRC.</li>
        <li><b>Fourchette</b> : ±7 % pour une maison ou un condo typique, davantage pour les plex, multilogements, chalets, propriétés atypiques,
          petites municipalités et lorsque l'extrapolation dans le temps est longue.</li>
      </ul>
      <p>Hypothèse : le facteur comparatif d'un exercice reflète le marché au 1<sup>er</sup> janvier de l'année précédente.</p>`)}
    ${section('Limites', `<ul class="check">
      <li>Le rôle ne connaît pas l'état intérieur, les rénovations récentes ni les vices : l'estimation suppose un état typique.</li>
      <li>Le facteur comparatif est une moyenne municipale : un quartier peut évoluer plus vite ou plus lentement.</li>
      <li>Les comparables sont des propriétés semblables à proximité, estimées par la même méthode, et non des ventes conclues.</li>
      <li>Les loyers proviennent du recensement de 2021 indexé selon l'indice des loyers, et des loyers affichés régionaux.</li>
      <li>L'indice de facilité de revente est expérimental.</li></ul>`)}
    ${section('Sources des données', `<ul class="sources">${meta.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.nom)}</a><small>${esc(s.editeur)} · ${esc(s.licence)}</small></li>`).join('')}
      <li><a href="https://openfreemap.org" target="_blank" rel="noopener">Fond de carte OpenFreeMap</a><small>© OpenMapTiles, données © contributeurs OpenStreetMap</small></li>
      <li><a href="https://photon.komoot.io" target="_blank" rel="noopener">Recherche d'adresses Photon</a><small>Komoot, données OpenStreetMap</small></li></ul>`,
    { note: `Données compilées le ${date(meta.genere)} : ${num(meta.nbUnites)} propriétés résidentielles dans ${num(meta.nbMunicipalites)} municipalités.` })}`);
}

export function pageLegal(ctx) {
  ctx.page(`<h1>Conditions et confidentialité</h1>
    ${section('Avertissement', `<p>${CONFIG.appName} fournit des <b>estimations statistiques indicatives</b> fondées sur des données publiques.
      Elles ne constituent pas une évaluation au sens de la Loi sur les évaluateurs agréés, ni un avis de courtage immobilier, juridique,
      fiscal ou financier. ${CONFIG.appName} n'agit pas comme intermédiaire dans les transactions. Avant d'acheter ou de vendre, consultez au besoin
      un évaluateur agréé, un courtier, un notaire, un inspecteur et votre institution financière.</p>`)}
    ${section('Données personnelles (Loi 25)', `<ul class="check">
      <li>Nous recueillons votre nom, votre courriel, votre profil, vos favoris et le nombre d'analyses consultées, uniquement pour fournir le service.</li>
      <li>Les noms et adresses des propriétaires ne figurent pas dans nos données et ne sont jamais affichés ; toute tentative de réidentification est interdite.</li>
      <li>Les adresses recherchées sont envoyées au service de géocodage Photon, et les coordonnées des propriétés consultées au service OpenStreetMap Overpass.</li>
      <li>Vous pouvez demander l'accès, la rectification ou la suppression de vos données : ${esc(CONFIG.courrielContact)}.</li>
      <li>Responsable de la protection des renseignements personnels : à désigner avant la mise en service commerciale.</li></ul>`)}
    ${section('Licences', '<p>Contient des renseignements sous licence CC-BY 4.0 (Données Québec, MAMH) et la Licence du gouvernement ouvert — Canada (Statistique Canada). Voir <a href="#/methodo">les sources</a>.</p>')}`);
}
