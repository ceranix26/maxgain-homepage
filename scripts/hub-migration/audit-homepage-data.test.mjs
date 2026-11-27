import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildAudit, verifyAuditAgainstSource, writePrivateAudit } from './audit-homepage-data.mjs';

test('preserves exact part numbers, flags unverified evidence, and writes a private receipt', () => {
  const root = mkdtempSync(join(tmpdir(), 'maxgain-audit-fixture-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'assets/images/products'), { recursive: true });
  const data = {
    'inventory-status.json': { items: { '001': { status: 'in-stock' }, '1': { status: 'out-of-stock' } } },
    'product-specs.json': { items: { '001': { source: { url: 'https://example.com/SECRET-MARKER' } }, ' 001': { specs: { Size: '0402' } }, 'A/B~C': { specs: {} } } },
    'product-manufacturers.json': { items: { '001': { manufacturer: 'Example' } } },
    'product-aliases.json': { aliases: { OLD: '001', OLD2: '01' } },
    'product-candidates.json': { items: {} },
    'product-image-index.json': { items: {} },
    'product-item-groups.json': { items: {} },
    'walsin-chip-resistor-review.json': { items: {} },
    'catalog-display-specs.v1.json': { items: { '001': { specifications: [{ label: 'Size', raw_value: '0402' }] } } },
    'site-popups.v1.json': { items: [] },
  };
  for (const [name, value] of Object.entries(data)) writeFileSync(join(root, 'data', name), JSON.stringify(value));
  writeFileSync(join(root, 'assets/images/products', 'one.webp'), 'image bytes');
  const audit = buildAudit(root);
  assert.equal(audit.dataset_summary['legacy-product-specs'].exact_active_source_keys, 1);
  assert.equal(audit.dataset_summary['legacy-product-specs'].normalized_key_collision_groups, 1);
  assert.equal(audit.coverage.alias_exact_active_target_count, 1);
  assert.equal(audit.coverage.alias_target_not_in_current_active_inventory_exact_count, 1);
  assert.equal(audit.coverage.legacy_specification_source_url_count, 1);
  assert.equal(audit.coverage.legacy_specification_unverified_source_hash_field_count, 0);
  assert.equal(audit.approval_granted, false);
  assert.equal(audit.publication_allowed, false);
  assert.equal(audit.assets.length, 1);
  const legacyRecord = audit.records.find(row => row.source_key_raw === '001' && row.dataset_kind === 'legacy-product-specs');
  assert.equal(legacyRecord.json_pointer, '/items/001');
  assert.equal(legacyRecord.source_file_sha256, audit.files.find(file => file.dataset_kind === 'legacy-product-specs').sha256);
  assert.deepEqual(legacyRecord.inventory_exact_pn_matches, ['001']);
  assert.equal(legacyRecord.erp_binding, null);
  assert.equal(legacyRecord.official_raw_sha256, null);
  assert.equal(legacyRecord.import_allowed, false);
  assert(audit.records.some(row => row.json_pointer === '/items/A~1B~0C'));
  assert.equal(audit.records.some(row => row.dataset_kind.startsWith('generated-')), false);
  const file = writePrivateAudit(audit);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(file)).mode & 0o777, 0o700);
  assert(!readFileSync(file, 'utf8').includes('SECRET-MARKER'));
  assert.notEqual(writePrivateAudit(audit), file);
  assert.equal(verifyAuditAgainstSource(root, audit).verifiedLegacyRecords, audit.records.length);
  writeFileSync(join(root, 'data', 'product-specs.json'), JSON.stringify({ items: {} }));
  assert.throws(() => verifyAuditAgainstSource(root, audit), /Source file changed/);
});
