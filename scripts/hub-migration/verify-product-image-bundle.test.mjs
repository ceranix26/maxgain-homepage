import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { verifyProductImageBundle } from './verify-product-image-bundle.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), 'maxgain-image-bundle-'));
  const write = (path, value) => {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
    writeFileSync(full, bytes);
    return sha(bytes);
  };
  try {
    const pn = 'SYNTH-0001', company = 'synthetic-company';
    const sourceSpecs = write('source/product-specs.json', { version: 1, items: {} });
    const sourceIndex = write('source/product-image-index.json', { version: 1, items: {} });
    const original = sha(Buffer.from('synthetic-original-bytes'));
    const path = `assets/images/products/${original.slice(0, 16)}.webp`;
    const image = Buffer.from('RIFF0000WEBPsynthetic');
    const processed = write(path, image);
    const specs = write('candidate/product-specs.json', { version: 1, items: { [pn]: { image: { url: path } } } });
    const index = write('candidate/product-image-index.json', { version: 1, items: { [original]: { localPath: path } } });
    const inventory = Buffer.from(JSON.stringify({ items: { [pn]: {} } }));
    const m = { schemaVersion: 'hub-product-image-candidate.v1', companyId: company,
      environment: 'PRODUCTION', exactPN: pn, readyForPublication: false, reviewStatus: 'UNREVIEWED',
      input: { sourceGitCommit: 'a'.repeat(40), masterSha256: 'b'.repeat(64), sourceUrl: null,
        sourceFileSha256: sourceSpecs, sourceImageIndexSha256: sourceIndex, originalBytesSha256: original },
      output: { originalSha256: original, processedSha256: processed, publicPath: path, optimizedBytes: image.length,
        sourceUrl: null, sourceUrlVerification: 'NOT_PROVIDED', officialSourceVerified: false,
        readyForPublication: false, reviewStatus: 'UNREVIEWED' },
      artifacts: { productSpecsSha256: specs, imageIndexSha256: index, webpSha256: processed } };
    write('candidate.json', m);
    return fn({ root, write, m, pn, company, inventory, inventorySha: sha(inventory), path });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('synthetic Hub manifest remains unreviewed and is linked by exact PN and hashes', () => fixture(f => {
  const options = { expectedCompanyId: f.company, expectedExactPN: f.pn, inventory: f.inventory,
    expectedInventorySha256: f.inventorySha };
  assert.equal(verifyProductImageBundle(f.root, options).readyForPublication, false);
  f.write(f.path, Buffer.from('RIFF0000WEBPchanged'));
  assert.throws(() => verifyProductImageBundle(f.root, options), /WebP bytes mismatch/);
}));

test('no inferred active PN or official approval', () => fixture(f => {
  const options = { expectedCompanyId: f.company, expectedExactPN: f.pn, inventory: f.inventory,
    expectedInventorySha256: f.inventorySha };
  f.m.readyForPublication = true;
  f.write('candidate.json', f.m);
  assert.throws(() => verifyProductImageBundle(f.root, options), /envelope/);
}));
