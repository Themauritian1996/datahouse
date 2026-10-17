// Tests du moteur de calcul : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  droitsMutation, paiementMensuel, primeSCHL, analyseAcheteur, analyseInvestisseur, estimate, percentile, indiceRevente,
} from '../site/js/engine.js';

const meta = JSON.parse(fs.readFileSync(new URL('../pipeline/_out/data/meta.json', import.meta.url)));

test('droits de mutation — tranches de base', () => {
  // 62 900 × 0,5 % + (315 000 − 62 900) × 1 % + (400 000 − 315 000) × 1,5 %
  const r = droitsMutation(400000, '99999', meta);
  assert.equal(r.total, Math.round(314.5 + 2521 + 1275));
  assert.equal(r.specifique, false);
});

test('droits de mutation — Montréal au-delà de 552 300 $', () => {
  const r = droitsMutation(800000, '66023', meta);
  const attendu = 314.5 + 2521 + (552300 - 315000) * 0.015 + (800000 - 552300) * 0.02;
  assert.equal(r.total, Math.round(attendu));
  assert.equal(r.specifique, true);
});

test('paiement hypothécaire canadien (composé semestriellement)', () => {
  const p = paiementMensuel(400000, 5, 25);
  assert.ok(Math.abs(p - 2326.42) < 0.5, `obtenu ${p}`);
});

test('prime SCHL selon la mise de fonds', () => {
  assert.equal(primeSCHL(500000, 20).montant, 0);
  assert.equal(primeSCHL(500000, 10).montant, Math.round(450000 * 0.031));
  assert.equal(primeSCHL(500000, 5).taux, 0.04);
  assert.equal(primeSCHL(500000, 3).admissible, false);
});

test('analyse acheteur cohérente', () => {
  const r = analyseAcheteur({ prix: 500000, misePct: 20, taux: 5, amort: 25, code: '99999', meta, taxesAnnuelles: 4000, revenu: 120000 });
  assert.equal(r.mise, 100000);
  assert.equal(r.pret, 400000);
  assert.ok(r.revenuRequis > 90000 && r.revenuRequis < 160000);
  assert.ok(r.prixMax > 300000);
});

test('analyse investisseur : ratios', () => {
  const r = analyseInvestisseur({ prix: 800000, logements: 4, loyer: 1200, vacancePct: 3, taxes: 7000, assurances: 3600,
    entretienPct: 5, misePct: 20, taux: 5, amort: 25 });
  assert.equal(r.revenusBruts, 57600);
  assert.ok(Math.abs(r.mrb - 800000 / 57600) < 1e-9);
  assert.ok(r.tauxCapitalisation > 4 && r.tauxCapitalisation < 6);
  assert.equal(r.prixParPorte, 200000);
});

test('estimation : valeur = rôle × ajustement, fourchette ordonnée', () => {
  const muni = JSON.parse(fs.readFileSync(new URL('../pipeline/_out/data/muni/66023.json', import.meta.url)));
  const unit = { t: 'U', vr: 600000 };
  const e = estimate(unit, muni, meta);
  assert.equal(e.valeur, Math.round((600000 * muni.marche.adj) / 1000) * 1000);
  assert.ok(e.bas < e.valeur && e.valeur < e.haut);
  const pc = percentile(e.valeur, muni.types.U.hist);
  assert.ok(pc >= 5 && pc <= 95);
  const r = indiceRevente(unit, muni, pc);
  assert.ok(r.score >= 0 && r.score <= 100);
});

import { comparables, immeuble, fraisCondo, zonesPrix, palierPrix, zonesLoyer, palierLoyer, scores, palier } from '../site/js/engine.js';

test('zones de prix : paliers acheteur, vendeur, investisseur', () => {
  const est = { valeur: 500000, bas: 450000, haut: 550000, marge: 0.1 };
  const st = { prix: 500000, logements: 3, loyer: 1400, vacance: 3, taxes: 5000, assurances: 2700, entretien: 5, gestion: 0 };
  const z = zonesPrix(est, st);
  assert.equal(z.acheteur.favorable[1], 475000);
  assert.equal(palierPrix(z, 'acheteur', 460000), 'favorable');
  assert.equal(palierPrix(z, 'acheteur', 500000), 'neutre');
  assert.equal(palierPrix(z, 'vendeur', 540000), 'favorable');
  assert.equal(palierPrix(z, 'acheteur', 540000), 'defavorable');
  // RNE = 1400×3×12×0,97 × 0,95 − 7700 ≈ 38 746 → favorable sous 775 k$ (5 %), défavorable au-delà de 969 k$ (4 %)
  assert.ok(Math.abs(z.investisseur.favorable[1] - 775000) <= 2000, z.investisseur.favorable[1]);
  assert.equal(palierPrix(z, 'investisseur', 500000), 'favorable');
});

