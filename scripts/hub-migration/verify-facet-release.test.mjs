import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyFacetRelease } from './verify-facet-release.mjs';

const now = Date.parse('2026-11-28T01:00:00Z');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function synthetic() {
  const revision = 'a'.repeat(64);
  const evidence = (sourceLabel, rawValue) => [{ sourceLabel, rawValue,
    sourceUrl: 'https://example.com/synthetic-only', sourceSha256: 'b'.repeat(64),
    retrievedAt: '2026-11-28T00:00:00Z', reviewTargetVersion: revision,
    reviewStatus: 'APPROVED' }];
  const inventory = { updatedAt: '2026-11-28T00:00:00Z', baseDate: '20261128', source: 'SYNTHETIC',
    totalPartNumbers: 1, items: { 'SYNTH-0001': { status: 'in-stock', label: '재고 있음', stockLevel: '소량' } } };
  const candidate = { version: 1, datasetKind: 'approved-catalog', generatedAt: '2026-11-28T00:01:00Z',
    items: { 'SYNTH-0001': { manufacturer: 'Synthetic Only', aliases: [], parseStatus: 'PARSED_EXACT',
      reviewTargetVersion: revision, reviewStatus: 'APPROVED', facets: {
        family: { raw: 'Chip Resistor', normalized: 'Chip Resistor', evidence: evidence('product family', 'Chip Resistor') },
        size: { raw: '1206', normalized: '1206', system: 'EIA-inch', evidence: evidence('EIA Size', '1206') },
        resistance: { raw: '1000 Ω', normalizedValue: '1000', unit: 'ohm', evidence: evidence('Resistance', '1000 Ω') },
        tolerance: { raw: '±1%', plusPercent: '1', minusPercent: '1', evidence: evidence('Tolerance', '±1%') },
      } } } };
  return { inventory, candidate };
}

function check({ inventory, candidate }, overrides = {}) {
  const inventoryBytes = Buffer.from(JSON.stringify(inventory));
  const candidateBytes = Buffer.from(JSON.stringify(candidate));
  return verifyFacetRelease({ inventoryBytes, candidateBytes, expectedInventorySha256: sha(inventoryBytes),
    expectedCandidateSha256: sha(candidateBytes), now, ...overrides });
}

test('consumer preflight accepts exact active synthetic row but never grants Hub publication', () => {
  const report = check(synthetic());
  assert.equal(report.selectableRows, 1);
  assert.deepEqual(report.canonicalPartNumbers, ['SYNTH-0001']);
  assert.equal(report.hubApprovalLineageVerified, false);
  assert.equal(report.publicationAllowedByThisReport, false);
});

test('candidate bytes cannot change after its Hub hash is pinned', () => {
  const fixture = synthetic();
  const bytes = Buffer.from(JSON.stringify(fixture.candidate));
  fixture.candidate.items['SYNTH-0001'].facets.tolerance.plusPercent = '2';
  assert.throws(() => check(fixture, { expectedCandidateSha256: sha(bytes) }), /SHA256 mismatch/);
});

test('unapproved tolerance evidence is rejected despite a plausible value', () => {
  const fixture = synthetic();
  fixture.candidate.items['SYNTH-0001'].facets.tolerance.evidence[0].reviewStatus = 'UNREVIEWED';
  assert.throws(() => check(fixture), /unapproved data/);
});

test('part number not in exact active inventory cannot be published', () => {
  const fixture = synthetic();
  fixture.inventory.items = { 'synth-0001': { status: 'in-stock', label: '재고 있음', stockLevel: '소량' } };
  assert.throws(() => check(fixture), /inactive rows/);
});

test('a reviewed Legacy alias may match the active inventory by exact spelling', () => {
  const fixture = synthetic();
  fixture.candidate.items['SYNTH-CANONICAL'] = fixture.candidate.items['SYNTH-0001'];
  delete fixture.candidate.items['SYNTH-0001'];
  fixture.candidate.items['SYNTH-CANONICAL'].aliases = [{ partNumber: 'SYNTH-0001',
    relation: 'LEGACY_TO_GPN', reviewStatus: 'APPROVED', evidence: [{
      sourceLabel: 'Legacy P/N', rawValue: 'SYNTH-0001', sourceUrl: 'https://example.com/synthetic-only',
      sourceSha256: 'b'.repeat(64), retrievedAt: '2026-11-28T00:00:00Z',
      reviewTargetVersion: 'a'.repeat(64), reviewStatus: 'APPROVED',
    }] }];
  assert.deepEqual(check(fixture).canonicalPartNumbers, ['SYNTH-CANONICAL']);
});

test('inventory replacement is blocked even when the candidate remains valid', () => {
  const fixture = synthetic();
  const original = sha(Buffer.from(JSON.stringify(fixture.inventory)));
  fixture.inventory.items['SYNTH-0001'].stockLevel = '100+';
  assert.throws(() => check(fixture, { expectedInventorySha256: original }), /SHA256 mismatch/);
});

test('stale or future generation and changed inventory date fail closed', () => {
  const stale = synthetic();
  stale.candidate.generatedAt = '2026-11-25T00:00:00Z';
  assert.throws(() => check(stale), /freshness/);
  const future = synthetic();
  future.candidate.generatedAt = '2026-11-28T01:06:00Z';
  assert.throws(() => check(future), /freshness/);
  const wrongDay = synthetic();
  wrongDay.inventory.baseDate = '20261125';
  assert.throws(() => check(wrongDay), /baseDate/);
});
