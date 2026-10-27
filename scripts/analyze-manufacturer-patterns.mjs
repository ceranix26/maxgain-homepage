import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyWalsinMlcc,
  classifyWalsinResistor,
  RESISTOR_FAMILIES
} from './walsin-pattern-classifier.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_PATH = path.join(ROOT, 'data', 'inventory-status.json');
const MANUFACTURERS_PATH = path.join(ROOT, 'data', 'product-manufacturers.json');
const SAMPLE_HIGH = process.argv.includes('--sample-high');
const comparePartNumbers = (left, right) => left < right ? -1 : left > right ? 1 : 0;

async function readJson(filePath, label) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read ${label}: ${error.message}`);
  }
}

function requireItems(data, label) {
  if (!data || !data.items || typeof data.items !== 'object' || Array.isArray(data.items)) {
    throw new Error(`${label} must contain an items object.`);
  }
  return data.items;
}

function getKnownManufacturerRecords(manufacturers) {
  return Object.entries(manufacturers).filter(([, record]) =>
    record && typeof record === 'object' && typeof record.manufacturer === 'string'
  );
}

function structuralPattern(partNumber) {
  return partNumber
    .replace(/\d+/g, '#')
    .replace(/[A-Z]+/g, match => match);
}

function evenlySample(sortedItems, limit) {
  if (sortedItems.length <= limit) return sortedItems;

  return Array.from({ length: limit }, (_, index) => {
    const position = Math.floor(((index + 0.5) * sortedItems.length) / limit);
    return sortedItems[position];
  });
}

async function main() {
  const inventory = requireItems(
    await readJson(INVENTORY_PATH, 'inventory-status.json'),
    'inventory-status.json'
  );
  const manufacturers = requireItems(
    await readJson(MANUFACTURERS_PATH, 'product-manufacturers.json'),
    'product-manufacturers.json'
  );

  const partNumbers = Object.keys(inventory);
  const verifiedWalsin = new Set(
    getKnownManufacturerRecords(manufacturers)
      .filter(([, record]) =>
        record.manufacturer.trim().toLowerCase() === 'walsin' &&
        record.confidence === 'verified'
      )
      .map(([partNumber]) => partNumber)
  );

  const mlccCandidates = [];
  const resistorHigh = [];
  const resistorReview = [];
  const resistorHighByFamily = new Map();
  const resistorHighBySize = new Map();
  const conflicts = [];

  for (const partNumber of partNumbers) {
    const mlcc = classifyWalsinMlcc(partNumber);
    if (mlcc) {
      mlccCandidates.push({
        partNumber,
        family: mlcc.family,
        sizeCode: mlcc.sizeCode,
        reason: mlcc.reason,
        pattern: mlcc.pattern
      });
    }

    const resistor = classifyWalsinResistor(partNumber);
    if (!resistor) continue;

    if (resistor.pattern === 'pattern-high') {
      resistorHigh.push({
        partNumber,
        family: resistor.family,
        sizeCode: resistor.sizeCode,
        reason: resistor.reason
      });
      resistorHighByFamily.set(resistor.family, (resistorHighByFamily.get(resistor.family) ?? 0) + 1);
      resistorHighBySize.set(resistor.sizeCode, (resistorHighBySize.get(resistor.sizeCode) ?? 0) + 1);
    } else {
      resistorReview.push({
        partNumber,
        family: resistor.family,
        sizeCode: resistor.sizeCode,
        reason: resistor.reason
      });
    }

    const manufacturerRecord = manufacturers[partNumber];
    if (manufacturerRecord && typeof manufacturerRecord.manufacturer === 'string') {
      const manufacturer = manufacturerRecord.manufacturer.trim();
      if (manufacturer && manufacturer.toLowerCase() !== 'walsin') {
        conflicts.push({
          partNumber,
          family: resistor.family,
          sizeCode: resistor.sizeCode,
          knownManufacturer: manufacturer,
          pattern: resistor.pattern,
          reason: resistor.reason
        });
      }
    }
  }

  const mlccHighCount = mlccCandidates.length;
  const resistorHighCount = resistorHigh.length;
  const totalUniqueWalsinPatternHigh = new Set(resistorHigh.map(item => item.partNumber)).size + mlccHighCount;
  const resistorReviewCount = resistorReview.length;

  const reviewSample = resistorReview.slice(0, 50);
  const nearMatches = partNumbers
    .filter(partNumber =>
      /^[A-Z]{2,4}\d{2,4}/.test(partNumber) &&
      !classifyWalsinMlcc(partNumber) &&
      !classifyWalsinResistor(partNumber)
    )
    .slice(0, 20)
    .map(partNumber => ({
      partNumber,
      reason: 'Family and size are not both present in the official Walsin resistor catalog shape, or the ordering pattern is not consistent with the catalog.'
    }));

  if (SAMPLE_HIGH) {
    const candidateMlcc = mlccCandidates
      .filter(item => !verifiedWalsin.has(item.partNumber))
      .sort((left, right) => comparePartNumbers(left.partNumber, right.partNumber));
    const mlccSample = evenlySample(candidateMlcc, 10);
    const resistorCandidatesByFamily = new Map();
    for (const candidate of resistorHigh) {
      if (verifiedWalsin.has(candidate.partNumber)) continue;
      const familyCandidates = resistorCandidatesByFamily.get(candidate.family) ?? [];
      familyCandidates.push(candidate);
      resistorCandidatesByFamily.set(candidate.family, familyCandidates);
    }

    const sampleLimits = { WR: 20, WA: 5, WW: 5, WF: 5 };
    const resistorSample = [];
    for (const family of Object.keys(RESISTOR_FAMILIES)) {
      const familyCandidates = (resistorCandidatesByFamily.get(family) ?? [])
        .sort((left, right) => comparePartNumbers(left.partNumber, right.partNumber));
      const limit = sampleLimits[family] ?? (
        familyCandidates.length <= 5 ? familyCandidates.length : 0
      );
      if (limit > 0) resistorSample.push(...evenlySample(familyCandidates, limit));
    }

    const formatSample = item => ({
      'Part Number': item.partNumber,
      family: item.family,
      size: item.sizeCode,
      'matched pattern': 'pattern-high',
      'classification reason': item.reason
    });

    console.log(JSON.stringify({
      mode: 'sample-high',
      MLCC: mlccSample.map(formatSample),
      resistors: resistorSample.map(formatSample)
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    totalInventoryPartNumbers: partNumbers.length,
    alreadyVerifiedWalsin: verifiedWalsin.size,
    totalUniqueWalsinPatternHigh,
    totalPatternReview: resistorReviewCount,
    mlccPatternHighCount: mlccHighCount,
    resistorPatternHighCount: resistorHighCount,
    resistorBreakdownByFamily: Object.fromEntries(
      [...resistorHighByFamily].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    ),
    resistorBreakdownBySizeCode: Object.fromEntries(
      [...resistorHighBySize].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    ),
    patternHighCandidateList: resistorHigh,
    patternReviewFirst50: reviewSample,
    conflictsWithKnownNonWalsinManufacturers: conflicts,
    mlccPatternHighCandidateList: mlccCandidates,
    nearMatchesOutsideCatalogStructure: nearMatches
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Manufacturer pattern analysis failed.');
  process.exitCode = 1;
}
