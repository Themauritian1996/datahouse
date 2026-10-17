// Libellés bilingues (français / anglais) des rapports et des scores.

export const TYPES = {
  fr: { U: 'Unifamiliale', C: 'Copropriété', P: 'Plex (2-5 log.)', M: 'Multilogement (6+)', H: 'Chalet', R: 'Maison mobile', X: 'Mixte (commerce + logements)' },
  en: { U: 'Single-family home', C: 'Condo', P: 'Plex (2-5 units)', M: 'Multi-unit (6+)', H: 'Cottage', R: 'Mobile home', X: 'Mixed use (retail + housing)' },
};

const PLEX = {
  fr: { 2: 'duplex', 3: 'triplex', 4: 'quadruplex', 5: 'quintuplex' },
  en: { 2: 'duplexes', 3: 'triplexes', 4: 'fourplexes', 5: 'fiveplexes' },
};

/** Nom des comparables selon le type (« triplex à proximité », « condos d'immeubles voisins »…). */
export function titreComparables(unit, lang = 'fr') {
  if (unit.t === 'C') return lang === 'en' ? 'Condos in nearby buildings' : 'Condos d\'immeubles voisins';
  if (unit.t === 'P' && PLEX[lang][unit.lg]) {
    return lang === 'en' ? `Nearby ${PLEX.en[unit.lg]}` : `${PLEX.fr[unit.lg][0].toUpperCase()}${PLEX.fr[unit.lg].slice(1)} à proximité`;
  }
  if (unit.t === 'U') return lang === 'en' ? 'Similar nearby homes' : 'Maisons semblables à proximité';
  return lang === 'en' ? 'Comparable nearby properties' : 'Propriétés comparables à proximité';
}

export const PROFILS = {
  fr: { acheteur: 'Acheteur', vendeur: 'Vendeur', investisseur: 'Investisseur' },
  en: { acheteur: 'Buyer', vendeur: 'Seller', investisseur: 'Investor' },
};

export const PALIERS = {
  fr: { favorable: 'Favorable', neutre: 'Neutre', defavorable: 'Défavorable', risque: 'Risque d\'inoccupation' },
  en: { favorable: 'Favourable', neutre: 'Neutral', defavorable: 'Unfavourable', risque: 'Vacancy risk' },
};

export const FACTEURS = {
  fr: {
    prixDemande: 'Prix demandé vs valeur estimée', valeurVoisins: 'Prix par superficie vs comparables', abordabilite: 'Abordabilité du marché',
    revente: 'Facilité de revente', etat: 'Âge du bâtiment', commodites: 'Commodités à proximité', precision: 'Précision de l\'estimation',
    tendance: 'Tendance des prix', liquidite: 'Liquidité du marché', positionMarche: 'Position dans le marché local',
    demande: 'Croissance démographique', capitalisation: 'Taux de capitalisation', liquidites: 'Liquidités après hypothèque',
    couverture: 'Couverture de la dette (RCD)', bassinLocatif: 'Part de locataires', capaciteLocataires: 'Capacité de payer des locataires',
    plusValue: 'Potentiel de plus-value',
  },
  en: {
    prixDemande: 'Asking price vs estimated value', valeurVoisins: 'Price per area vs comparables', abordabilite: 'Market affordability',
    revente: 'Ease of resale', etat: 'Building age', commodites: 'Nearby amenities', precision: 'Estimate precision',
    tendance: 'Price trend', liquidite: 'Market liquidity', positionMarche: 'Position in local market',
    demande: 'Population growth', capitalisation: 'Cap rate', liquidites: 'Cash flow after mortgage',
    couverture: 'Debt coverage (DCR)', bassinLocatif: 'Share of renters', capaciteLocataires: 'Renters\' ability to pay',
    plusValue: 'Appreciation potential',
  },
};

