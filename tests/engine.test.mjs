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
