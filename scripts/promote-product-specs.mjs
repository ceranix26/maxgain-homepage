import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const REVIEW_PATH = path.join(DATA_DIR, 'product-specs-review.json');
const INVENTORY_PATH = path.join(DATA_DIR, 'inventory-status.json');
const SPECS_PATH = path.join(DATA_DIR, 'product-specs.json');
const BACKUP_PATH = path.join(DATA_DIR, 'product-specs.backup.json');
const ATTRIBUTE_COLLECTIONS = ['ProductAttributes', 'Attributes', 'Specifications'];

function parseArguments() {
  const options = { dryRun: false, overwrite: false, limit: Infinity };
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--overwrite') {
      options.overwrite = true;
    } else if (args[i] === '--limit') {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1) {
        throw new Error('--limit requires a positive integer.');
      }
      options.limit = Number(value);
    } else {
      throw new Error(`Unknown argument: ${args[i]}`);
    }
  }
  return options;
}

async function readJson(filePath, label) {
  let contents;
  try {
    contents = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${label}: ${error.message}`);
  }
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`${label} contains invalid JSON.`);
  }
}

function validateItems(data, label, versionRequired = true) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      (versionRequired && data.version !== 1) ||
      !data.items || typeof data.items !== 'object' || Array.isArray(data.items)) {
    throw new Error(`${label} must contain ${versionRequired ? 'version 1 and ' : ''}an items object.`);
  }
  return data.items;
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function nonEmptyScalar(value) {
  if (!['string', 'number', 'boolean'].includes(typeof value)) return '';
  const normalized = String(value).trim();
  return normalized;
}

function normalizeAttributeName(value) {
  return nonEmptyString(value).replace(/\s+/g, ' ');
}

function readAttribute(attribute) {
  if (!attribute || typeof attribute !== 'object' || Array.isArray(attribute)) return null;
  const name = normalizeAttributeName(
    attribute.AttributeName ?? attribute.Name ?? attribute.name
  );
  const value = nonEmptyScalar(
    attribute.AttributeValue ?? attribute.Value ?? attribute.value
  );
  return name && value ? [name, value] : null;
}

function collectSpecifications(candidate, duplicateNames) {
  const attributes = ATTRIBUTE_COLLECTIONS
    .map(key => candidate[key])
    .find(Array.isArray) ?? [];
  const specs = {};
  const nonEmptyNames = new Set();
  const duplicates = [];

  for (const attribute of attributes) {
    if (!attribute || typeof attribute !== 'object' || Array.isArray(attribute)) continue;
    const rawName = attribute.AttributeName ?? attribute.Name ?? attribute.name;
    const name = normalizeAttributeName(rawName);
    const value = nonEmptyScalar(
      attribute.AttributeValue ?? attribute.Value ?? attribute.value
    );
    if (!name || !value) continue;
    if (nonEmptyNames.has(name)) {
      duplicates.push(name);
      continue;
    }
    nonEmptyNames.add(name);
    specs[name] = value;
  }

  duplicateNames.push(...duplicates);
  return specs;
}

function isHttpsUrl(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() ||
      /[\s\u0000-\u001f]/.test(value)) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

function isMouserProductUrl(value) {
  const safeUrl = isHttpsUrl(value);
  if (!safeUrl) return '';
  const hostname = new URL(safeUrl).hostname.toLowerCase();
  return hostname === 'mouser.com' || hostname.endsWith('.mouser.com') ? safeUrl : '';
}

function getSourceUrl(candidate) {
  const productUrl = [
    candidate.ProductDetailUrl,
    candidate.ProductUrl,
    candidate.MouserProductUrl
  ].map(isMouserProductUrl).find(Boolean);
  return productUrl || isHttpsUrl(candidate.DataSheetUrl);
}

function getImage(candidate) {
  const image = candidate.image;
  if (!image || typeof image !== 'object' || Array.isArray(image)) return null;
  const url = isHttpsUrl(image.url);
  if (!url) return null;
  const result = { url };
  if (typeof image.source === 'string' && image.source.trim()) {
    result.source = image.source;
  }
  if (typeof image.type === 'string' && image.type.trim()) {
    result.type = image.type;
  }
  return result;
}

function makeRecord(candidate, duplicateNames) {
  const manufacturer = nonEmptyString(candidate.Manufacturer);
  const category = nonEmptyString(candidate.Category);
  if (!manufacturer || !category) return null;

  const record = { manufacturer, category };
  const description = nonEmptyScalar(candidate.Description);
  const lifecycle = nonEmptyScalar(candidate.LifecycleStatus);
  const rohs = nonEmptyScalar(candidate.ROHSStatus);
  if (description) record.description = description;
  if (lifecycle) record.lifecycle = lifecycle;
  if (rohs) record.rohs = rohs;

  const specs = collectSpecifications(candidate, duplicateNames);
  if (Object.keys(specs).length) record.specs = specs;

  const sourceUrl = getSourceUrl(candidate);
  record.source = {
    type: 'distributor',
    name: 'Mouser',
    title: 'Mouser Product Data',
    ...(sourceUrl ? { url: sourceUrl } : {})
  };

  const image = getImage(candidate);
  if (image) record.image = image;
  return record;
}

function findInventoryPartNumber(value, inventoryItems) {
  const normalized = value.toLowerCase();
  return inventoryItems.find(partNumber => partNumber.toLowerCase() === normalized) ?? '';
}

async function writeAtomically(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function main() {
  const options = parseArguments();
  const review = validateItems(
    await readJson(REVIEW_PATH, 'product-specs-review.json'),
    'product-specs-review.json'
  );
  const inventory = validateItems(
    await readJson(INVENTORY_PATH, 'inventory-status.json'),
    'inventory-status.json',
    false
  );
  const specsData = await readJson(SPECS_PATH, 'product-specs.json');
  const approvedSpecs = validateItems(specsData, 'product-specs.json');
  const inventoryPartNumbers = Object.keys(inventory);
  const inventoryLookup = inventoryPartNumbers;
  const summary = {
    reviewTotal: Object.keys(review).length,
    eligible: 0,
    promoted: 0,
    existingSkipped: 0,
    numericOnlySkipped: 0,
    ambiguousSkipped: 0,
    invalidSkipped: 0,
    duplicateAttributes: 0,
    errors: 0
  };
  const proposals = [];
  const duplicateReports = [];

  for (const [reviewKey, candidate] of Object.entries(review)) {
    if (candidate?.status === 'multiple-exact-matches') {
      summary.ambiguousSkipped += 1;
      continue;
    }
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
        candidate.status !== 'single-exact-match' ||
        typeof candidate.originalPartNumber !== 'string' ||
        typeof candidate.ManufacturerPartNumber !== 'string' ||
        typeof candidate.Manufacturer !== 'string' ||
        typeof candidate.Category !== 'string') {
      summary.invalidSkipped += 1;
      continue;
    }

    const originalPartNumber = candidate.originalPartNumber.trim();
    const inventoryPartNumber = findInventoryPartNumber(originalPartNumber, inventoryLookup);
    if (!originalPartNumber || !inventoryPartNumber ||
        reviewKey.trim().toLowerCase() !== inventoryPartNumber.toLowerCase() ||
        candidate.ManufacturerPartNumber.trim().toLowerCase() !== inventoryPartNumber.toLowerCase() ||
        !candidate.Manufacturer.trim() ||
        !candidate.Category.trim()) {
      summary.invalidSkipped += 1;
      continue;
    }

    if (/^\d+$/.test(inventoryPartNumber)) {
      summary.numericOnlySkipped += 1;
      continue;
    }
    if (Object.hasOwn(approvedSpecs, inventoryPartNumber) && !options.overwrite) {
      summary.existingSkipped += 1;
      continue;
    }

    const duplicates = [];
    const record = makeRecord(candidate, duplicates);
    if (!record) {
      summary.invalidSkipped += 1;
      continue;
    }
    summary.duplicateAttributes += duplicates.length;
    if (duplicates.length) duplicateReports.push({ partNumber: inventoryPartNumber, attributes: duplicates });
    proposals.push({ partNumber: inventoryPartNumber, record });
  }

  summary.eligible = proposals.length;
  const limitedProposals = proposals.slice(0, options.limit);
  for (const proposal of limitedProposals) {
    console.log(`${options.dryRun ? 'WOULD PROMOTE' : 'PROMOTE'} ${proposal.partNumber}:`);
    console.log(JSON.stringify({ [proposal.partNumber]: proposal.record }, null, 2));
  }

  if (duplicateReports.length) {
    console.log('Duplicate attribute names (first non-empty value retained):');
    console.log(JSON.stringify(duplicateReports, null, 2));
  }

  if (options.dryRun) {
    console.log('Dry run: product-specs.json and backup were not modified or created.');
  } else if (limitedProposals.length) {
    const mergedSpecs = { ...approvedSpecs };
    for (const { partNumber, record } of limitedProposals) {
      mergedSpecs[partNumber] = record;
    }
    const output = `${JSON.stringify({ ...specsData, items: mergedSpecs }, null, 2)}\n`;
    const backup = `${JSON.stringify(specsData, null, 2)}\n`;
    try {
      await writeAtomically(BACKUP_PATH, backup);
      await writeAtomically(SPECS_PATH, output);
      summary.promoted = limitedProposals.length;
    } catch (error) {
      summary.errors += 1;
      console.error(`ERROR writing promoted specifications: ${error.message}`);
    }
  }

  console.log('Summary:');
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Promotion failed.');
  process.exitCode = 1;
}
