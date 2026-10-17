// Comptes utilisateurs : Firebase si configuré, sinon mode local (ce navigateur seulement).
import { CONFIG } from './config.js';
import { getPrefs, setPrefs, onPrefs } from './prefs.js';

const natif = () => Boolean(window.Capacitor?.isNativePlatform?.());

/**
 * Connexion Google dans l'application Android : Google interdit sa page de connexion dans une vue web
 * intégrée. On ouvre donc une page du site dans le navigateur du téléphone, qui renvoie un jeton Google
 * à l'application par un lien ca.datahouse.app://auth ; l'application ouvre ensuite la session Firebase.
 */
function jetonGoogleNatif() {
  const P = window.Capacitor?.Plugins || {};
  if (!P.Browser || !P.App) {
    return Promise.reject(Object.assign(new Error('Mettez à jour l\'application (nouvelle version de l\'APK) pour vous connecter avec Google.'), { code: 'maj' }));
  }
  const etat = (crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[^a-z0-9-]/gi, '');
  const url = new URL('connexion-google.html', location.href);
  url.search = `?etat=${etat}`;
  return new Promise((resolve, reject) => {
    let fini = false; const handles = [];
    const finir = (fn, v) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      handles.forEach((h) => h?.remove?.());
      P.Browser.close?.().catch(() => {});
      fn(v);
    };
    const minuterie = setTimeout(() => finir(reject, Object.assign(new Error('délai'), { code: 'delai' })), 5 * 60 * 1000);
    P.App.addListener('appUrlOpen', (ev) => {
      const lien = String(ev?.url || '');
      if (!lien.startsWith('ca.datahouse.app://auth')) return;
      const q = new URLSearchParams(lien.split('?')[1] || '');
      if (q.get('etat') !== etat) return;
      if (q.get('idt')) finir(resolve, q.get('idt'));
      else finir(reject, Object.assign(new Error(q.get('erreur') || 'Connexion annulée.'), { code: 'annule' }));
    }).then((h) => handles.push(h));
    // Navigateur fermé sans connexion : on laisse un court délai au lien de retour d'arriver.
    P.Browser.addListener?.('browserFinished', () => setTimeout(() => finir(reject, Object.assign(new Error('annulé'), { code: 'annule' })), 2500))
      .then((h) => handles.push(h));
    P.Browser.open({ url: url.toString() }).catch((e) => finir(reject, e));
  });
}

const FB = 'https://www.gstatic.com/firebasejs/11.0.2';
const listeners = new Set();
let backend = null;
let current = null;

const mois = () => new Date().toISOString().slice(0, 7);
const emit = () => listeners.forEach((cb) => cb(current));

export const onUser = (cb) => { listeners.add(cb); cb(current); return () => listeners.delete(cb); };
export const getUser = () => current;
export const mode = () => (backend ? backend.mode : 'local');
export const forfait = () => {
  const plan = current?.plan || 'gratuit';
  if (CONFIG.beta && plan === 'gratuit' && current) return { ...CONFIG.forfaits.pro, nom: 'Bêta (Pro gratuit)' };
  return CONFIG.forfaits[plan] || CONFIG.forfaits.gratuit;
};

// ---------- Mode local ----------
function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(`datahouse:${key}`) || 'null');
    localStorage.setItem(`datahouse:${key}`, JSON.stringify(value));
  } catch { /* stockage indisponible */ }
  return null;
}

