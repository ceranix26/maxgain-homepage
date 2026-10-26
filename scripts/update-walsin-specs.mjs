import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_PATH = path.join(ROOT, 'data', 'inventory-status.json');
const SPECS_PATH = path.join(ROOT, 'data', 'product-specs.json');
const BACKUP_PATH = path.join(ROOT, 'data', 'product-specs.backup.json');
const BASE_URL = 'https://www.passivecomponent.com';
const USER_AGENT = 'MAXGAIN-Walsin-Spec-Importer/1.0 (verified product specification lookup)';
const CANDIDATE_PATTERN = /^0402B[0-9A-Z]+CT$/;
const REQUEST_DELAY_MS = 1000;
const OVERWRITE = process.argv.includes('--overwrite');
const DRY_RUN = process.argv.includes('--dry-run');
const SPECS_FIELDS = [
  ['wk-series', 'Series'],
  ['wk-size', 'Case Size'],
  ['wk-dielectric', 'Dielectric'],
  ['wk-capacitance_value', 'Capacitance'],
  ['wk-tolerance', 'Tolerance'],
  ['wk-rated_voltage', 'Rated Voltage'],
  ['wk-l', 'Length'],
  ['wk-w', 'Width'],
  ['wk-t', 'Height'],
  ['wk-ir', 'Insulation Resistance'],
  ['wk-df', 'Dissipation Factor']
];

