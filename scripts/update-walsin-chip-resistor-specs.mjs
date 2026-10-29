import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const INVENTORY_PATH = path.join(DATA_DIR, 'inventory-status.json');
const MANUFACTURERS_PATH = path.join(DATA_DIR, 'product-manufacturers.json');
const SPECS_PATH = path.join(DATA_DIR, 'product-specs.json');
const REVIEW_PATH = path.join(DATA_DIR, 'walsin-chip-resistor-review.json');
const BASE_URL = 'https://www.passivecomponent.com';
const SEARCH_PATH = '/product-search/ChipR/';
const USER_AGENT = 'MAXGAIN-Walsin-Spec-Importer/1.0 (verified product specification lookup)';
const CANDIDATE_PATTERN = /^W[RAFW][0-9A-Z]{6,}$/;
const REQUEST_DELAY_MS = 1000;
const SAVE_EVERY = 25;
const LABELS = {
  series: 'Series',
  size: 'Case Size',
  resistance_value: 'Resistance',
  tolerance: 'Tolerance',
  tcr: 'TCR',
  ratedpower: 'Rated Power',
  packaging: 'Packaging',
  termination: 'Termination'
};
const SKIP_CLASSES = new Set(['wk-part_number', 'wk-download', 'wk-hidden']);

function parseArguments() {
  const options = { dryRun: false, retry: false, limit: Infinity, partNumber: '' };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dry-run') options.dryRun = true;
    else if (args[i] === '--retry') options.retry = true;
    else if (args[i] === '--limit') {
      const value = args[++i];
      if (!/^\d+$/.test(value ?? '') || Number(value) < 1) {
        throw new Error('--limit requires a positive integer.');
      }
      options.limit = Number(value);
    } else if (args[i] === '--part-number') {
      options.partNumber = args[++i] ?? '';
      if (!options.partNumber) throw new Error('--part-number requires a value.');
    } else throw new Error(`Unknown argument: ${args[i]}`);
  }
  return options;
}

