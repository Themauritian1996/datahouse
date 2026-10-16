// Comptes utilisateurs : Firebase si configuré, sinon mode local (ce navigateur seulement).
import { CONFIG } from './config.js';

const FB = 'https://www.gstatic.com/firebasejs/11.0.2';
const listeners = new Set();
let backend = null;
let current = null;

const mois = () => new Date().toISOString().slice(0, 7);
const emit = () => listeners.forEach((cb) => cb(current));

export const onUser = (cb) => { listeners.add(cb); cb(current); return () => listeners.delete(cb); };
export const getUser = () => current;
export const mode = () => (backend ? backend.mode : 'local');
export const forfait = () => CONFIG.forfaits[current?.plan || 'gratuit'] || CONFIG.forfaits.gratuit;

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
          current = fbUser ? await this.load(fbUser) : null;
          emit();
          resolve();
        });
      });
    },
    ref(...path) { return fs.doc(db, 'users', current.uid, ...path); },
    async load(fbUser) {
      const ref = fs.doc(db, 'users', fbUser.uid);
      const snap = await fs.getDoc(ref);
      if (!snap.exists()) {
        const pending = JSON.parse(sessionStorage.getItem('datahouse:nouveau') || '{}');
        const doc = { email: fbUser.email, nom: pending.nom || fbUser.displayName || '', profil: pending.profil || 'acheteur',
          plan: 'gratuit', creeLe: new Date().toISOString() };
        await fs.setDoc(ref, doc);
        return { uid: fbUser.uid, ...doc };
      }
      return { uid: fbUser.uid, ...snap.data() };
    },
    async signUp({ email, password, nom, profil }) {
      sessionStorage.setItem('datahouse:nouveau', JSON.stringify({ nom, profil }));
      await fa.createUserWithEmailAndPassword(auth, email, password);
    },
    async signIn({ email, password }) { await fa.signInWithEmailAndPassword(auth, email, password); },
    async signInGoogle(profil) {
      sessionStorage.setItem('datahouse:nouveau', JSON.stringify({ profil }));
      await fa.signInWithPopup(auth, new fa.GoogleAuthProvider());
    },
    async signOut() { await fa.signOut(auth); },
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

export async function initAuth() {
  backend = CONFIG.firebase ? firebaseBackend(CONFIG.firebase) : local;
  try {
    await backend.init();
  } catch (e) {
    console.error('Firebase indisponible, passage au mode local', e);
    backend = local;
    await backend.init();
  }
  emit();
}

const wrap = (fn) => async (...args) => { await fn(...args); emit(); return current; };
export const signUp = wrap((p) => backend.signUp(p));
export const signIn = wrap((p) => backend.signIn(p));
export const signInGoogle = wrap((profil) => backend.signInGoogle(profil));
export const signOut = wrap(() => backend.signOut());
export const updateProfile = wrap((p) => backend.update(p));
export const resetPassword = (email) => backend.reset(email);
// La connexion Google par fenêtre surgissante ne fonctionne pas dans l'application Android.
export const canGoogle = () => backend?.mode === 'firebase' && !window.Capacitor?.isNativePlatform?.();

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
