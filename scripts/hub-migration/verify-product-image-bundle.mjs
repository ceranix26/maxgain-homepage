import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function verifyProductImageBundle(root, { expectedCompanyId, expectedEnvironment = 'PRODUCTION',
  expectedExactPN, expectedInventorySha256, inventory } = {}) {
  const read = path => readFileSync(resolve(root, path));
  const manifestBytes = read('candidate.json');
  const m = JSON.parse(manifestBytes);
  if (m.schemaVersion !== 'hub-product-image-candidate.v1' ||
      m.companyId !== expectedCompanyId || m.environment !== expectedEnvironment ||
      m.exactPN !== expectedExactPN || m.readyForPublication !== false ||
      m.reviewStatus !== 'UNREVIEWED' || !object(m.input) || !object(m.output) || !object(m.artifacts)) {
    throw new Error('Candidate envelope or scope is invalid');
  }
  if (inventory) {
    if (!hash(expectedInventorySha256) || sha256(Buffer.isBuffer(inventory) ? inventory : Buffer.from(inventory)) !== expectedInventorySha256) {
      throw new Error('Inventory snapshot SHA mismatch');
    }
    const value = JSON.parse(inventory);
    if (!Object.hasOwn(value.items || {}, expectedExactPN)) throw new Error('Exact PN is not active in inventory');
  }
  if (!hash(m.input.sourceFileSha256) || !hash(m.input.sourceImageIndexSha256) ||
      !hash(m.input.originalBytesSha256) || !hash(m.output.originalSha256) ||
      !hash(m.output.processedSha256) || !hash(m.artifacts.productSpecsSha256) ||
      !hash(m.artifacts.imageIndexSha256) || !hash(m.artifacts.webpSha256) ||
      m.input.originalBytesSha256 !== m.output.originalSha256 ||
      m.output.processedSha256 !== m.artifacts.webpSha256) throw new Error('Invalid image SHA lineage');
  const files = [
    ['source/product-specs.json', m.input.sourceFileSha256],
    ['source/product-image-index.json', m.input.sourceImageIndexSha256],
    ['candidate/product-specs.json', m.artifacts.productSpecsSha256],
    ['candidate/product-image-index.json', m.artifacts.imageIndexSha256],
  ];
  for (const [path, expected] of files) {
    if (sha256(read(path)) !== expected) throw new Error(`Candidate file SHA mismatch: ${path}`);
  }
  const publicPath = m.output.publicPath;
  if (typeof publicPath !== 'string' ||
      !/^assets\/images\/products\/[a-f0-9]{16}\.webp$/.test(publicPath) ||
      publicPath !== `assets/images/products/${m.output.originalSha256.slice(0, 16)}.webp`) {
    throw new Error('Image publication path mismatch');
  }
  const image = read(publicPath);
  if (sha256(image) !== m.output.processedSha256 || image.length !== m.output.optimizedBytes ||
      image.subarray(0, 4).toString() !== 'RIFF' || image.subarray(8, 12).toString() !== 'WEBP') {
    throw new Error('Processed WebP bytes mismatch');
  }
  const specs = JSON.parse(read('candidate/product-specs.json'));
  const index = JSON.parse(read('candidate/product-image-index.json'));
  const sourceIndex = JSON.parse(read('source/product-image-index.json'));
  if (specs.items?.[m.exactPN]?.image?.url !== publicPath ||
      index.items?.[m.output.originalSha256]?.localPath !== publicPath ||
      Object.hasOwn(sourceIndex.items || {}, m.output.originalSha256)) {
    throw new Error('Candidate links or original-SHA path collision');
  }
  return { manifestSha256: sha256(manifestBytes), exactPN: m.exactPN,
    originalSha256: m.output.originalSha256, processedSha256: m.output.processedSha256,
    readyForPublication: false, reviewStatus: 'UNREVIEWED' };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.argv.length !== 6) throw new Error('Usage: node verify-product-image-bundle.mjs DIR COMPANY_ID EXACT_PN INVENTORY_FILE');
  const inventory = readFileSync(resolve(process.argv[5]));
  process.stdout.write(`${JSON.stringify(verifyProductImageBundle(process.argv[2], {
    expectedCompanyId: process.argv[3], expectedExactPN: process.argv[4], inventory,
    expectedInventorySha256: sha256(inventory),
  }), null, 2)}\n`);
}