test('zones de loyer : équilibre et paliers', () => {
  const z = zonesLoyer(1400, { prix: 600000, logements: 3, misePct: 20, taux: 5, amort: 25, taxes: 5000, assurances: 2700, vacance: 3, entretien: 5 });
  assert.ok(z.equilibre > 1000 && z.equilibre < 2500, z.equilibre);
  assert.equal(palierLoyer(z, 1200), 'defavorable');
  assert.equal(palierLoyer(z, 1300), 'neutre');
  assert.equal(palierLoyer(z, 1450), 'favorable');
  assert.equal(palierLoyer(z, 1700), 'risque');
});

test('frais de copropriété estimés selon superficie, âge et taille', () => {
  const f = fraisCondo({ t: 'C', aire: 80, an: 2018 }, 40);
  assert.ok(f.mensuel > 200 && f.mensuel < 300, f.mensuel); // 861 pi² × 0,27 $
  assert.ok(f.bas < f.mensuel && f.mensuel < f.haut);
  assert.equal(fraisCondo({ t: 'U', aire: 80 }, 1), null);
});

test('comparables de condo : pas d\'unités du même immeuble, un par immeuble voisin', () => {
  const muni = JSON.parse(fs.readFileSync(new URL('../pipeline/_out/data/muni/66023.json', import.meta.url)));
  const munis = { 66023: muni };
  const base = { t: 'C', muni: '66023', aire: 80, an: 2005, vr: 400000 };
  const unit = { ...base, id: 'a', lat: 45.5, lon: -73.6 };
  const units = [unit, { ...base, id: 'b', lat: 45.5, lon: -73.6 }, { ...base, id: 'c', lat: 45.5, lon: -73.6 },
    { ...base, id: 'd', lat: 45.501, lon: -73.6 }, { ...base, id: 'e', lat: 45.501, lon: -73.6 }, { ...base, id: 'f', lat: 45.502, lon: -73.601 }];
  const comps = comparables(unit, units, munis, meta);
  assert.deepEqual(comps.map((c) => c.id).sort(), ['d', 'f']);
  const imm = immeuble(unit, units, muni, meta);
  assert.equal(imm.unites, 3);
});

test('comparables de plex : même nombre de logements en priorité', () => {
  const muni = JSON.parse(fs.readFileSync(new URL('../pipeline/_out/data/muni/66023.json', import.meta.url)));
  const base = { t: 'P', muni: '66023', aire: 250, an: 1925, vr: 800000 };
  const unit = { ...base, id: 'x', lg: 3, lat: 45.5, lon: -73.6 };
  const units = [unit, { ...base, id: 'duplex', lg: 2, lat: 45.5001, lon: -73.6 }, { ...base, id: 'triplex', lg: 3, lat: 45.503, lon: -73.6 },
    { ...base, id: 'sixplex', lg: 6, lat: 45.5001, lon: -73.6 }];
  const comps = comparables(unit, units, { 66023: muni }, meta, { max: 1 });
  assert.equal(comps[0].id, 'triplex');
  assert.ok(!comparables(unit, units, { 66023: muni }, meta).some((c) => c.id === 'sixplex'));
});

test('scores par profil : bornés et cohérents', () => {
  const muni = JSON.parse(fs.readFileSync(new URL('../pipeline/_out/data/muni/66023.json', import.meta.url)));
  const unit = { t: 'P', vr: 700000, aire: 250, an: 1930, lg: 3 };
  const est = estimate(unit, muni, meta);
  const st = { prix: est.valeur, logements: 3, loyer: 1500, vacance: 3, taxes: 6000, assurances: 2700, entretien: 5, gestion: 0, misePct: 20, taux: 5, amort: 25 };
  const s = scores({ unit, muni, est, pc: 50, comps: [], st });
  for (const k of ['acheteur', 'vendeur', 'investisseur']) {
    assert.ok(s[k].score >= 0 && s[k].score <= 100, k);
    assert.equal(s[k].palier, palier(s[k].score));
  }
  const cher = scores({ unit, muni, est, pc: 50, comps: [], st: { ...st, prix: est.valeur * 1.2 } });
  assert.ok(cher.acheteur.score < s.acheteur.score);
  assert.ok(cher.investisseur.score <= s.investisseur.score);
});

import { taxesFoncieres } from '../site/js/engine.js';
test('taxes foncières : taux municipal + scolaire, repli à 1 %', () => {
  const t = taxesFoncieres({ vr: 500000 }, { taxes: { tauxResidentiel: 0.6, annee: 2026 } });
  assert.equal(t.municipale, 3000);
  assert.equal(t.scolaire, Math.round((475000 * 0.0009) / 10) * 10);
  assert.equal(taxesFoncieres({ vr: 500000 }, {}).total, 5000);
});
