import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { joinApprovedFacets, validateFacetIndex, validateInventory } from '../../assets/js/spec-facets-core.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 36 * 60 * 60 * 1000;
const FUTURE_ALLOWANCE_MS = 5 * 60 * 1000;
const kstDay = timestamp => new Date(timestamp + KST_MS).toISOString().slice(0, 10).replaceAll('-', '');

function fresh(timestamp, now, label) {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || parsed > now + FUTURE_ALLOWANCE_MS || now - parsed > MAX_AGE_MS) {
    throw new Error(`${label}: outside publication freshness window`);
  }
  return parsed;
}

/** Consumer-side preflight only. Hub must separately prove current approval lineage and source receipts. */
export function verifyFacetRelease({ inventoryBytes, candidateBytes, expectedInventorySha256,
  expectedCandidateSha256, now = Date.now(), minUsable = 1 }) {
  if (!Buffer.isBuffer(inventoryBytes) || !Buffer.isBuffer(candidateBytes) ||
      !HASH.test(expectedInventorySha256) || !HASH.test(expectedCandidateSha256)) {
    throw new Error('Pinned inventory and candidate bytes/SHA256 are required');
  }
  const inventorySha = sha256(inventoryBytes), candidateSha = sha256(candidateBytes);
  if (inventorySha !== expectedInventorySha256 || candidateSha !== expectedCandidateSha256) {
    throw new Error('Pinned snapshot SHA256 mismatch');
  }
  const inventory = validateInventory(JSON.parse(inventoryBytes));
  const candidate = validateFacetIndex(JSON.parse(candidateBytes), { expectedKind: 'approved-catalog' });
  const inventoryTime = fresh(inventory.updatedAt, now, 'inventory');
  const candidateTime = fresh(candidate.generatedAt, now, 'candidate');
  if (candidateTime < inventoryTime) throw new Error('Candidate predates pinned inventory');
  const today = kstDay(now), yesterday = kstDay(now - DAY_MS);
  if (![today, yesterday].includes(inventory.baseDate)) throw new Error('Inventory baseDate is not today/yesterday KST');
  const { rows, counts } = joinApprovedFacets(inventory, candidate, { expectedKind: 'approved-catalog' });
  if (counts.unreviewed || counts.noActiveInventoryMatch || counts.usable < minUsable ||
      counts.usable !== counts.catalogRecords || rows.length !== counts.usable) {
    throw new Error('Candidate includes unapproved/inactive rows or insufficient selectable rows');
  }
  return {
    kind: 'homepage-facet-consumer-preflight.v1',
    inventorySha256: inventorySha, candidateSha256: candidateSha,
    inventoryBaseDate: inventory.baseDate, inventoryExactPartNumbers: inventory.totalPartNumbers,
    candidatePartNumbers: counts.catalogRecords, selectableRows: counts.usable,
    canonicalPartNumbers: rows.map(row => row.canonicalPartNumber).sort(),
    hubApprovalLineageVerified: false, publicationAllowedByThisReport: false,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 6) {
    throw new Error('Usage: node verify-facet-release.mjs INVENTORY_FILE CANDIDATE_FILE INVENTORY_SHA256 CANDIDATE_SHA256');
  }
  const report = verifyFacetRelease({
    inventoryBytes: readFileSync(resolve(process.argv[2])),
    candidateBytes: readFileSync(resolve(process.argv[3])),
    expectedInventorySha256: process.argv[4], expectedCandidateSha256: process.argv[5],
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
