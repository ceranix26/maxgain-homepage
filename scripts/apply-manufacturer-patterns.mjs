import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyWalsinMlcc, classifyWalsinResistor } from './walsin-pattern-classifier.mjs';
import { classifyVikingPartNumber } from './viking-pattern-classifier.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_PATH = path.join(ROOT, 'data', 'inventory-status.json');
const MANUFACTURERS_PATH = path.join(ROOT, 'data', 'product-manufacturers.json');
const MANUFACTURER_OPTIONS = new Set(['walsin', 'viking', 'all']);

function parseArguments() {
  const options = { dryRun: false, manufacturer: 'all' };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--manufacturer') {
      const value = args[index + 1];
      if (!MANUFACTURER_OPTIONS.has(value)) {
        throw new Error('--manufacturer must be followed by walsin, viking, or all.');
      }
      options.manufacturer = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
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

function isVikingRecord(record) {
  return typeof record?.manufacturer === 'string' &&
    record.manufacturer.trim().toLowerCase() === 'viking tech';
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
  const options = parseArguments();

  const inventory = requireItems(
    await readJson(INVENTORY_PATH, 'inventory-status.json'),
    'inventory-status.json'
  );
  const manufacturerData = await readJson(MANUFACTURERS_PATH, 'product-manufacturers.json');
  validateManufacturerFile(manufacturerData);
  const manufacturers = manufacturerData.items;
  const partNumbers = Object.keys(inventory);
  const selectedManufacturers = options.manufacturer === 'all'
    ? ['walsin', 'viking']
    : [options.manufacturer];
  const additions = [];
  const results = {};
  const updatedItems = { ...manufacturers };

  for (const selectedManufacturer of selectedManufacturers) {
    const isWalsin = selectedManufacturer === 'walsin';
    const result = {
      patternHighCandidates: 0,
      added: 0,
      alreadyPresent: 0,
      conflicts: 0,
      conflictDetails: [],
      patternReviewSkipped: 0,
      errors: 0
    };

    for (const partNumber of partNumbers) {
      const classification = isWalsin
        ? classifyWalsinMlcc(partNumber) ?? classifyWalsinResistor(partNumber)
        : classifyVikingPartNumber(partNumber);
      if (!classification) continue;

      if (classification.pattern === 'pattern-review') {
        result.patternReviewSkipped += 1;
        continue;
      }
      if (classification.pattern !== 'pattern-high') continue;

      result.patternHighCandidates += 1;
      const existing = updatedItems[partNumber];
      if (isWalsin) {
        if (!existing) {
          const record = {
            manufacturer: 'Walsin',
            source: 'official-catalog-pattern',
            confidence: 'pattern-high'
          };
          additions.push({ partNumber, record });
          updatedItems[partNumber] = record;
          result.added += 1;
        } else if (isWalsinRecord(existing)) {
          result.alreadyPresent += 1;
        } else {
          result.conflictDetails.push({
            partNumber,
            existingManufacturer: isKnownManufacturerRecord(existing)
              ? existing.manufacturer
              : null,
            reason: isKnownManufacturerRecord(existing)
              ? 'Existing different manufacturer; preserved'
              : 'Existing manufacturer record is incomplete; preserved'
          });
        }
        continue;
      }

      if (existing?.confidence === 'verified') {
        result.conflictDetails.push({
          partNumber,
          existingManufacturer: isKnownManufacturerRecord(existing)
            ? existing.manufacturer
            : null,
          reason: 'Existing verified manufacturer mapping takes priority; preserved'
        });
      } else if (isWalsinRecord(existing) && existing.confidence === 'pattern-high') {
        result.conflictDetails.push({
          partNumber,
          existingManufacturer: existing.manufacturer,
          reason: 'Existing Walsin pattern-high classification takes priority; preserved'
        });
      } else if (!existing) {
        const record = {
          manufacturer: 'Viking Tech',
          source: 'official-catalog-pattern',
          confidence: 'pattern-high'
        };
        additions.push({ partNumber, record });
        updatedItems[partNumber] = record;
        result.added += 1;
      } else if (isVikingRecord(existing) && existing.confidence === 'pattern-high') {
        result.alreadyPresent += 1;
      } else {
        result.conflictDetails.push({
          partNumber,
          existingManufacturer: isKnownManufacturerRecord(existing)
            ? existing.manufacturer
            : null,
          reason: isKnownManufacturerRecord(existing)
            ? 'Existing manufacturer mapping or classification differs; preserved'
            : 'Existing manufacturer record is incomplete; preserved'
        });
      }
    }
    result.conflicts = result.conflictDetails.length;
    result.conflicts = result.conflictDetails.length;
    results[selectedManufacturer] = result;
  }

  additions.sort((left, right) =>
    left.partNumber < right.partNumber ? -1 : left.partNumber > right.partNumber ? 1 : 0
  );
  const updatedData = {
    ...manufacturerData,
    ...(additions.length > 0 ? { updatedAt: new Date().toISOString() } : {}),
    items: updatedItems
  };

  const knownBefore = partNumbers.reduce(
    (count, partNumber) => count + Number(isKnownManufacturerRecord(manufacturers[partNumber])),
    0
  );
  const knownAfter = knownBefore + additions.length;
  const summary = {
    manufacturers: results,
    overall: {
      knownManufacturerCount: knownAfter,
      coveragePercentage: partNumbers.length === 0
        ? 0
        : Number(((knownAfter / partNumbers.length) * 100).toFixed(2))
    }
  };

  if (options.dryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      selectedManufacturer: options.manufacturer,
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