function parseArguments() {
  for (const argument of process.argv.slice(2)) {
    if (argument !== '--dry-run' && argument !== '--overwrite') {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
}

function decodeHtml(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: '\u00a0',
    quot: '"'
  };

  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, name) => {
    if (name[0] === '#') {
      const isHex = name[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(name.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }

    return namedEntities[name.toLowerCase()] ?? entity;
  });
}

function textFromHtml(html) {
  return decodeHtml(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .replaceAll('+-', '±');
}

function classNames(attributes) {
  const match = attributes.match(/\bclass\s*=\s*(['"])(.*?)\1/i);
  return match ? match[2].split(/\s+/) : [];
}

function getCellValue(rowHtml, className) {
  const cells = rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td\s*>/gi);
  for (const [, attributes, content] of cells) {
    if (classNames(attributes).includes(className)) {
      return textFromHtml(content);
    }
  }
  return '';
}

function getDocumentLinks(rowHtml) {
  const downloadCell = [...rowHtml.matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td\s*>/gi)]
    .find(([, attributes]) => classNames(attributes).includes('wk-download'));

  if (!downloadCell) return { dataSheetUrl: '', ecdUrl: '' };

  let dataSheetUrl = '';
  let ecdUrl = '';
  const anchors = downloadCell[2].matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi);

  for (const [, attributes, content] of anchors) {
    const href = attributes.match(/\bhref\s*=\s*(['"])(.*?)\1/i)?.[2];
    const title = textFromHtml(content);
    if (!href) continue;

    const url = safeOfficialUrl(href);
    if (!url) continue;
    if (/^datasheet$/i.test(title)) dataSheetUrl = url;
    if (/^ecd$/i.test(title)) ecdUrl = url;
  }

  return { dataSheetUrl, ecdUrl };
}

function safeOfficialUrl(value) {
  try {
    const url = new URL(decodeHtml(value), BASE_URL);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function isNumericDimension(value) {
  return /^\s*\d+(?:\.\d+)?(?:\s*(?:±|\+-|\+\/-)\s*\d+(?:\.\d+)?)?\s*$/.test(value);
}

function parseResultRows(html) {
  const rows = [];

  for (const [, rowHtml] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const partNumber = getCellValue(rowHtml, 'wk-part_number');
    if (!partNumber) continue;

    const specs = {};
    for (const [className, label] of SPECS_FIELDS) {
      let value = getCellValue(rowHtml, className);
      if (!value) continue;
      if (['Length', 'Width', 'Height'].includes(label) && isNumericDimension(value)) {
        value += ' mm';
      }
      specs[label] = value;
    }

    rows.push({
      partNumber,
      specs,
      ...getDocumentLinks(rowHtml)
    });
  }

  return rows;
}

function makeSpecification(row) {
  const result = {
    manufacturer: 'Walsin',
    category: 'MLCC',
    specs: row.specs
  };

  if (row.dataSheetUrl) {
    result.source = {
      title: 'Walsin Technology Datasheet',
      url: row.dataSheetUrl
    };
  }

  if (row.ecdUrl) {
    result.ecd = {
      title: 'Walsin ECD',
      url: row.ecdUrl
    };
  }

  return result;
}

function validateOutput(data, generatedPartNumbers) {
  if (!data || data.version !== 1 || !data.items || Array.isArray(data.items) ||
      typeof data.items !== 'object') {
    throw new Error('Generated specification data must have version 1 and an items object.');
  }

  for (const partNumber of generatedPartNumbers) {
    const item = data.items[partNumber];
    if (!CANDIDATE_PATTERN.test(partNumber) ||
        item?.manufacturer !== 'Walsin' ||
        item?.category !== 'MLCC' ||
        !item.specs ||
        Array.isArray(item.specs) ||
        typeof item.specs !== 'object') {
      throw new Error(`Invalid specification entry for ${partNumber}.`);
    }

    for (const [name, value] of Object.entries(item.specs)) {
      if (typeof name !== 'string' || typeof value !== 'string' || !value.trim()) {
        throw new Error(`Invalid specification field for ${partNumber}.`);
      }
    }

    for (const link of [item.source, item.ecd]) {
      if (link && (!link.title || !isHttpUrl(link.url))) {
        throw new Error(`Invalid source URL for ${partNumber}.`);
      }
    }
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function loadJson(filePath, label) {
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

async function fetchProduct(searchPartNumber) {
  const url = new URL('/product-search/', BASE_URL);
  url.searchParams.set('partnumber', searchPartNumber);

  const response = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'User-Agent': USER_AGENT
    },
    signal: AbortSignal.timeout(20_000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${searchPartNumber}`);
  }

  return parseResultRows(await response.text());
}

async function run() {
  parseArguments();

  const inventory = await loadJson(INVENTORY_PATH, 'inventory-status.json');
  const current = await loadJson(SPECS_PATH, 'product-specs.json');
  if (!inventory?.items || Array.isArray(inventory.items) || typeof inventory.items !== 'object') {
    throw new Error('inventory-status.json must contain an items object.');
  }
  if (!current || current.version !== 1 || !current.items ||
      Array.isArray(current.items) || typeof current.items !== 'object') {
    throw new Error('product-specs.json must contain version 1 and an items object.');
  }

  const candidates = Object.keys(inventory.items)
    .filter(partNumber => CANDIDATE_PATTERN.test(partNumber))
    .sort((a, b) => a.localeCompare(b));

  const output = {
    ...current,
    version: 1,
    items: { ...current.items }
  };
  const summary = {
    candidates: candidates.length,
    added: 0,
    existingSkipped: 0,
    notFound: 0,
    ambiguous: 0,
    errors: 0
  };
  const review = [];
  const generatedPartNumbers = new Set();
  let previousRequestAt = 0;

  for (const originalPartNumber of candidates) {
    if (Object.hasOwn(output.items, originalPartNumber) && !OVERWRITE) {
      summary.existingSkipped += 1;
      console.log(`SKIP existing: ${originalPartNumber}`);
      continue;
    }

    const searchPartNumber = originalPartNumber.slice(0, -2);
    const waitMs = REQUEST_DELAY_MS - (Date.now() - previousRequestAt);
    if (previousRequestAt && waitMs > 0) {
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
    previousRequestAt = Date.now();

    let rows;
    try {
      rows = await fetchProduct(searchPartNumber);
    } catch (error) {
      summary.errors += 1;
      console.error(`ERROR ${originalPartNumber} (search ${searchPartNumber}): ${error.message}`);
      continue;
    }

    const matchingRows = rows.filter(row => row.partNumber === searchPartNumber);
    if (matchingRows.length === 0) {
      summary.notFound += 1;
      console.log(`NOT FOUND: ${originalPartNumber} (search ${searchPartNumber})`);
      continue;
    }
    if (matchingRows.length > 1) {
      summary.ambiguous += 1;
      review.push({
        partNumber: originalPartNumber,
        searchPartNumber,
        matches: matchingRows.length
      });
      console.warn(`REVIEW ambiguous: ${originalPartNumber} (${matchingRows.length} exact matches)`);
      continue;
    }

    const specification = makeSpecification(matchingRows[0]);
    output.items[originalPartNumber] = specification;
    generatedPartNumbers.add(originalPartNumber);
    summary.added += 1;
    console.log(`${DRY_RUN ? 'WOULD ADD' : 'PREPARED'} ${originalPartNumber}:`);
    console.log(JSON.stringify(specification, null, 2));
  }

  validateOutput(output, generatedPartNumbers);
  if (summary.errors > 0) {
    console.error('No output written because one or more official lookups failed.');
  } else if (!DRY_RUN && summary.added > 0) {
    await fs.copyFile(SPECS_PATH, BACKUP_PATH);
    const temporaryPath = `${SPECS_PATH}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
      await fs.rename(temporaryPath, SPECS_PATH);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
    console.log(`Backup saved: ${path.relative(ROOT, BACKUP_PATH)}`);
  } else if (!DRY_RUN) {
    console.log('No new specifications to write; existing data was left unchanged.');
  } else {
    console.log('Dry run: product-specs.json and backup were not modified or created.');
  }

  if (review.length) {
    console.log('Review list:');
    console.log(JSON.stringify(review, null, 2));
  }

  console.log('Summary:');
  console.log(JSON.stringify(summary, null, 2));

  if (summary.errors > 0) process.exitCode = 1;
}

await run();
