// Configuration de Pignon. C'est le seul fichier à modifier pour brancher vos comptes.
export const CONFIG = {
  appName: 'Pignon',
  slogan: 'Le prix juste, chiffres en main.',
  dataUrl: 'data',

  // Firebase (comptes, favoris, rapports). Laissez `null` pour le mode local :
  // les comptes sont alors conservés seulement dans ce navigateur (démonstration).
  // Console Firebase > Paramètres du projet > Vos applications > Configuration SDK.
  firebase: null,
  // firebase: {
  //   apiKey: '...', authDomain: 'xxx.firebaseapp.com', projectId: 'xxx',
  //   storageBucket: 'xxx.appspot.com', messagingSenderId: '...', appId: '...',
  // },

  // Forfaits. Les prix sont des suggestions : ajustez-les librement.
  // `lienPaiement` : lien de paiement Stripe (Payment Link) pour chaque forfait payant.
  forfaits: {
    gratuit: { nom: 'Gratuit', prix: 0, periode: '', analyses: 5, favoris: 5, rapports: false,
      points: ['Carte et statistiques de toutes les municipalités', '5 analyses détaillées par mois',
        '5 propriétés en favoris'] },
    pro: { nom: 'Pro', prix: 14.99, periode: '/mois', analyses: Infinity, favoris: Infinity, rapports: true,
      lienPaiement: '',
      points: ['Analyses détaillées illimitées', 'Rapports imprimables (PDF)', 'Favoris illimités',
        'Scénarios acheteur, vendeur et investisseur'] },
    courtier: { nom: 'Courtier', prix: 49, periode: '/mois', analyses: Infinity, favoris: Infinity, rapports: true,
      marque: true, lienPaiement: '',
      points: ['Tout le forfait Pro', 'Rapports à votre nom et à vos coordonnées',
        'Mode présentation client', 'Assistance prioritaire'] },
  },

  // Hypothèses par défaut des calculateurs (toutes modifiables par l'utilisateur).
  defauts: {
    misePct: 20,
    amortissement: 25,
    commissionPct: 5,
    tauxTaxesFoncieresPct: 1.0,
    fraisNotaire: 2000,
    inspection: 600,
    chauffageMensuel: 100,
    vacancePct: 3,
    entretienPct: 5,
    assuranceParLogement: 900,
  },

  courrielContact: 'bonjour@exemple.com',
};