async function sha(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const local = {
  mode: 'local',
  async init() {
    const uid = store('session');
    const users = store('users') || {};
    const u = Object.values(users).find((x) => x.uid === uid);
    current = u ? this.publicUser(u) : null;
  },
  publicUser(u) { const { hash, ...rest } = u; return rest; },
  async signUp({ email, password, nom, profil }) {
    const users = store('users') || {};
    const key = email.trim().toLowerCase();
    if (users[key]) throw new Error('Un compte existe déjà avec ce courriel.');
    const u = { uid: `local-${Date.now()}`, email: key, nom, profil, plan: 'gratuit', creeLe: new Date().toISOString(),
      hash: await sha(`${key}:${password}`) };
    users[key] = u;
    store('users', users);
    store('session', u.uid);
    current = this.publicUser(u);
  },
  async signIn({ email, password }) {
    const users = store('users') || {};
    const u = users[email.trim().toLowerCase()];
    if (!u || u.hash !== await sha(`${email.trim().toLowerCase()}:${password}`)) throw new Error('Courriel ou mot de passe invalide.');
    store('session', u.uid);
    current = this.publicUser(u);
  },
  async signOut() { store('session', null); current = null; },
  async update(patch) {
    const users = store('users') || {};
    const key = current.email;
    users[key] = { ...users[key], ...patch };
    store('users', users);
    current = this.publicUser(users[key]);
  },
  async favoris() { return store(`fav:${current.uid}`) || []; },
  async setFavoris(list) { store(`fav:${current.uid}`, list); },
  async usage() { return store(`use:${current.uid}:${mois()}`) || []; },
  async setUsage(ids) { store(`use:${current.uid}:${mois()}`, ids); },
  async reset() { throw new Error('En mode local, le mot de passe ne peut pas être réinitialisé.'); },
};

// ---------- Firebase ----------
function firebaseBackend(cfg) {
  let auth; let db; let fa; let fs;
  return {
    mode: 'firebase',
    async init() {
      const [app, a, s] = await Promise.all([
        import(`${FB}/firebase-app.js`), import(`${FB}/firebase-auth.js`), import(`${FB}/firebase-firestore.js`)]);
      fa = a; fs = s;
      const inst = app.initializeApp(cfg);
      auth = a.getAuth(inst);
      db = s.getFirestore(inst);
      await new Promise((resolve) => {
        a.onAuthStateChanged(auth, async (fbUser) => {
          try {
            current = fbUser ? await this.load(fbUser) : null;
          } catch (e) {
            // Profil illisible (réseau, règles) : la session reste ouverte avec un profil minimal.
            console.warn('Profil indisponible', e);
            current = fbUser ? { uid: fbUser.uid, email: fbUser.email, nom: fbUser.displayName || '', profil: 'acheteur', plan: 'gratuit' } : null;
          }
          emit();
          resolve();
        });
      });
    },
    /** Attend que le profil de la nouvelle session soit chargé (onAuthStateChanged est asynchrone). */
    async attendre(uid) {
      for (let i = 0; i < 150 && (current?.uid || null) !== uid; i++) await new Promise((r) => setTimeout(r, 100));
      if ((current?.uid || null) !== uid) throw Object.assign(new Error('Connexion lente : réessayez dans un instant.'), { code: 'delai' });
    },
    ref(...path) { return fs.doc(db, 'users', current.uid, ...path); },
    async load(fbUser) {
      const ref = fs.doc(db, 'users', fbUser.uid);
      const snap = await fs.getDoc(ref);
      if (!snap.exists()) {
        const pending = JSON.parse(sessionStorage.getItem('datahouse:nouveau') || '{}');
        const doc = { email: fbUser.email, nom: pending.nom || fbUser.displayName || '', profil: pending.profil || 'acheteur',
          plan: 'gratuit', creeLe: new Date().toISOString(), prefs: getPrefs() };
        await fs.setDoc(ref, doc);
        return { uid: fbUser.uid, ...doc };
      }
      return { uid: fbUser.uid, ...snap.data() };
    },
    async signUp({ email, password, nom, profil }) {
      sessionStorage.setItem('datahouse:nouveau', JSON.stringify({ nom, profil }));
      const cred = await fa.createUserWithEmailAndPassword(auth, email.trim(), password);
      if (nom) fa.updateProfile(cred.user, { displayName: nom }).catch(() => {});
      await this.attendre(cred.user.uid);
    },
    async signIn({ email, password }) {
      const cred = await fa.signInWithEmailAndPassword(auth, email.trim(), password);
      await this.attendre(cred.user.uid);
    },
    async signInGoogle(profil) {
      sessionStorage.setItem('datahouse:nouveau', JSON.stringify({ profil }));
      if (natif()) {
        const idt = await jetonGoogleNatif();
        const cred = await fa.signInWithCredential(auth, fa.GoogleAuthProvider.credential(idt));
        await this.attendre(cred.user.uid);
        return;
      }
      const provider = new fa.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const cred = await fa.signInWithPopup(auth, provider);
      await this.attendre(cred.user.uid);
    },
    async signOut() { await fa.signOut(auth); await this.attendre(null).catch(() => {}); },
    async update(patch) {
      const { plan, ...safe } = patch; // le forfait ne se modifie que côté administration
      await fs.updateDoc(fs.doc(db, 'users', current.uid), safe);
      current = { ...current, ...safe };
    },
    async favoris() {
      const snap = await fs.getDoc(this.ref('donnees', 'favoris'));
      return snap.exists() ? snap.data().liste || [] : [];
    },
    async setFavoris(list) { await fs.setDoc(this.ref('donnees', 'favoris'), { liste: list }); },
    async usage() {
      const snap = await fs.getDoc(this.ref('usage', mois()));
      return snap.exists() ? snap.data().ids || [] : [];
    },
    async setUsage(ids) { await fs.setDoc(this.ref('usage', mois()), { ids }); },
    async reset(email) { await fa.sendPasswordResetEmail(auth, email); },
  };
}

// Si le serveur de comptes est configuré mais injoignable, on n'ouvre PAS de comptes locaux :
// ils contourneraient l'inscription réelle (et ses quotas). L'utilisateur peut réessayer.
const horsService = {
  mode: 'indisponible',
  async init() { current = null; },
  ...Object.fromEntries(['signUp', 'signIn', 'signInGoogle', 'update', 'favoris', 'setFavoris', 'usage', 'setUsage', 'reset']
    .map((k) => [k, async () => { throw Object.assign(new Error('Service de connexion momentanément indisponible. Vérifiez votre connexion Internet, puis réessayez.'), { code: 'indisponible' }); }])),
  async signOut() { current = null; },
};

export async function initAuth() {
  backend = CONFIG.firebase ? firebaseBackend(CONFIG.firebase) : local;
  try {
    await backend.init();
  } catch (e) {
    console.warn('Firebase indisponible', e);
    const dev = ['localhost', '127.0.0.1'].includes(location.hostname); // tests locaux seulement
    backend = CONFIG.firebase && !dev ? horsService : local;
    await backend.init();
  }
  emit();
}

/** Nouvel essai de connexion au serveur de comptes (après une panne réseau). */
export async function retryAuth() {
  if (backend?.mode !== 'indisponible') return true;
  backend = firebaseBackend(CONFIG.firebase);
  try { await backend.init(); emit(); return true; } catch { backend = horsService; return false; }
}

const wrap = (fn) => async (...args) => { await fn(...args); emit(); return current; };
export const signUp = wrap((p) => backend.signUp(p));
export const signIn = wrap((p) => backend.signIn(p));
export const signInGoogle = wrap((profil) => backend.signInGoogle(profil));
export const signOut = wrap(() => backend.signOut());
export const updateProfile = wrap((p) => backend.update(p));
export const resetPassword = (email) => backend.reset(email);
// Google : fenêtre surgissante sur le Web, navigateur du téléphone dans l'application Android.
export const canGoogle = () => backend?.mode === 'firebase';

// Préférences : celles du compte s'appliquent à la connexion ; les changements sont enregistrés au compte.
let dernierUid = null;
onUser((u) => {
  if (u && u.uid !== dernierUid && u.prefs) setPrefs(u.prefs);
  dernierUid = u?.uid || null;
});
onPrefs((p) => { if (current && backend) backend.update({ prefs: p }).then(() => { current = { ...current, prefs: p }; }).catch(() => {}); });

/** Active un forfait sans paiement — mode local (démonstration) seulement. */
export const setPlanDemo = wrap(async (plan) => {
  if (backend.mode !== 'local') throw new Error('Le forfait est activé après le paiement.');
  await backend.update({ plan });
});

export async function getFavoris() { return current ? backend.favoris() : []; }

export async function toggleFavori(item) {
  if (!current) throw new Error('connexion');
  const list = await backend.favoris();
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list.splice(i, 1);
  else {
    if (list.length >= forfait().favoris) throw new Error('limite-favoris');
    list.unshift({ ...item, ajoute: new Date().toISOString() });
  }
  await backend.setFavoris(list);
  return i < 0;
}

/** Vérifie et comptabilise une analyse détaillée (quota mensuel du forfait). */
export async function useAnalysis(id) {
  if (!current) return { ok: false, raison: 'connexion' };
  const quota = forfait().analyses;
  const ids = await backend.usage();
  if (ids.includes(id)) return { ok: true, restant: quota - ids.length };
  if (ids.length >= quota) return { ok: false, raison: 'quota', quota };
  if (Number.isFinite(quota)) await backend.setUsage([...ids, id]);
  return { ok: true, restant: quota - ids.length - 1 };
}