function decodeHtml(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (entity, name) => {
    if (name[0] === '#') {
      const hex = name[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return named[name.toLowerCase()] ?? entity;
  });
}

function textFromHtml(html) {
  return decodeHtml(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().replaceAll('+-', '±');
}

const normalize = value => String(value ?? '').replace(/\s+/g, '').toUpperCase();

function safeOfficialUrl(value) {
  try {
    const url = new URL(decodeHtml(value), BASE_URL);
    return url.hostname === 'www.passivecomponent.com' && url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

// Result cells are not always closed, so split on cell openings instead of matching pairs.
function parseRows(html) {
  const rows = [];
  for (const [, rowHtml] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/tbody|<\/table|$)/gi)) {
    const cells = [];
    const parts = rowHtml.split(/<td\b/i).slice(1);
    for (const part of parts) {
      const open = part.match(/^([^>]*)>([\s\S]*)$/);
      if (!open) continue;
      const className = open[1].match(/\bclass\s*=\s*(['"])(.*?)\1/i)?.[2] ?? '';
      cells.push({ classes: className.split(/\s+/).filter(Boolean), html: open[2].replace(/<\/td\s*>[\s\S]*$/i, '') });
    }
    const partCell = cells.find(cell => cell.classes.includes('wk-part_number'));
    if (!partCell) continue;
    const specs = {};
    let datasheetUrl = '';
    for (const cell of cells) {
      if (cell.classes.includes('wk-download')) {
        const href = cell.html.match(/<a\b[^>]*\bhref\s*=\s*(['"])(.*?)\1/i)?.[2];
        if (href) datasheetUrl = safeOfficialUrl(href);
        continue;
      }
      if (cell.classes.some(name => SKIP_CLASSES.has(name))) continue;
      const key = cell.classes.find(name => name.startsWith('wk-'))?.slice(3);
      const label = key && LABELS[key];
      const value = textFromHtml(cell.html);
      if (label && value) specs[label] = value;
    }
    rows.push({ partNumber: normalize(textFromHtml(partCell.html)), specs, datasheetUrl });
  }
  return rows;
}

async function search(term) {
  const url = new URL(SEARCH_PATH, BASE_URL);
  url.searchParams.set('partnumber', term);
  const response = await fetch(url, {
    headers: { Accept: 'text/html', 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${term}`);
  return parseRows(await response.text());
}

async function loadJson(filePath, label, fallback) {
  let contents;
  try {
    contents = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (fallback !== undefined && error.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${label}: ${error.message}`);
  }
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

async function writeJson(filePath, data) {
  const temporary = `${filePath}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, filePath);
}

function makeSpecification(row) {
  return {
    manufacturer: 'Walsin',
    category: 'Chip Resistor',
    specs: row.specs,
    ...(row.datasheetUrl ? { source: { title: 'Walsin Technology Datasheet', url: row.datasheetUrl } } : {})
  };
}

async function run() {
  const options = parseArguments();
  const inventory = (await loadJson(INVENTORY_PATH, 'inventory-status.json')).items;
  const manufacturersData = await loadJson(MANUFACTURERS_PATH, 'product-manufacturers.json');
  const specsData = await loadJson(SPECS_PATH, 'product-specs.json');
  const reviewData = await loadJson(REVIEW_PATH, 'walsin-chip-resistor-review.json', { version: 1, items: {} });
  const manufacturers = { ...manufacturersData.items };
  const specs = { ...specsData.items };
  const review = { ...reviewData.items };

  let candidates = Object.keys(manufacturers).filter(partNumber =>
    manufacturers[partNumber].manufacturer === 'Walsin' &&
    CANDIDATE_PATTERN.test(partNumber) &&
    inventory[partNumber] &&
    !specs[partNumber] &&
    (options.retry || !review[partNumber])
  );
  if (options.partNumber) {
    candidates = candidates.filter(partNumber => normalize(partNumber) === normalize(options.partNumber));
    if (!candidates.length) throw new Error(`${options.partNumber} is not an eligible Walsin chip resistor candidate.`);
  }
  candidates.sort((a, b) =>
    Number(inventory[b].status === 'in-stock') - Number(inventory[a].status === 'in-stock') ||
    (a < b ? -1 : a > b ? 1 : 0));
  candidates = candidates.slice(0, options.limit);

  const summary = { candidates: candidates.length, added: 0, verifiedUpgraded: 0, notFound: 0, ambiguous: 0, errors: 0 };
  let previousRequestAt = 0;
  let sinceSave = 0;

  const throttle = async () => {
    const wait = REQUEST_DELAY_MS - (Date.now() - previousRequestAt);
    if (previousRequestAt && wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    previousRequestAt = Date.now();
  };

  const save = async () => {
    if (options.dryRun) return;
    await writeJson(SPECS_PATH, { ...specsData, version: 1, items: specs });
    await writeJson(MANUFACTURERS_PATH, {
      ...manufacturersData,
      updatedAt: new Date().toISOString(),
      items: manufacturers
    });
    await writeJson(REVIEW_PATH, { ...reviewData, version: 1, items: review });
    sinceSave = 0;
  };

  for (const partNumber of candidates) {
    const target = normalize(partNumber);
    let matches;
    try {
      // Official data may hold a space before the suffix, so retry with the stem when the full PN misses.
      for (const term of [partNumber, partNumber.slice(0, -3)]) {
        await throttle();
        matches = (await search(term)).filter(row => row.partNumber === target);
        if (matches.length) break;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(`ERROR ${partNumber}: ${error.message}`);
      continue;
    }

    if (!matches.length) {
      summary.notFound += 1;
      review[partNumber] = { status: 'no-exact-match' };
    } else if (matches.length > 1 || !Object.keys(matches[0].specs).length) {
      summary.ambiguous += 1;
      review[partNumber] = { status: matches.length > 1 ? 'ambiguous-exact-matches' : 'no-official-specifications' };
    } else {
      specs[partNumber] = makeSpecification(matches[0]);
      delete review[partNumber];
      summary.added += 1;
      if (manufacturers[partNumber].confidence !== 'verified') {
        manufacturers[partNumber] = {
          manufacturer: 'Walsin',
          source: 'official-product-search',
          confidence: 'verified'
        };
        summary.verifiedUpgraded += 1;
      }
      if (options.dryRun && summary.added <= 3) console.log(partNumber, JSON.stringify(specs[partNumber], null, 2));
    }
    sinceSave += 1;
    if (sinceSave >= SAVE_EVERY) await save();
  }

  await save();
  console.log(JSON.stringify({ mode: options.dryRun ? 'dry-run' : 'complete', ...summary }));
  if (summary.errors) process.exitCode = 1;
}

await run();
