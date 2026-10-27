import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const INVENTORY_PATH = path.join(DATA_DIR, 'inventory-status.json');
const SPECS_PATH = path.join(DATA_DIR, 'product-specs.json');
const ALIASES_PATH = path.join(DATA_DIR, 'product-aliases.json');
const REVIEW_PATH = path.join(DATA_DIR, 'johanson-technology-review.json');
const SPECS_BACKUP_PATH = path.join(DATA_DIR, 'product-specs.backup.json');
const ALIASES_BACKUP_PATH = path.join(DATA_DIR, 'product-aliases.backup.json');
const SEARCH_URL = 'https://www.johansontechnology.com/search/pn/';
const BASE_URL = 'https://www.johansontechnology.com';
const REQUEST_DELAY_MS = 1_000;
let lastRequestAt = 0;

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

async function readJson(filePath, label, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    if (error instanceof SyntaxError) throw new Error(`${label} contains invalid JSON.`);
    throw new Error(`Could not read ${label}: ${error.message}`);
  }
}

function requireItems(data, label, requireVersion = true) {
  if (!data || typeof data !== 'object' || Array.isArray(data) ||
      (requireVersion && data.version !== 1) ||
      !data.items || typeof data.items !== 'object' || Array.isArray(data.items)) {
    throw new Error(`${label} must contain ${requireVersion ? 'version 1 and ' : ''}an items object.`);
  }
  return data.items;
}

