// Portrait démographique d'une municipalité (recensement 2021) : chiffres clés et petites barres.
import { money, pct, signedPct, num, num1, esc } from './format.js';
import { row, section } from './ui.js';

const barres = (titre, items) => {
  const ok = items.filter((x) => x.v != null);
  if (ok.length < 2) return '';
  const max = Math.max(...ok.map((x) => x.v), 1);
  return `<div class="dbars"><div class="dbars-t">${esc(titre)}</div>${ok.map((x) => `
    <div class="dbar"><span>${esc(x.l)}</span><i><b style="width:${Math.max(2, (x.v / max) * 100)}%"></b></i><em>${pct(x.v, 0)}</em></div>`).join('')}</div>`;
};

/** Lignes de chiffres clés (filtrées sur les valeurs disponibles). */
export function lignesDemo(c, muni) {
  return [
    ['Population (2021)', c.pop2021, num(c.pop2021)],
    ['Croissance 2016-2021', c.croissancePop, signedPct(c.croissancePop)],
    ['Densité', c.densite, c.densite ? `${num(c.densite)} hab./km²` : '—'],
    ['Ménages', c.menages, num(c.menages)],
    ['Revenu médian des ménages (2020)', c.revenuMenage, money(c.revenuMenage)],
    ['Hausse du revenu 2015-2020', c.croissanceRevenu, signedPct(c.croissanceRevenu)],
    ['Ménages avec enfants', c.pctMenagesEnfants, pct(c.pctMenagesEnfants, 0)],
    ['Personnes seules', c.menages1, pct(c.menages1, 0)],
    ['Âge moyen', c.ageMoyen, num1(c.ageMoyen)],
    ['Âge médian', c.ageMedian, num1(c.ageMedian)],
    ['Jeunes adultes (20-34 ans)', c.pct20_34, pct(c.pct20_34, 0)],
    ['Locataires au-delà de 30 % du revenu', c.pctInabordableLocataire, pct(c.pctInabordableLocataire, 0)],
    ['Propriétaires au-delà de 30 % du revenu', c.pctInabordableProprio, pct(c.pctInabordableProprio, 0)],
    ['Ménages en besoin impérieux de logement', c.pctBesoinImperieux, pct(c.pctBesoinImperieux, 0)],
    ['Ont déménagé en 1 an', c.pctDemenage1an, pct(c.pctDemenage1an, 0)],
    ['Valeur médiane déclarée (2021)', c.valeurDeclaree2021, money(c.valeurDeclaree2021)],
    ['Valeur médiane déclarée, maisons (2021)', c.valeurUnifamiliale2021, money(c.valeurUnifamiliale2021)],
    ['Prix médian / revenu', muni.ratioPrixRevenu, num1(muni.ratioPrixRevenu)],
  ].filter((r) => r[1] != null);
}

/** Aperçu en 4 chiffres, visible sans compte dans la fiche d'une propriété. */
export function apercuDemo(muni) {
  const c = muni.recensement || {};
  const k = [
    ['Revenu médian des ménages', c.revenuMenage, money(c.revenuMenage)],
    ['Propriétaires', c.pctProprio, pct(c.pctProprio, 0)],
    ['Âge médian', c.ageMedian ?? c.ageMoyen, num1(c.ageMedian ?? c.ageMoyen)],
    ['Ménages avec enfants', c.pctMenagesEnfants, pct(c.pctMenagesEnfants, 0)],
    ['Croissance de la population', c.croissancePop, signedPct(c.croissancePop)],
  ].filter((x) => x[1] != null).slice(0, 4);
  if (k.length < 2) return '';
  return section(`${muni.nom} en bref`, `<div class="dmini">${k.map(([l, , v]) => `<div><b>${v}</b><span>${esc(l)}</span></div>`).join('')}</div>`,
    { note: 'Recensement 2021. Portrait complet dans l\'onglet Secteur.' });
}

/** Section complète : barres (âge, taille des ménages, mode d'occupation) et chiffres clés. */
export function portraitDemo(muni, { titre = `Portrait démographique de ${muni.nom}` } = {}) {
  const c = muni.recensement || {};
  const lignes = lignesDemo(c, muni);
  if (!lignes.length) return '';
  const age = barres('Âge', [
    { l: '0-14 ans', v: c.pct0_14 }, { l: '15-64 ans', v: c.pct15_64 }, { l: '65 ans et +', v: c.pct65 },
  ]);
  const taille = barres('Taille des ménages', [
    { l: '1 personne', v: c.menages1 }, { l: '2 personnes', v: c.menages2 }, { l: '3 personnes', v: c.menages3 },
    { l: '4 personnes', v: c.menages4 }, { l: '5 et +', v: c.menages5 },
  ]);
  const occ = c.pctProprio != null ? barres('Mode d\'occupation', [
    { l: 'Propriétaires', v: c.pctProprio }, { l: 'Locataires', v: 100 - c.pctProprio },
  ]) : '';
  const graph = [age, taille, occ].filter(Boolean).join('');
  return section(titre, `${graph ? `<div class="dgrid">${graph}</div>` : ''}
    <div class="grid2">${lignes.map(([l, , v]) => row(l, v)).join('')}</div>`,
  { note: 'Source : Statistique Canada, Recensement de 2021 (municipalité entière).' });
}
