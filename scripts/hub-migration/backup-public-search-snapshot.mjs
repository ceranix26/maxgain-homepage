import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPublicSearchSnapshot } from './verify-public-search-snapshot.mjs';

const FILES = [
  'data/inventory-status.json', 'data/catalog-display-specs.v1.json',
  'data/product-specs.json', 'data/product-manufacturers.json',
  'data/product-aliases.json', 'data/product-image-index.json',
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const assetPath = /^assets\/images\/products\/[a-f0-9]{16}\.webp$/;

export function backupPublicSearchSnapshot(repo, commit, destination) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Full source commit required');
  const target = resolve(destination);
  if (existsSync(target)) throw new Error('Backup destination already exists');
  const parent = dirname(target);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const stage = mkdtempSync(join(parent, '.search-snapshot-'));
  chmodSync(stage, 0o700);
  try {
    const actual = execFileSync('git', ['-C', repo, 'rev-parse', `${commit}^{commit}`], { encoding: 'utf8' }).trim();
    if (actual !== commit) throw new Error('Commit changed');
    const files = {};
    const bytesFor = path => execFileSync('git', ['-C', repo, 'show', `${commit}:${path}`], { maxBuffer: 20 * 1024 * 1024 });
    const copy = (path, bytes) => {
      const output = join(stage, path);
      mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
      writeFileSync(output, bytes, { mode: 0o600 });
      files[path] = { sha256: sha256(bytes), bytes: bytes.length };
    };
    for (const path of FILES) copy(path, bytesFor(path));
    const specs = JSON.parse(bytesFor('data/product-specs.json'));
    const assets = new Set(Object.values(specs.items).map(item => item?.image?.url).filter(Boolean));
    for (const path of assets) {
      if (!assetPath.test(path)) throw new Error(`Unsafe image path: ${path}`);
      copy(path, bytesFor(path));
    }
    // A missing facet is an explicit state, not an implicit approval of any candidate.
    const tracked = new Set(execFileSync('git', ['-C', repo, 'ls-tree', '-r', '--name-only', commit],
      { encoding: 'utf8' }).trim().split('\n'));
    if (tracked.has('data/catalog-facet-index.v1.json')) {
      copy('data/catalog-facet-index.v1.json', bytesFor('data/catalog-facet-index.v1.json'));
    }
    const manifest = {
      kind: 'homepage-public-search-backup.v1', sourceCommit: commit,
      repository: 'ceranix26/maxgain-homepage', files,
      facetPresent: Object.hasOwn(files, 'data/catalog-facet-index.v1.json'),
      restoration: 'Copy exact listed bytes into a clean checkout of sourceCommit, then validate before any separate publication.',
    };
    writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    verifyPublicSearchSnapshot(stage);
    renameSync(stage, target);
    return { destination: target, manifest };
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}

export function verifyBackup(destination) {
  const root = resolve(destination);
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json')));
  if (manifest.kind !== 'homepage-public-search-backup.v1' ||
      !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) ||
      manifest.repository !== 'ceranix26/maxgain-homepage') throw new Error('Backup manifest invalid');
  for (const [path, item] of Object.entries(manifest.files)) {
    if (![...FILES, 'data/catalog-facet-index.v1.json'].includes(path) && !assetPath.test(path)) {
      throw new Error('Backup path is not allowed');
    }
    const bytes = readFileSync(join(root, path));
    if (sha256(bytes) !== item.sha256 || bytes.length !== item.bytes) throw new Error(`Backup changed: ${path}`);
  }
  const report = verifyPublicSearchSnapshot(root);
  if (report.facet.present !== manifest.facetPresent) throw new Error('Backup facet state changed');
  return { manifest, report };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 5) throw new Error('Usage: node backup-public-search-snapshot.mjs REPO FULL_COMMIT DESTINATION');
  const result = backupPublicSearchSnapshot(process.argv[2], process.argv[3], process.argv[4]);
  process.stdout.write(`${result.destination} ${Object.keys(result.manifest.files).length} files\n`);
}
