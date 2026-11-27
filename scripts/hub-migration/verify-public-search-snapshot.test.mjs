import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPublicSearchSnapshot } from './verify-public-search-snapshot.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
function fixture(fn) {
  const tmp = mkdtempSync(join(tmpdir(), 'maxgain-snapshot-test-'));
  try {
    cpSync(join(root, 'data'), join(tmp, 'data'), { recursive: true });
    cpSync(join(root, 'assets/images/products'), join(tmp, 'assets/images/products'), { recursive: true });
    return fn(tmp);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

test('current public inputs are exact and images exist', () => {
  const report = verifyPublicSearchSnapshot(root);
  assert.equal(report.exactPartNumbers, 13166);
  assert.equal(report.displayExactActivePartNumbers, 2);
  assert.equal(report.facet.present, false);
});

test('same-shape inventory replacement is caught by pinned byte digest', () => fixture(tmp => {
  const before = verifyPublicSearchSnapshot(tmp);
  const path = join(tmp, 'data/inventory-status.json');
  const value = JSON.parse(readFileSync(path));
  value.items.WR12X1003FTL.stockLevel = 'changed';
  writeFileSync(path, JSON.stringify(value));
  assert.throws(() => verifyPublicSearchSnapshot(tmp, { inventory: before.sha256.inventory }), /bytes SHA changed/);
}));

test('unreviewed display field is rejected', () => fixture(tmp => {
  const path = join(tmp, 'data/catalog-display-specs.v1.json');
  const value = JSON.parse(readFileSync(path));
  value.items.WR12X1003FTL.specifications[0].review_status = 'UNREVIEWED';
  writeFileSync(path, JSON.stringify(value));
  assert.throws(() => verifyPublicSearchSnapshot(tmp), /unapproved/);
}));

test('missing image bytes fail closed', () => fixture(tmp => {
  const path = join(tmp, 'assets/images/products/d7aff0c0b79e6c7d.webp');
  rmSync(path);
  assert.throws(() => verifyPublicSearchSnapshot(tmp), /ENOENT/);
}));
