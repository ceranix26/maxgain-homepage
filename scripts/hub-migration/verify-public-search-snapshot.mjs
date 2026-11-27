import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInventory, validateFacetIndex, joinApprovedFacets } from '../../assets/js/spec-facets-core.mjs';
import { validateDisplaySpecs, joinDisplaySpecs } from '../../assets/js/catalog-display-specs-core.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const HASH = /^[a-f0-9]{64}$/;

function load(root, relativePath) {
  const bytes = readFileSync(resolve(root, relativePath));
  return { bytes, sha256: sha256(bytes), value: JSON.parse(bytes) };
}

export function verifyPublicSearchSnapshot(root, expected = {}) {
  const files = {};
  for (const [kind, path] of Object.entries({
    inventory: 'data/inventory-status.json',
    display: 'data/catalog-display-specs.v1.json',
    specifications: 'data/product-specs.json',
    manufacturers: 'data/product-manufacturers.json',
    aliases: 'data/product-aliases.json',
    imageIndex: 'data/product-image-index.json',
  })) {
    files[kind] = load(root, path);
    if (expected[kind] && files[kind].sha256 !== expected[kind]) throw new Error(`${kind}: bytes SHA changed`);
  }
  validateInventory(files.inventory.value);
  validateDisplaySpecs(files.display.value);
  const inventory = files.inventory.value;
  const display = joinDisplaySpecs(inventory, files.display.value);
  for (const kind of ['specifications', 'manufacturers', 'imageIndex']) {
    if (!object(files[kind].value.items)) throw new Error(`${kind}: missing items`);
  }
  if (!object(files.aliases.value.aliases)) throw new Error('aliases: missing aliases');
  const imageIndex = files.imageIndex.value.items;
  let images = 0;
  for (const [pn, item] of Object.entries(files.specifications.value.items)) {
    const path = item?.image?.url;
    if (!path) continue;
    if (typeof path !== 'string' || !/^assets\/images\/products\/[a-f0-9]{16}\.webp$/.test(path)) {
      throw new Error(`Invalid image path for ${pn}`);
    }
    const matches = Object.entries(imageIndex).filter(([originalSha, entry]) =>
      HASH.test(originalSha) && entry?.localPath === path && path.endsWith(`${originalSha.slice(0, 16)}.webp`));
    if (matches.length !== 1) throw new Error(`Image index mismatch for ${pn}`);
    const asset = resolve(root, path);
    const bytes = readFileSync(asset);
    if (statSync(asset).size !== bytes.length || bytes.subarray(0, 4).toString() !== 'RIFF' ||
        bytes.subarray(8, 12).toString() !== 'WEBP') throw new Error(`Invalid WebP for ${pn}`);
    if (matches[0][1].optimizedBytes !== bytes.length) throw new Error(`Image length mismatch for ${pn}`);
    images += 1;
  }
  const facetPath = resolve(root, 'data/catalog-facet-index.v1.json');
  let facet = { present: false, usable: 0 };
  try {
    const loaded = load(root, 'data/catalog-facet-index.v1.json');
    validateFacetIndex(loaded.value, { expectedKind: 'approved-catalog' });
    const joined = joinApprovedFacets(inventory, loaded.value, { expectedKind: 'approved-catalog' });
    facet = { present: true, sha256: loaded.sha256, usable: joined.counts.usable };
    if (expected.facet && loaded.sha256 !== expected.facet) throw new Error('facet: bytes SHA changed');
  } catch (error) {
    if (error?.code !== 'ENOENT' || error?.path !== facetPath) throw error;
    if (expected.facet) throw new Error('Expected facet file is absent');
  }
  return {
    kind: 'homepage-public-search-snapshot-check.v1',
    inventoryBaseDate: inventory.baseDate,
    exactPartNumbers: inventory.totalPartNumbers,
    displayPartNumbers: Object.keys(files.display.value.items).length,
    displayExactActivePartNumbers: display.size,
    localProductImages: images,
    facet,
    sha256: Object.fromEntries(Object.entries(files).map(([kind, loaded]) => [kind, loaded.sha256])),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = resolve(process.argv[2] || '.');
  const expected = process.argv[3] ? JSON.parse(readFileSync(resolve(process.argv[3]))) : {};
  process.stdout.write(`${JSON.stringify(verifyPublicSearchSnapshot(root, expected), null, 2)}\n`);
}
