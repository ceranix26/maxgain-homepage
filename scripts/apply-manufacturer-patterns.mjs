import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyWalsinMlcc, classifyWalsinResistor } from './walsin-pattern-classifier.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_PATH = path.join(ROOT, 'data', 'inventory-status.json');
const MANUFACTURERS_PATH = path.join(ROOT, 'data', 'product-manufacturers.json');
const DRY_RUN = process.argv.includes('--dry-run');
const ALLOWED_ARGUMENTS = new Set(['--dry-run']);

function validateArguments() {
  for (const argument of process.argv.slice(2)) {
    if (!ALLOWED_ARGUMENTS.has(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
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
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function requireItems(data, label) {
  if (!data || !data.items || typeof data.items !== 'object' || Array.isArray(data.items)) {
    throw new Error(`${label} must contain an items object.`);
  }
  return data.items;
}

function isWalsinRecord(record) {
  return typeof record?.manufacturer === 'string' &&
    record.manufacturer.trim().toLowerCase() === 'walsin';
}

function isKnownManufacturerRecord(record) {
  return typeof record?.manufacturer === 'string' && record.manufacturer.trim().length > 0;
}

function validateManufacturerFile(data) {
  if (!data || data.version !== 1 || !data.items ||
      typeof data.items !== 'object' || Array.isArray(data.items)) {
    throw new Error('product-manufacturers.json must have version 1 and an items object.');
  }
}

function buildSortedJson(data) {
  const metadata = Object.entries(data)
    .filter(([key]) => key !== 'items')
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  const sortedItems = Object.entries(data.items)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([partNumber, record]) => {
      const formattedRecord = JSON.stringify(record, null, 2)
        .split('\n')
        .map(line => `    ${line}`)
        .join('\n');
      return `    ${JSON.stringify(partNumber)}: ${formattedRecord}`;
    });

  return `{\n${metadata.join(',\n')},\n  "items": {\n${sortedItems.join(',\n')}\n  }\n}\n`;
}

async function createBackup() {
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const backupPath = path.join(ROOT, 'data', `product-manufacturers.backup-${timestamp}.json`);
  try {
    await fs.copyFile(MANUFACTURERS_PATH, backupPath, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    throw new Error(`Could not create manufacturer backup: ${error.message}`);
  }
  return backupPath;
}

async function writeAtomically(data) {
  const temporaryPath = path.join(
    ROOT,
    'data',
    `.product-manufacturers.${process.pid}.${Date.now()}.tmp`
  );
  const contents = buildSortedJson(data);
  try {
    await fs.writeFile(temporaryPath, contents, { flag: 'wx' });
    const validated = JSON.parse(await fs.readFile(temporaryPath, 'utf8'));
    validateManufacturerFile(validated);
    await fs.rename(temporaryPath, MANUFACTURERS_PATH);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw new Error(`Could not atomically write product-manufacturers.json: ${error.message}`);
  }
}

async function main() {
  validateArguments();

  const inventory = requireItems(
    await readJson(INVENTORY_PATH, 'inventory-status.json'),
    'inventory-status.json'
  );
  const manufacturerData = await readJson(MANUFACTURERS_PATH, 'product-manufacturers.json');
  validateManufacturerFile(manufacturerData);
  const manufacturers = manufacturerData.items;
  const partNumbers = Object.keys(inventory);
  const additions = [];
  const conflicts = [];
  const existingVerified = partNumbers.filter(partNumber =>
    isWalsinRecord(manufacturers[partNumber]) &&
    manufacturers[partNumber].confidence === 'verified'
  ).length;
  const existingPatternHigh = partNumbers.filter(partNumber =>
    isWalsinRecord(manufacturers[partNumber]) &&
    manufacturers[partNumber].confidence === 'pattern-high'
  ).length;
  let patternHighCandidates = 0;
  let alreadyPresent = 0;
  let patternReviewSkipped = 0;

  for (const partNumber of partNumbers) {
    const classification = classifyWalsinMlcc(partNumber) ?? classifyWalsinResistor(partNumber);
    if (!classification) continue;

    if (classification.pattern === 'pattern-review') {
      patternReviewSkipped += 1;
      continue;
    }
    if (classification.pattern !== 'pattern-high') continue;

    patternHighCandidates += 1;
    const existing = manufacturers[partNumber];

    if (!existing) {
      additions.push({
        partNumber,
        record: {
          manufacturer: 'Walsin',
          source: 'official-catalog-pattern',
          confidence: 'pattern-high'
        }
      });
      continue;
    }

    if (isWalsinRecord(existing)) {
      alreadyPresent += 1;
      continue;
    }

    conflicts.push({
      partNumber,
      existingManufacturer: isKnownManufacturerRecord(existing)
        ? existing.manufacturer
        : null,
      reason: isKnownManufacturerRecord(existing)
        ? 'Existing different manufacturer; preserved'
        : 'Existing manufacturer record is incomplete; preserved'
    });
  }

  additions.sort((left, right) =>
    left.partNumber < right.partNumber ? -1 : left.partNumber > right.partNumber ? 1 : 0
  );
  const updatedData = {
    ...manufacturerData,
    updatedAt: additions.length > 0 ? new Date().toISOString() : manufacturerData.updatedAt,
    items: { ...manufacturers }
  };
  for (const { partNumber, record } of additions) {
    updatedData.items[partNumber] = record;
  }

  const knownBefore = partNumbers.reduce(
    (count, partNumber) => count + Number(isKnownManufacturerRecord(manufacturers[partNumber])),
    0
  );
  const knownAfter = knownBefore + additions.length;
  const summary = {
    inventoryTotal: partNumbers.length,
    existingVerified,
    existingPatternHigh,
    patternHighCandidates,
    added: additions.length,
    alreadyPresent,
    conflicts: conflicts.length,
    conflictDetails: conflicts,
    patternReviewSkipped,
    errors: 0,
    coverageAfter: {
      known: knownAfter,
      percent: partNumbers.length === 0
        ? 0
        : Number(((knownAfter / partNumbers.length) * 100).toFixed(2))
    }
  };

  if (DRY_RUN) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      recordsThatWouldBeAdded: additions.map(({ partNumber, record }) => ({
        partNumber,
        ...record
      })),
      summary
    }, null, 2));
    return;
  }

  if (additions.length > 0) {
    const backupPath = await createBackup();
    await writeAtomically(updatedData);
    summary.backup = path.relative(ROOT, backupPath);
  }
  console.log(JSON.stringify(summary, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Manufacturer pattern application failed.');
  process.exitCode = 1;
}
