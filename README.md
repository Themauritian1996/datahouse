# DataHouse — le prix juste de l'immobilier au Québec

DataHouse estime la valeur marchande de chaque propriété résidentielle du Québec à partir de données publiques. Il présente ensuite l'analyse selon le profil de l'utilisateur : acheteur, vendeur (avec ou sans courtier), investisseur ou courtier.

- **Carte** de toutes les municipalités : prix médian, tendance, rendement locatif et facilité de revente.
- **Fiche de propriété** :
  - valeur estimée et fourchette, avec le détail du calcul ;
  - position dans le marché local et comparables à proximité ;
  - coûts d'achat : droits de mutation, prime SCHL, paiement, revenu requis ;
  - stratégies de prix et économies sans courtier ;
  - rendement locatif : taux de capitalisation, MRB, RCD, liquidités ;
  - avantages et inconvénients du secteur (OpenStreetMap) ;
  - nouvelles locales et indice de facilité de revente.
- **Comptes** : profil, favoris, quota d'analyses par forfait, rapport imprimable (PDF), rapport au nom du courtier.

## Architecture

```
site/                 Application web statique (GitHub Pages), sans étape de compilation
  js/engine.js        Calculs purs (estimation, hypothèque, droits de mutation, investisseur…)
  js/config.js        ← SEUL fichier à modifier : Firebase, forfaits, liens de paiement, hypothèses
pipeline/             Construction des données (Python), exécutée par GitHub Actions
  build_data.py       Orchestration ; --demo pour des données simulées
  fixtures/           Générateur de données simulées au format réel (tests)
firebase/firestore.rules
.github/workflows/    donnees.yml (chaque semaine) et deploiement.yml
tests/                Tests du moteur (node --test) et de bout en bout (Playwright)
```

### Méthode d'estimation

```
valeur estimée = valeur au rôle × facteur comparatif MAMH × (1 + tendance)^années
```

- **Facteur comparatif** : il est publié chaque année pour chaque municipalité. C'est l'inverse de la proportion médiane, que le ministère calcule à partir des ventes réelles.
- **Tendance** : elle provient de l'évolution du facteur comparatif d'une année à l'autre. À défaut, on utilise l'écart entre le rôle antérieur et le rôle actuel des mêmes immeubles. La tendance est lissée vers la médiane de la MRC.
- **Fourchette** : elle s'élargit selon le type de propriété, l'atypicité, la taille de la municipalité et la durée d'extrapolation.

Aucune donnée Centris ou MLS n'est utilisée. Le nom et l'adresse des propriétaires ne figurent pas dans les données ouvertes, et DataHouse ne les affiche jamais.

### Sources (vérifiées automatiquement chaque semaine)

| Donnée | Source | Licence |
|---|---|---|
| Rôles d'évaluation géoréférencés (≈ 3,5 M unités) | MAMH, Données Québec | CC-BY 4.0 |
| Facteurs comparatifs | MAMH, Richesse foncière uniformisée | CC-BY 4.0 |
| Démographie, revenus, loyers 2021 | Statistique Canada, recensement 2021 | Licence ouverte |
| Limites municipales | Statistique Canada | Licence ouverte |
| Indice des loyers (IPC), loyers affichés | Statistique Canada, tableaux 18-10-0004 et 46-10-0092 | Licence ouverte |
| Taux hypothécaire 5 ans | Banque du Canada | Conditions de la BdC |
| Commodités et nuisances | OpenStreetMap (API Overpass, à la demande) | ODbL |
| Nouvelles | Google Actualités (titres et liens seulement) + Gemini (optionnel) | — |

### Sources bloquées depuis GitHub (contournées)

Statistique Canada (`www12`) et le serveur cartographique du MRNF refusent les serveurs de GitHub (aux États-Unis) :
- **Contours municipaux** : reconstruits à partir des positions du rôle (grille d'environ 400 m attribuée à la municipalité majoritaire).
- **Population** : tableau 98-10-0002 (serveur `www150`, accessible).
- **Revenus, loyers médians et propriétaires (profil du recensement 2021)** : non disponibles pour l'instant. Les loyers de référence sont les loyers affichés régionaux (tableau 46-10-0092), réduits de 10 %.
- Le flux *Diagnostic des sources* (Actions → Run workflow) teste la joignabilité de chaque source.

## Mise en ligne (environ 30 minutes)

1. **GitHub** : créez un dépôt (p. ex. `datahouse`) et poussez-y ce dossier.
   - Dans *Settings → Pages*, choisissez **Source : GitHub Actions**.
2. **Premier déploiement** : il part automatiquement à la poussée et affiche des **données de démonstration**, signalées par une bannière jaune.
3. **Données réelles** : allez dans *Actions → Données → Run workflow*.
   - Le flux dure environ 30 à 90 minutes, puis redéploie le site avec les vraies données.
   - Il se relance ensuite seul chaque lundi et ne retélécharge que les fichiers modifiés à la source.
4. **Nouvelles analysées par IA** (optionnel) : ajoutez le secret `GEMINI_API_KEY` dans *Settings → Secrets and variables → Actions*.
5. **Comptes réels (Firebase, gratuit au départ)** :
   - Créez un projet Firebase.
   - Activez *Authentication* (courriel/mot de passe et Google).
   - Activez *Firestore*.
   - Publiez `firebase/firestore.rules`.
   - Ajoutez votre domaine GitHub Pages aux domaines autorisés.
   - Copiez la configuration Web dans `site/js/config.js` (champ `firebase`).
   - Sans cette étape, l'application fonctionne en **mode local** : les comptes restent dans le navigateur, ce qui suffit pour une démonstration.
6. **Paiements (Stripe)** :
   - Créez un *Payment Link* par forfait et collez-le dans `config.js` (`lienPaiement`).
   - Après un paiement, activez le forfait dans Firestore : `users/{uid}.plan = "pro"` ou `"courtier"`.
   - L'activation automatique par webhook est la prochaine étape (voir la feuille de route).

## Tests

```bash
cd pipeline && python build_data.py --demo     # données simulées dans pipeline/_out
cp -r pipeline/_out/data site/data
node --test tests/engine.test.mjs              # moteur de calcul
(cd site && python -m http.server 8765) & python tests/e2e.py   # parcours complet mobile, sombre et bureau
```

## Avant la commercialisation

- **Juridique** :
  - Présenter les résultats comme des « estimations statistiques », jamais comme des « évaluations ». Le titre d'évaluateur agréé est protégé.
  - Ne pas agir comme intermédiaire dans les transactions (OACIQ).
  - Faire relire les conditions par un avocat.
- **Loi 25** :
  - Désigner un responsable de la protection des renseignements personnels.
  - Compléter la politique de confidentialité (page *Conditions*).
- **Attribution** : les sources sont citées dans *Méthodologie et sources*. Elles doivent y rester (licences CC-BY et ouverte).
- **Fournisseurs gratuits** : géocodage Photon et API Overpass. Pour un volume commercial important, prévoyez une instance payante ou auto-hébergée. Le fond de carte OpenFreeMap est gratuit.

## Feuille de route suggérée

1. Webhook Stripe → activation automatique des forfaits (Cloudflare Worker ou Firebase Functions).
2. Quota d'analyses vérifié côté serveur. Il est actuellement vérifié dans le navigateur.
3. Zones inondables (MELCCFP) et taux de taxation par municipalité (MAMH).
4. Données de ventes réelles sous licence (JLR / Registre foncier), pour calibrer la fourchette quartier par quartier.
5. Extension aux autres provinces (rôles d'évaluation ouverts de la Colombie-Britannique, de l'Ontario via MPAC sous licence, etc.).
