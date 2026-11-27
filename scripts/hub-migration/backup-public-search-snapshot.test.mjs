import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyBackup } from './backup-public-search-snapshot.mjs';

const source = process.env.MAXGAIN_BACKUP_REHEARSAL;

test('pinned commit backup verifies its own bytes and a changed file is rejected', { skip: !source }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'maxgain-restore-test-'));
  try {
    const copy = join(tmp, 'backup');
    cpSync(source, copy, { recursive: true });
    const verified = verifyBackup(copy);
    assert.equal(verified.report.exactPartNumbers, 13166);
    assert.equal(verified.manifest.facetPresent, false);
    const path = join(copy, 'data/catalog-display-specs.v1.json');
    writeFileSync(path, `${readFileSync(path)} `);
    assert.throws(() => verifyBackup(copy), /Backup changed/);
    // Local correction rehearsal: replace only the damaged file from the pinned backup.
    writeFileSync(path, readFileSync(join(source, 'data/catalog-display-specs.v1.json')));
    assert.equal(verifyBackup(copy).report.displayExactActivePartNumbers, 2);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