/** Libellés du rapport PDF. */
export const R = {
  fr: {
    rapportDu: 'Rapport du', valeurEstimee: 'VALEUR MARCHANDE ESTIMÉE', fourchette: 'Fourchette', a: 'à', role: 'Rôle',
    vueAerienne: 'Vue aérienne', facade: 'Façade', synthese: 'Synthèse', scores: 'Scores par profil',
    scoresNote: 'Score de 0 à 100. Favorable : 65 et plus. Neutre : 45 à 64. Défavorable : moins de 45.',
    zonesPrix: 'Zones de prix', zonesPrixNote: 'Acheteur et vendeur : selon la fourchette estimée. Investisseur : taux de capitalisation de 5 % ou mieux (favorable) et sous 4 % (défavorable), avec le loyer retenu.',
    valeurEst: 'Valeur estimée', prixRetenu: 'Prix analysé', zonesLoyer: 'Zones de loyer (investisseur)',
    zonesLoyerNote: 'Par logement et par mois. Sous 90 % du marché : revenus faibles. Au-delà de 115 % : risque d\'inoccupation.',
    loyerMarche: 'Loyer du marché', loyerRetenu: 'Loyer retenu', loyerEquilibre: 'Loyer d\'équilibre (liquidités nulles)',
    caracteristiques: 'Caractéristiques', annee: 'Année de construction', aireHab: 'Aire habitable', terrain: 'Terrain',
    logements: 'Logements', prixAire: 'Prix estimé', centile: 'Centile local', tendance: 'Tendance municipale', parAn: '/ an',
    fc: 'Facteur comparatif MAMH', etages: 'Étages', taxes: 'Taxes foncières estimées', roleLabel: 'Valeur au rôle',
    taxesNote: (v, a, t) => `Taxes : taux résidentiel ${a} de ${v} (${t} $ par 100 $ d'évaluation, MAMH) et taxe scolaire approximative ; tarifs (eau, matières résiduelles) et taxes de secteur ou d'arrondissement en sus.`, immeuble: 'L\'immeuble', unites: 'Unités de copropriété dans l\'immeuble',
    medianeImm: 'Valeur médiane des unités', fourchetteImm: 'Plus basse à plus haute', rangImm: 'Rang de cette unité',
    frais: 'Frais de copropriété estimés', fraisNote: 'Estimation selon la superficie, l\'âge et la taille de l\'immeuble (0,25 $ à 0,40 $ / pi² / mois au Québec). Les frais réels figurent au budget du syndicat.',
    parMois: '/ mois', adresse: 'Adresse', distance: 'Distance', aire: 'Aire', estimation: 'Estimation', logs: 'Log.',
    compNote: 'Valeurs estimées par la même méthode à partir du rôle d\'évaluation ; ce ne sont pas des prix de vente.',
    ecartComp: 'Écart avec la médiane des comparables', demographie: 'Portrait démographique', scenarios: 'Scénarios',
    acheteur: 'Acheteur', vendeur: 'Vendeur', investisseur: 'Investisseur', prix: 'Prix', mise: 'Mise de fonds',
    paiement: 'Paiement / mois', droits: 'Droits de mutation', comptant: 'Comptant requis', revenuRequis: 'Revenu requis',
    commissionEvitee: 'Commission évitée', taxesCommission: 'Taxes sur commission', economie: 'Économie totale',
    revenusBruts: 'Revenus bruts / an', rne: 'Revenu net (RNE)', tga: 'Taux de capitalisation', mrb: 'MRB',
    liquidites: 'Liquidités / mois', loyerLog: 'Loyer retenu / log.', secteur: 'Secteur : avantages et inconvénients',
    nouvelles: 'Nouvelles récentes du secteur', effet: 'effet possible',
    hypotheses: (h) => `Hypothèses : taux hypothécaire ${h.taux}, amortissement ${h.amort} ans, taxes foncières ${h.taxes} / an, inoccupation ${h.vac}, entretien ${h.ent} des revenus. Revenu requis calculé avec un ratio d'amortissement brut de la dette de 39 % et le taux de qualification.`,
    pied: (d) => `Estimation statistique fondée sur des données publiques (rôle d'évaluation foncière et facteurs comparatifs du MAMH, Statistique Canada, Banque du Canada, OpenStreetMap, imagerie du gouvernement du Québec). Ne constitue ni une évaluation agréée, ni un avis de courtage, juridique ou financier. Données au ${d}.`,
    strategies: ['Vente rapide', 'Équilibrée', 'Ambitieuse'],
    demo: {
      pop2021: 'Population (2021)', croissancePop: 'Croissance 2016-2021', densite: 'Densité (hab./km²)', menages: 'Ménages',
      revenuMenage: 'Revenu médian des ménages (2020)', croissanceRevenu: 'Hausse du revenu 2015-2020', pctProprio: 'Propriétaires',
      pctLocataires: 'Locataires', pctInabordableLocataire: 'Locataires au-delà de 30 % du revenu', pctInabordableProprio: 'Propriétaires au-delà de 30 % du revenu',
      pctBesoinImperieux: 'Ménages en besoin impérieux', ageMoyen: 'Âge moyen', ageMedian: 'Âge médian', pct65: '65 ans et plus',
      valeurDeclaree2021: 'Valeur médiane déclarée (2021)', valeurUnifamiliale2021: 'Valeur médiane déclarée, maisons (2021)',
      ratioPrixRevenu: 'Prix médian / revenu', rendementPlex: 'Rendement brut médian des plex', loyer: 'Loyer de référence',
    },
  },
  en: {
    rapportDu: 'Report of', valeurEstimee: 'ESTIMATED MARKET VALUE', fourchette: 'Range', a: 'to', role: 'Assessment',
    vueAerienne: 'Aerial view', facade: 'Street view', synthese: 'Summary', scores: 'Scores by profile',
    scoresNote: 'Score from 0 to 100. Favourable: 65 and up. Neutral: 45 to 64. Unfavourable: below 45.',
    zonesPrix: 'Price zones', zonesPrixNote: 'Buyer and seller: based on the estimated range. Investor: cap rate of 5% or better (favourable) and below 4% (unfavourable), using the rent entered.',
    valeurEst: 'Estimated value', prixRetenu: 'Price analysed', zonesLoyer: 'Rent zones (investor)',
    zonesLoyerNote: 'Per unit, per month. Below 90% of market: low income. Above 115%: vacancy risk.',
    loyerMarche: 'Market rent', loyerRetenu: 'Rent entered', loyerEquilibre: 'Break-even rent (zero cash flow)',
    caracteristiques: 'Property details', annee: 'Year built', aireHab: 'Living area', terrain: 'Lot',
    logements: 'Units', prixAire: 'Estimated price', centile: 'Local percentile', tendance: 'Municipal trend', parAn: '/ yr',
    fc: 'MAMH comparative factor', etages: 'Storeys', taxes: 'Estimated property taxes', roleLabel: 'Assessed value',
    taxesNote: (v, a, t) => `Taxes: ${v} ${a} residential rate ($${t} per $100 of assessment, MAMH) plus approximate school tax; user fees (water, waste) and sector or borough taxes are extra.`, immeuble: 'The building', unites: 'Condo units in the building',
    medianeImm: 'Median unit value', fourchetteImm: 'Lowest to highest', rangImm: 'Rank of this unit',
    frais: 'Estimated condo fees', fraisNote: 'Estimate based on area, age and building size ($0.25 to $0.40 / sq ft / month in Québec). Actual fees are in the syndicate\'s budget.',
    parMois: '/ month', adresse: 'Address', distance: 'Distance', aire: 'Area', estimation: 'Estimate', logs: 'Units',
    compNote: 'Values estimated with the same method from the assessment roll; these are not sale prices.',
    ecartComp: 'Gap with the comparables\' median', demographie: 'Demographic profile', scenarios: 'Scenarios',
    acheteur: 'Buyer', vendeur: 'Seller', investisseur: 'Investor', prix: 'Price', mise: 'Down payment',
    paiement: 'Payment / month', droits: 'Welcome tax', comptant: 'Cash required', revenuRequis: 'Income required',
    commissionEvitee: 'Commission saved', taxesCommission: 'Taxes on commission', economie: 'Total savings',
    revenusBruts: 'Gross income / yr', rne: 'Net operating income', tga: 'Cap rate', mrb: 'GRM',
    liquidites: 'Cash flow / month', loyerLog: 'Rent / unit', secteur: 'Area: pros and cons',
    nouvelles: 'Recent local news', effet: 'possible effect',
    hypotheses: (h) => `Assumptions: mortgage rate ${h.taux}, ${h.amort}-year amortization, property taxes ${h.taxes} / yr, vacancy ${h.vac}, maintenance ${h.ent} of income. Income required uses a 39% gross debt service ratio and the qualifying rate.`,
    pied: (d) => `Statistical estimate based on public data (MAMH property assessment roll and comparative factors, Statistics Canada, Bank of Canada, OpenStreetMap, Government of Québec imagery). Not a certified appraisal, nor brokerage, legal or financial advice. Data as of ${d}.`,
    strategies: ['Quick sale', 'Balanced', 'Ambitious'],
    demo: {
      pop2021: 'Population (2021)', croissancePop: 'Growth 2016-2021', densite: 'Density (people/km²)', menages: 'Households',
      revenuMenage: 'Median household income (2020)', croissanceRevenu: 'Income growth 2015-2020', pctProprio: 'Owners',
      pctLocataires: 'Renters', pctInabordableLocataire: 'Renters above 30% of income', pctInabordableProprio: 'Owners above 30% of income',
      pctBesoinImperieux: 'Households in core housing need', ageMoyen: 'Average age', ageMedian: 'Median age', pct65: 'Aged 65 and over',
      valeurDeclaree2021: 'Median reported value (2021)', valeurUnifamiliale2021: 'Median reported value, houses (2021)',
      ratioPrixRevenu: 'Median price / income', rendementPlex: 'Median plex gross yield', loyer: 'Reference rent',
    },
  },
};