function decodeHtml(value) {
  const named = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: '\u00a0', quot: '"',
    ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“'
  };
  return value.replace(/&(#(?:x[\da-f]+|\d+)|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const codePoint = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : whole;
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

function htmlText(value) {
  return decodeHtml(value.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function attributesFromTag(tag) {
  const attributes = {};
  for (const [, name, quote, value] of tag.matchAll(/([^\s=]+)\s*=\s*(["'])(.*?)\2/g)) {
    attributes[name.toLowerCase()] = decodeHtml(value);
  }
  return attributes;
}

function safeJohansonUrl(value, allowRelative = false) {
  if (typeof value !== 'string' || !value.trim() ||
      /[\s\u0000-\u001f]/.test(value.trim())) return '';
  try {
    const url = new URL(value.trim(), allowRelative ? BASE_URL : undefined);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (url.hostname !== new URL(BASE_URL).hostname) return '';
    return url.href;
  } catch {
    return '';
  }
}

function labeledValues(html) {
  const fields = new Map();
  for (const [, tag, content] of html.matchAll(/<(dt|th|strong|label)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const label = htmlText(content).replace(/:\s*$/, '').toLowerCase();
    if (!label) continue;
    const remainderStart = html.indexOf(content) + content.length;
    const next = html.slice(remainderStart).match(/<(?:dd|td|span|div|p)\b[^>]*>([\s\S]*?)<\/(?:dd|td|span|div|p)\s*>/i)?.[1];
    if (next) fields.set(label, htmlText(next));
  }
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)]
      .map(([, cell]) => htmlText(cell));
    if (cells.length >= 2 && cells[0]) fields.set(cells[0].replace(/:\s*$/, '').toLowerCase(), cells.slice(1).join(' ').trim());
  }
  return fields;
}

function readNamedField(fields, names) {
  for (const name of names) {
    const value = fields.get(name.toLowerCase());
    if (value) return value;
  }
  return '';
}

function parseSearchResults(html) {
  const results = [];
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)].map(match => match[1]);
  const headers = rows.flatMap(row => {
    const headCells = [...row.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th\s*>/gi)];
    return headCells.map(([, cell]) => htmlText(cell));
  });
  const rowBlocks = rows.map(row => {
    const fields = labeledValues(row);
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)]
      .map(([, cell]) => htmlText(cell));
    if (headers.length && cells.length === headers.length) {
      headers.forEach((header, index) => {
        if (header && cells[index]) fields.set(header.toLowerCase(), cells[index]);
      });
    }
    return { html: row, fields };
  });
  const candidates = rowBlocks.length
    ? rowBlocks
    : [...html.matchAll(/<(?:article|li|div)\b[^>]*(?:result|product)[^>]*>([\s\S]*?)<\/(?:article|li|div)\s*>/gi)]
      .map(([, block]) => ({ html: block, fields: labeledValues(block) }));

  for (const { html: block, fields } of candidates) {
    const detailHref = [...block.matchAll(/<a\b([^>]*)>/gi)]
      .map(([, tag]) => attributesFromTag(tag).href || '')
      .find(href => /\/part\/[^/?#]+\/?/i.test(href));
    const safeDetailUrl = safeJohansonUrl(detailHref, true);
    const pathPartNumber = safeDetailUrl?.match(/\/part\/([^/?#]+)\/?/i)?.[1] || '';
    const globalPartNumber = readNamedField(fields, ['Part Number', 'Global Part Number']) || decodeHtml(pathPartNumber);
    const legacyPartNumber = readNamedField(fields, ['Legacy Part Number']);
    if (!globalPartNumber || !safeDetailUrl || !/\/part\/[^/?#]+\/?$/i.test(new URL(safeDetailUrl).pathname)) continue;

    results.push({
      globalPartNumber,
      legacyPartNumber,
      lifecycle: readNamedField(fields, ['Life Cycle Stage', 'Lifecycle Stage']),
      description: readNamedField(fields, ['Description']),
      detailUrl: safeDetailUrl
    });
  }
  return results;
}

function parseDetailPage(html, detailUrl) {
  const specs = {};
  const source = safeJohansonUrl(detailUrl);
  let infoPdf = '';

  const addSpec = (rawName, rawValue) => {
    const name = rawName.trim().replace(/\s+/g, ' ');
    const value = rawValue.trim();
    if (!name || !value ||
        /^(part number|global part number|legacy part number|description|life cycle stage|lifecycle stage)$/i.test(name) ||
        Object.hasOwn(specs, name)) return;
    specs[name] = value;
  };
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]\s*>/gi)]
      .map(([, cell]) => htmlText(cell));
    if (cells.length >= 2) addSpec(cells[0].replace(/:\s*$/, ''), cells.slice(1).join(' '));
  }
  for (const [, definitionList] of html.matchAll(/<dl\b[^>]*>([\s\S]*?)<\/dl\s*>/gi)) {
    const entries = [...definitionList.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt\s*>\s*<dd\b[^>]*>([\s\S]*?)<\/dd\s*>/gi)];
    for (const [, name, value] of entries) addSpec(htmlText(name), htmlText(value));
  }

  for (const [, attributes, anchorContents] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = attributesFromTag(attributes).href || '';
    if (!/\.pdf(?:[?#]|$)/i.test(href)) continue;
    const anchorText = htmlText(anchorContents);
    if (!/product|information|datasheet|data sheet|specification/i.test(anchorText) &&
        !/product|information|datasheet|specification/i.test(href)) continue;
    const resolved = safeJohansonUrl(href, true);
    if (resolved) {
      infoPdf = resolved;
      break;
    }
  }

  return { specs, source, infoPdf };
}

function normalizePartNumber(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function isHttpFailureStop(status) {
  return status === 401 || status === 403 || status === 429;
}

async function fetchHtml(url, onRequest, redirectCount = 0) {
  const wait = REQUEST_DELAY_MS - (Date.now() - lastRequestAt);
  if (lastRequestAt && wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  onRequest();
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'MAXGAIN Johanson Technology specification lookup/1.0'
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000)
  });

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error(`HTTP ${response.status} without redirect location`);
    if (redirectCount >= 5) throw new Error('Exceeded the maximum redirect count');
    const target = new URL(location, url);
    if (target.protocol !== 'https:' || target.hostname !== new URL(BASE_URL).hostname ||
        target.username || target.password) {
      throw new Error('Rejected non-official or non-HTTPS redirect');
    }
    return fetchHtml(target.href, onRequest, redirectCount + 1);
  }
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const contentType = response.headers.get('content-type') || '';
  if (!/text\/html/i.test(contentType)) {
    await response.body?.cancel();
    throw new Error('Official endpoint did not return HTML');
  }
  return response.text();
}

async function writeAtomic(filePath, content) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporary, filePath);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function backupIfPresent(filePath, backupPath) {
  try {
    await fs.copyFile(filePath, backupPath, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function mergeAlias(aliasMap, alias, primary) {
  const key = alias.trim();
  const normalizedAlias = normalizePartNumber(key);
  const currentEntry = Object.entries(aliasMap).find(([existing]) =>
    normalizePartNumber(existing) === normalizedAlias
  );
  if (currentEntry && normalizePartNumber(currentEntry[1]) !== normalizePartNumber(primary)) {
    return { conflict: { alias: key, existingPrimary: currentEntry[1], proposedPrimary: primary } };
  }
  if (!currentEntry) aliasMap[key] = primary;
  return { added: !currentEntry };
}

async function main() {
  const options = parseArguments();
  const inventoryData = await readJson(INVENTORY_PATH, 'inventory-status.json');
  const inventory = requireItems(inventoryData, 'inventory-status.json', false);
  const specsData = await readJson(SPECS_PATH, 'product-specs.json');
  const approvedSpecs = requireItems(specsData, 'product-specs.json');
  const aliasData = await readJson(ALIASES_PATH, 'product-aliases.json', { version: 1, aliases: {} });
  if (!aliasData || aliasData.version !== 1 || !aliasData.aliases ||
      typeof aliasData.aliases !== 'object' || Array.isArray(aliasData.aliases)) {
    throw new Error('product-aliases.json must contain version 1 and an aliases object.');
  }
  const existingReview = await readJson(REVIEW_PATH, 'johanson-technology-review.json', {
    version: 1,
    items: {}
  });
  const review = requireItems(existingReview, 'johanson-technology-review.json');
  const inventoryPartNumbers = Object.keys(inventory).filter(partNumber => partNumber.trim());
  const candidatePartNumbers = inventoryPartNumbers.slice(0, options.limit);
  const aliases = { ...aliasData.aliases };
  const reviewUpdates = {};
  const specUpdates = {};
  const summary = {
    inventoryTotal: inventoryPartNumbers.length,
    candidates: candidatePartNumbers.length,
    apiRequests: 0,
    exactGlobalMatches: 0,
    exactLegacyMatches: 0,
    ambiguous: 0,
    aliasesProposed: 0,
    specRecordsProposed: 0,
    review: 0,
    errors: 0
  };
  let stopped = false;

  for (const inventoryPartNumber of candidatePartNumbers) {
    const searchUrl = new URL(SEARCH_URL);
    searchUrl.searchParams.set('s', inventoryPartNumber);
    let searchResults;
    try {
      searchResults = parseSearchResults(await fetchHtml(searchUrl.href, () => {
        summary.apiRequests += 1;
      }));
    } catch (error) {
      summary.errors += 1;
      summary.review += 1;
      reviewUpdates[inventoryPartNumber] = {
        status: 'lookup-error',
        originalPartNumber: inventoryPartNumber,
        reason: error.message
      };
      console.error(`ERROR ${inventoryPartNumber}: ${error.message}`);
      if (isHttpFailureStop(error.status)) {
        stopped = true;
        break;
      }
      continue;
    }

    const key = normalizePartNumber(inventoryPartNumber);
    const exact = searchResults.filter(result =>
      normalizePartNumber(result.globalPartNumber) === key ||
      normalizePartNumber(result.legacyPartNumber) === key
    );
    const uniqueMatches = [...new Map(exact.map(result => [
      normalizePartNumber(result.globalPartNumber),
      result
    ])).values()];

    if (uniqueMatches.length > 1) {
      summary.ambiguous += 1;
      summary.review += 1;
      reviewUpdates[inventoryPartNumber] = {
        status: 'ambiguous-exact-matches',
        originalPartNumber: inventoryPartNumber,
        matches: uniqueMatches
      };
      console.log(`REVIEW ${inventoryPartNumber}: ${uniqueMatches.length} exact products`);
      continue;
    }
    if (!uniqueMatches.length) {
      summary.review += 1;
      reviewUpdates[inventoryPartNumber] = {
        status: 'no-exact-match',
        originalPartNumber: inventoryPartNumber
      };
      continue;
    }

    const match = uniqueMatches[0];
    const matchedByGlobal = normalizePartNumber(match.globalPartNumber) === key;
    if (matchedByGlobal) summary.exactGlobalMatches += 1;
    else summary.exactLegacyMatches += 1;

    const aliasesForProduct = [...new Set([match.globalPartNumber, match.legacyPartNumber]
      .filter(value => typeof value === 'string' && value.trim()))];
    const aliasConflicts = [];
    const proposedAliases = { ...aliases };
    let aliasCount = 0;
    for (const alias of aliasesForProduct) {
      const result = mergeAlias(proposedAliases, alias, match.globalPartNumber);
      if (result.conflict) aliasConflicts.push(result.conflict);
      else if (result.added) aliasCount += 1;
    }
    if (!aliasConflicts.length) {
      Object.assign(aliases, proposedAliases);
      summary.aliasesProposed += aliasCount;
    }

    let detail;
    try {
      const detailHtml = await fetchHtml(match.detailUrl, () => {
        summary.apiRequests += 1;
      });
      detail = parseDetailPage(detailHtml, match.detailUrl);
    } catch (error) {
      summary.errors += 1;
      summary.review += 1;
      reviewUpdates[inventoryPartNumber] = {
        status: 'detail-lookup-error',
        originalPartNumber: inventoryPartNumber,
        ...match,
        reason: error.message
      };
      console.error(`ERROR detail ${match.globalPartNumber}: ${error.message}`);
      if (isHttpFailureStop(error.status)) {
        stopped = true;
        break;
      }
      continue;
    }

    const record = {
      manufacturer: 'Johanson Technology',
      partNumbers: {
        primary: match.globalPartNumber,
        ...(match.legacyPartNumber ? { legacy: [match.legacyPartNumber] } : {})
      },
      ...(match.lifecycle ? { lifecycle: match.lifecycle } : {}),
      ...(match.description ? { description: match.description } : {}),
      source: {
        type: 'manufacturer',
        name: 'Johanson Technology',
        title: 'Johanson Technology Product Data',
        url: detail.source
      },
      ...(detail.infoPdf ? { sourceDocument: { title: 'Product Information PDF', url: detail.infoPdf } } : {})
    };

    const hasExistingSpec = Object.hasOwn(approvedSpecs, match.globalPartNumber);
    if (aliasConflicts.length) {
      summary.review += 1;
      reviewUpdates[inventoryPartNumber] = {
        status: 'alias-conflict',
        originalPartNumber: inventoryPartNumber,
        ...match,
        conflicts: aliasConflicts,
        record
      };
      console.warn(`REVIEW ${inventoryPartNumber}: alias mapping conflict`);
    } else if (Object.keys(detail.specs).length && (!hasExistingSpec || options.overwrite)) {
      record.specs = detail.specs;
      specUpdates[match.globalPartNumber] = record;
      summary.specRecordsProposed += 1;
      console.log(`${options.dryRun ? 'WOULD ADD' : 'PREPARED'} ${match.globalPartNumber} (legacy: ${match.legacyPartNumber || 'none'})`);
      console.log(JSON.stringify(record, null, 2));
    } else {
      summary.review += 1;
      reviewUpdates[inventoryPartNumber] = {
        status: hasExistingSpec && !options.overwrite ? 'existing-specification' : 'insufficient-structured-specifications',
        originalPartNumber: inventoryPartNumber,
        ...match,
        specsFound: Object.keys(detail.specs).length,
        record
      };
      console.log(`REVIEW ${inventoryPartNumber}: ${reviewUpdates[inventoryPartNumber].status}`);
    }
  }

  if (options.dryRun) {
    console.log('Dry run: JSON files and backups were not modified or created.');
  } else if (!stopped && summary.errors === 0) {
    const mergedSpecs = { ...approvedSpecs, ...specUpdates };
    const mergedReview = { ...review, ...reviewUpdates };
    const specsOutput = `${JSON.stringify({ ...specsData, items: mergedSpecs }, null, 2)}\n`;
    const reviewOutput = `${JSON.stringify({ ...existingReview, version: 1, items: mergedReview }, null, 2)}\n`;
    const aliasesOutput = `${JSON.stringify({ ...aliasData, version: 1, aliases }, null, 2)}\n`;

    if (Object.keys(specUpdates).length) await backupIfPresent(SPECS_PATH, SPECS_BACKUP_PATH);
    if (summary.aliasesProposed) await backupIfPresent(ALIASES_PATH, ALIASES_BACKUP_PATH);
    await fs.mkdir(DATA_DIR, { recursive: true });
    if (summary.aliasesProposed) await writeAtomic(ALIASES_PATH, aliasesOutput);
    if (Object.keys(specUpdates).length) await writeAtomic(SPECS_PATH, specsOutput);
    if (Object.keys(reviewUpdates).length) await writeAtomic(REVIEW_PATH, reviewOutput);
  } else {
    console.error('Outputs were not written because lookups did not complete successfully.');
  }

  console.log('Summary:');
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Johanson specification lookup failed.');
  process.exitCode = 1;
}
