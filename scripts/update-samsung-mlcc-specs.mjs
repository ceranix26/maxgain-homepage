import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const INVENTORY_PATH = path.join(DATA_DIR, 'inventory-status.json');
const MANUFACTURERS_PATH = path.join(DATA_DIR, 'product-manufacturers.json');
const SPECS_PATH = path.join(DATA_DIR, 'product-specs.json');
const REVIEW_PATH = path.join(DATA_DIR, 'samsung-mlcc-review.json');
const UNRESOLVED_PATH = path.join(DATA_DIR, 'samsung-mlcc-unresolved.json');
const SEARCH_URL = 'https://product.samsungsem.com/mlcc/basic-search.do';
const MANUFACTURER = 'Samsung Electro-Mechanics';
const REQUEST_DELAY_MS = 1_000;
const MAX_DETAIL_REQUESTS = 100;
const USER_AGENT = 'MAXGAIN-Samsung-MLCC-Importer/1.0 (official product data)';
const DATA_FIELDS = [
  ['Status', ['status', 'product status', 'lifecycle status']],
  ['Characteristics', ['characteristics', 'characteristic']],
  ['Features', ['features', 'feature']],
  ['Capacitance', ['capacitance', 'capacitance value']],
  ['Tolerance', ['tolerance', 'capacitance tolerance']],
  ['Rated Voltage', ['rated voltage', 'voltage rating', 'voltage']],
  ['TCC / Temperature Characteristic', [
    'tcc', 'temperature characteristic', 'temperature coefficient', 'dielectric'
  ]],
  ['Size Code', ['size code', 'case size', 'size']],
  ['L Size', ['l size', 'length', 'l dimension', 'l (mm)', 'length (mm)']],
  ['W Size', ['w size', 'width', 'w dimension', 'w (mm)', 'width (mm)']],
  ['T Size', ['t size', 'thickness', 'height', 't dimension', 't (mm)', 'thickness (mm)']],
  ['Derating', ['derating', 'voltage derating']],
  ['Application / Reliability', [
    'application / reliability', 'application/reliability', 'application',
    'reliability', 'qualification'
  ]]
];
const PART_NUMBER_KEYS = new Set([
  'part number', 'partnumber', 'product name', 'productname', 'model name',
  'modelname', 'product number', 'productnumber', 'part no', 'part no.',
  'item name', '품명'
]);
const DETAIL_URL_KEYS = new Set([
  'detail url', 'detailurl', 'product url', 'producturl', 'product page',
  'productpage', 'detail page', 'detailpage'
]);
const RELATED_PART_KEYS = new Set([
  'alternate part number', 'alternate part numbers', 'alternative part number',
  'alternative part numbers', 'package variant', 'package variants',
  'related part number', 'related part numbers'
]);
const DATASHEET_KEYS = new Set(['datasheet', 'data sheet', 'datasheet url', 'data sheet url']);
const SPECSHEET_KEYS = new Set(['specsheet', 'spec sheet', 'specsheet url', 'spec sheet url']);
let lastDetailRequestAt = 0;

function parseArguments() {
  const options = { dryRun: false, retry: false, limit: Infinity, partNumber: '' };
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--retry') {
      options.retry = true;
    } else if (argument === '--limit') {
      const raw = args[++index];
      if (!raw || !/^\d+$/.test(raw) || Number(raw) < 1) {
        throw new Error('--limit requires a positive integer.');
      }
      options.limit = Number(raw);
    } else if (argument === '--part-number') {
      const value = args[++index];
      if (!value || value.startsWith('--') || !value.trim() || options.partNumber) {
        throw new Error('--part-number requires one non-empty Part Number.');
      }
      options.partNumber = value;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (options.partNumber && Number.isFinite(options.limit)) {
    throw new Error('--part-number cannot be combined with --limit.');
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

function normalizeLabel(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizePartNumber(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeSamsungUrl(value, base = SEARCH_URL) {
  if (typeof value !== 'string' || !value.trim() || /[\s\u0000-\u001f]/.test(value.trim())) {
    return '';
  }
  try {
    const url = new URL(value.trim(), base);
    if (url.protocol !== 'https:' || url.username || url.password ||
        !(url.hostname === 'samsungsem.com' || url.hostname.endsWith('.samsungsem.com'))) {
      return '';
    }
    return url.href;
  } catch {
    return '';
  }
}

function textFromHtml(value) {
  return String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function valuesFromStructuredRecord(record) {
  const values = new Map();
  let partNumber = '';
  let detailUrl = '';
  let datasheetUrl = '';
  let specsheetUrl = '';
  const relatedPartNumbers = [];

  const entries = [];
  const flatten = value => {
    if (Array.isArray(value)) {
      return;
    } else if (value && typeof value === 'object') {
      for (const [key, nestedValue] of Object.entries(value)) {
        if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
          const normalizedParent = normalizeLabel(key);
          if (DATASHEET_KEYS.has(normalizedParent) || SPECSHEET_KEYS.has(normalizedParent)) {
            for (const [childKey, childValue] of Object.entries(nestedValue)) {
              if (normalizeLabel(childKey) === 'url' && typeof childValue === 'string') {
                entries.push([`${key} url`, childValue]);
              }
            }
          } else {
            flatten(nestedValue);
          }
        } else if (Array.isArray(nestedValue) &&
            nestedValue.length > 0 &&
            nestedValue.every(item => item && typeof item === 'object' && !Array.isArray(item))) {
          for (const item of nestedValue) {
            const label = item.name ?? item.label ?? item.key ?? item.attribute;
            const fieldValue = item.value ?? item.content ?? item.text;
            if (typeof label === 'string' && fieldValue !== undefined) {
              entries.push([label, fieldValue]);
            } else {
              flatten(item);
            }
          }
        } else entries.push([key, nestedValue]);
      }
    }
  };
  flatten(record);
  for (const [rawKey, value] of entries) {
    const key = normalizeLabel(rawKey);
    const compactKey = key.replace(/\s+/g, '');
    if (PART_NUMBER_KEYS.has(key) || PART_NUMBER_KEYS.has(compactKey)) {
      if (typeof value === 'string' && !partNumber) partNumber = value.trim();
      continue;
    }
    if (DETAIL_URL_KEYS.has(key) || DETAIL_URL_KEYS.has(compactKey)) {
      if (typeof value === 'string' && !detailUrl) detailUrl = value;
      continue;
    }
    if (DATASHEET_KEYS.has(key) || DATASHEET_KEYS.has(compactKey)) {
      if (typeof value === 'string' && !datasheetUrl) datasheetUrl = value;
      continue;
    }
    if (SPECSHEET_KEYS.has(key) || SPECSHEET_KEYS.has(compactKey)) {
      if (typeof value === 'string' && !specsheetUrl) specsheetUrl = value;
      continue;
    }
    if (RELATED_PART_KEYS.has(key) || RELATED_PART_KEYS.has(compactKey)) {
      const relatedValues = Array.isArray(value) ? value : [value];
      for (const entry of relatedValues) {
        if (typeof entry === 'string' && entry.trim()) relatedPartNumbers.push(entry.trim());
      }
      continue;
    }
    const field = DATA_FIELDS.find(([, aliases]) =>
      aliases.some(alias => normalizeLabel(alias) === key)
    );
    if (field && (
      typeof value === 'string' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      Array.isArray(value)
    )) {
      const text = Array.isArray(value)
        ? value.filter(entry => typeof entry === 'string' || typeof entry === 'number')
          .join(', ').trim()
        : String(value).trim();
      if (text) values.set(field[0], text);
    }
  }
  return {
    partNumber,
    detailUrl: safeSamsungUrl(detailUrl),
    datasheetUrl: safeSamsungUrl(datasheetUrl),
    specsheetUrl: safeSamsungUrl(specsheetUrl),
    relatedPartNumbers,
    specs: Object.fromEntries(values)
  };
}

function collectStructuredProducts(value, products) {
  if (Array.isArray(value)) {
    for (const entry of value) collectStructuredProducts(entry, products);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const product = valuesFromStructuredRecord(value);
  if (product.partNumber) products.push(product);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') collectStructuredProducts(child, products);
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  row.push(field);
  if (row.some(cell => cell.trim())) rows.push(row);
  if (rows.length < 2) return [];

  const [headers, ...dataRows] = rows;
  return dataRows.map(cells => Object.fromEntries(headers.map((header, index) => [
    header.trim(),
    (cells[index] ?? '').trim()
  ])));
}

function parseHtmlProducts(html, baseUrl) {
  const products = [];
  for (const [, attributes, content] of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  )) {
    if (!/\btype\s*=\s*(['"])application\/(?:ld\+)?json\1/i.test(attributes)) continue;
    try {
      const embeddedProducts = [];
      collectStructuredProducts(JSON.parse(content), embeddedProducts);
      products.push(...embeddedProducts);
    } catch (error) {
      throw new Error(`Samsung page contains invalid embedded product JSON: ${error.message}`);
    }
  }
  for (const [, table] of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table\s*>/gi)) {
    const rowMatches = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)];
    const rows = rowMatches.map(([, row]) => [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi)]
      .map(([, cell]) => textFromHtml(cell)));
    const headerIndex = rows.findIndex(row =>
      row.some(cell => PART_NUMBER_KEYS.has(normalizeLabel(cell)))
    );
    if (headerIndex < 0) continue;
    const headers = rows[headerIndex].map(normalizeLabel);
    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const cells = rows[rowIndex];
      const record = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
      const product = valuesFromStructuredRecord(record);
      if (!product.partNumber) continue;
      const rowHtml = rowMatches[rowIndex][1];
      const detailHref = rowHtml.match(/<a\b[^>]*href\s*=\s*(['"])(.*?)\1/i)?.[2];
      if (!product.detailUrl && detailHref) product.detailUrl = safeSamsungUrl(detailHref, baseUrl);
      products.push(product);
    }
  }
  return [...new Map(products.map(product => [
    `${product.partNumber}\u0000${product.detailUrl}`,
    product
  ])).values()];
}

function parseOfficialData(body, contentType, url) {
  const trimmed = body.trim().replace(/^\)\]\}',?\s*/, '');
  if (/json/i.test(contentType) || /^[\[{]/.test(trimmed)) {
    try {
      const products = [];
      collectStructuredProducts(JSON.parse(trimmed), products);
      if (products.length) return products;
    } catch (error) {
      if (/json/i.test(contentType)) throw new Error(`Official bulk data is invalid JSON: ${error.message}`);
    }
  }
  if (/csv|text\/plain/i.test(contentType) || /\.csv(?:$|[?#])/i.test(url)) {
    const products = [];
    for (const row of parseCsv(body)) {
      const product = valuesFromStructuredRecord(row);
      if (product.partNumber) products.push(product);
    }
    if (products.length) return products;
  }
  const htmlProducts = parseHtmlProducts(body, url);
  if (htmlProducts.length) return htmlProducts;
  throw new Error('Samsung official page did not expose a parseable MLCC product list or bulk dataset.');
}

function findBulkLinks(html, baseUrl) {
  const candidates = [];
  for (const [, tag, content] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = tag.match(/\bhref\s*=\s*(['"])(.*?)\1/i)?.[2];
    if (!href) continue;
    const url = safeSamsungUrl(href, baseUrl);
    const label = `${textFromHtml(content)} ${href}`;
    if (url && /(download|excel|spreadsheet|\.csv|\.json|product.?list|mlcc.?list)/i.test(label)) {
      candidates.push({
        url,
        score: /\.csv(?:$|[?#])/i.test(url) ? 4 :
          /excel|spreadsheet/i.test(label) ? 3 :
            /download/i.test(label) ? 2 : 1
      });
    }
  }
  return [...new Map(candidates
    .sort((left, right) => right.score - left.score)
    .map(candidate => [candidate.url, candidate])).values()];
}

async function fetchOfficial(url, accept) {
  let safeUrl = safeSamsungUrl(url);
  if (!safeUrl) throw new Error('Refusing to request a non-Samsung URL.');
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(safeUrl, {
      headers: { Accept: accept, 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000)
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const redirectedUrl = location ? safeSamsungUrl(location, safeUrl) : '';
      if (!redirectedUrl) {
        throw new Error(`Samsung request redirected outside the approved domain: ${safeUrl}`);
      }
      safeUrl = redirectedUrl;
      continue;
    }
    if (!response.ok) {
      throw new Error(`Samsung request failed with HTTP ${response.status}: ${safeUrl}`);
    }
    return {
      body: await response.text(),
      contentType: response.headers.get('content-type') ?? '',
      url: safeUrl
    };
  }
  throw new Error('Samsung request exceeded the redirect limit.');
}

async function loadOfficialProducts() {
  const entry = await fetchOfficial(SEARCH_URL, 'text/html,application/json');
  let products;
  try {
    products = parseOfficialData(entry.body, entry.contentType, entry.url);
  } catch {
    const links = findBulkLinks(entry.body, entry.url);
    let lastError;
    for (const link of links) {
      try {
        const bulk = await fetchOfficial(link.url, 'application/json,text/csv,text/html,*/*');
        products = parseOfficialData(bulk.body, bulk.contentType, bulk.url);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!products?.length) {
      throw new Error(lastError?.message ??
        'Samsung search page has no embedded product list or discoverable official bulk-data link.');
    }
  }
  return products;
}

function makeOfficialIndex(products) {
  const index = new Map();
  for (const product of products) {
    const partNumber = normalizePartNumber(product.partNumber);
    if (!partNumber) continue;
    const record = {
      ...product,
      partNumber,
      detailUrl: safeSamsungUrl(product.detailUrl),
      relatedPartNumbers: [...new Set(product.relatedPartNumbers
        .map(normalizePartNumber)
        .filter(value => value && value !== partNumber))]
    };
    const list = index.get(partNumber) ?? [];
    list.push(record);
    index.set(partNumber, list);
  }
  return index;
}

function makeRelatedPartIndex(officialIndex) {
  const index = new Map();
  for (const [canonicalPartNumber, records] of officialIndex) {
    for (const product of records) {
      for (const relatedPartNumber of product.relatedPartNumbers) {
        const matches = index.get(relatedPartNumber) ?? [];
        matches.push({ canonicalPartNumber, product });
        index.set(relatedPartNumber, matches);
      }
    }
  }
  return index;
}

function getMatch(partNumber, officialIndex, relatedIndex) {
  const exact = officialIndex.get(partNumber) ?? [];
  if (exact.length === 1) return { product: exact[0], matchType: 'exact' };
  if (exact.length > 1) return { ambiguous: exact, matchType: 'ambiguous-exact' };

  const variants = relatedIndex.get(partNumber) ?? [];
  const unique = [...new Map(variants.map(match => [
    `${match.canonicalPartNumber}\u0000${match.product.partNumber}`,
    match
  ])).values()];
  if (unique.length === 1) return { ...unique[0], matchType: 'package-variant' };
  if (unique.length > 1) return { ambiguous: unique, matchType: 'ambiguous-variant' };
  return null;
}

function parseDetailPage(html, product, detailUrl) {
  const detailSpecs = {};
  const pairs = [];
  for (const [, row] of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi)) {
    const cells = [...row.matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]\s*>/gi)]
      .map(([, cell]) => textFromHtml(cell));
    if (cells.length >= 2) pairs.push([cells[0], cells.slice(1).join(' ').trim()]);
  }
  for (const [label, value] of pairs) {
    const field = DATA_FIELDS.find(([, aliases]) =>
      aliases.some(alias => normalizeLabel(alias) === normalizeLabel(label))
    );
    if (field && value) detailSpecs[field[0]] = value;
  }
  const links = { datasheet: '', specsheet: '' };
  for (const [, tag, content] of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = tag.match(/\bhref\s*=\s*(['"])(.*?)\1/i)?.[2];
    if (!href) continue;
    const url = safeSamsungUrl(href, detailUrl);
    if (!url) continue;
    const label = `${textFromHtml(content)} ${tag}`.toLowerCase();
    if (!links.datasheet && /data[\s-]?sheet/.test(label)) links.datasheet = url;
    if (!links.specsheet && /spec[\s-]?sheet|specification/.test(label)) links.specsheet = url;
  }
  return {
    ...product,
    specs: { ...product.specs, ...detailSpecs },
    datasheetUrl: links.datasheet || product.datasheetUrl,
    specsheetUrl: links.specsheet || product.specsheetUrl
  };
}

function needsDetail(product) {
  const missingFields = DATA_FIELDS.some(([name]) => !product.specs[name]);
  return Boolean(product.detailUrl &&
    (missingFields || !product.datasheetUrl || !product.specsheetUrl));
}

async function fetchDetail(product) {
  const wait = REQUEST_DELAY_MS - (Date.now() - lastDetailRequestAt);
  if (lastDetailRequestAt && wait > 0) {
    await new Promise(resolve => setTimeout(resolve, wait));
  }
  lastDetailRequestAt = Date.now();
  const page = await fetchOfficial(product.detailUrl, 'text/html');
  return parseDetailPage(page.body, product, page.url);
}

function makeSpecification(product) {
  const specs = Object.fromEntries(DATA_FIELDS
    .map(([name]) => [name, product.specs[name]])
    .filter(([, value]) => typeof value === 'string' && value.trim()));
  return {
    manufacturer: MANUFACTURER,
    category: 'MLCC',
    specs,
    source: {
      type: 'manufacturer',
      name: MANUFACTURER,
      url: product.detailUrl
    },
    ...(safeSamsungUrl(product.datasheetUrl) ? {
      datasheet: { title: 'Samsung Electro-Mechanics Datasheet', url: product.datasheetUrl }
    } : {}),
    ...(safeSamsungUrl(product.specsheetUrl) ? {
      specsheet: { title: 'Samsung Electro-Mechanics Specsheet', url: product.specsheetUrl }
    } : {})
  };
}

function isKnownManufacturer(record) {
  return typeof record?.manufacturer === 'string' && record.manufacturer.trim().length > 0;
}

function isSamsung(record) {
  return isKnownManufacturer(record) &&
    record.manufacturer.trim().toLowerCase() === MANUFACTURER.toLowerCase();
}

function hasCompleteSpecification(record) {
  return DATA_FIELDS.every(([name]) =>
    typeof record?.specs?.[name] === 'string' && record.specs[name].trim()
  ) && Boolean(record?.source?.url) && Boolean(record?.datasheet?.url) &&
    Boolean(record?.specsheet?.url);
}

function mergeOfficialSpecification(existing, incoming) {
  if (!existing) return { ...incoming };
  if (!isSamsung(existing)) return null;
  const specs = { ...(existing.specs ?? {}) };
  for (const [key, value] of Object.entries(incoming.specs)) {
    if (!Object.hasOwn(specs, key)) specs[key] = value;
  }
  return {
    ...incoming,
    ...existing,
    manufacturer: MANUFACTURER,
    category: 'MLCC',
    specs,
    source: existing.source ?? incoming.source,
    datasheet: existing.datasheet ?? incoming.datasheet,
    specsheet: existing.specsheet ?? incoming.specsheet
  };
}

function candidateOrder(left, right, inventory) {
  const leftStock = inventory[left]?.status === 'in-stock' ? 0 : 1;
  const rightStock = inventory[right]?.status === 'in-stock' ? 0 : 1;
  return leftStock - rightStock || (left < right ? -1 : left > right ? 1 : 0);
}

function serialize(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function itemsChanged(existing, updated) {
  return serialize(existing) !== serialize(updated);
}

async function writeAtomically(outputs) {
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const changed = [];
  for (const [filePath, data] of outputs) {
    const content = serialize(data);
    let oldContent = '';
    try {
      oldContent = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (oldContent !== content) changed.push({ filePath, content, existed: Boolean(oldContent) });
  }
  if (!changed.length) return [];

  const backups = [];
  for (const entry of changed) {
    if (!entry.existed) continue;
    const backupPath = `${entry.filePath}.backup-${timestamp}`;
    await fs.copyFile(entry.filePath, backupPath, fs.constants.COPYFILE_EXCL);
    backups.push(path.relative(ROOT, backupPath));
  }

  const staged = [];
  try {
    for (const [index, entry] of changed.entries()) {
      const temporaryPath = `${entry.filePath}.${process.pid}.${index}.tmp`;
      await fs.writeFile(temporaryPath, entry.content, { flag: 'wx' });
      JSON.parse(await fs.readFile(temporaryPath, 'utf8'));
      staged.push({ temporaryPath, filePath: entry.filePath });
    }
    for (const entry of staged) await fs.rename(entry.temporaryPath, entry.filePath);
  } catch (error) {
    for (const entry of staged) await fs.rm(entry.temporaryPath, { force: true });
    throw new Error(`Could not atomically write Samsung MLCC data: ${error.message}`);
  }
  return backups;
}

async function main() {
  const options = parseArguments();
  const [inventoryData, manufacturerData, specsData, reviewData, unresolvedData] = await Promise.all([
    readJson(INVENTORY_PATH, 'inventory-status.json'),
    readJson(MANUFACTURERS_PATH, 'product-manufacturers.json'),
    readJson(SPECS_PATH, 'product-specs.json'),
    readJson(REVIEW_PATH, 'samsung-mlcc-review.json', { version: 1, items: {} }),
    readJson(UNRESOLVED_PATH, 'samsung-mlcc-unresolved.json', { version: 1, items: {} })
  ]);
  const inventory = requireItems(inventoryData, 'inventory-status.json', false);
  const manufacturers = requireItems(manufacturerData, 'product-manufacturers.json');
  const currentSpecs = requireItems(specsData, 'product-specs.json');
  const review = requireItems(reviewData, 'samsung-mlcc-review.json');
  const unresolved = requireItems(unresolvedData, 'samsung-mlcc-unresolved.json');
  let candidatePartNumbers = Object.keys(inventory).filter(partNumber => partNumber.trim());

  if (options.partNumber) {
    const exact = candidatePartNumbers.filter(partNumber => partNumber === options.partNumber);
    if (exact.length !== 1) {
      throw new Error(`Part Number "${options.partNumber}" must exactly match one inventory key.`);
    }
    candidatePartNumbers = exact;
  } else {
    candidatePartNumbers.sort((left, right) => candidateOrder(left, right, inventory));
    candidatePartNumbers = candidatePartNumbers.slice(0, options.limit);
  }

  const summary = {
    inventoryCandidates: candidatePartNumbers.length,
    officialProductsLoaded: 0,
    exactMatches: 0,
    packageVariantMatches: 0,
    manufacturerVerified: 0,
    specsAdded: 0,
    alreadyComplete: 0,
    review: 0,
    unresolved: 0,
    detailRequests: 0,
    errors: 0
  };
  const manufacturerUpdates = { ...manufacturers };
  const specUpdates = { ...currentSpecs };
  const reviewUpdates = { ...review };
  const unresolvedUpdates = { ...unresolved };
  let officialProducts;
  try {
    officialProducts = await loadOfficialProducts();
  } catch (error) {
    summary.errors += 1;
    console.error(error.message);
    console.log(JSON.stringify({ summary }, null, 2));
    process.exitCode = 1;
    return;
  }
  const officialIndex = makeOfficialIndex(officialProducts);
  const relatedIndex = makeRelatedPartIndex(officialIndex);
  summary.officialProductsLoaded = officialIndex.size;

  for (const partNumber of candidatePartNumbers) {
    if (!options.retry && (reviewUpdates[partNumber] || unresolvedUpdates[partNumber])) {
      continue;
    }
    const match = getMatch(partNumber, officialIndex, relatedIndex);
    if (!match) continue;
    if (match.ambiguous) {
      reviewUpdates[partNumber] = {
        status: 'ambiguous-official-match',
        matches: match.ambiguous.map(item => item.canonicalPartNumber ?? item.partNumber)
      };
      summary.review += 1;
      continue;
    }

    const product = match.product;
    if (match.matchType === 'exact') summary.exactMatches += 1;
    else summary.packageVariantMatches += 1;
    const currentManufacturer = manufacturerUpdates[partNumber];
    if (currentManufacturer?.confidence === 'verified' && !isSamsung(currentManufacturer)) {
      reviewUpdates[partNumber] = {
        status: 'verified-manufacturer-conflict',
        existingManufacturer: currentManufacturer.manufacturer,
        officialManufacturer: MANUFACTURER,
        officialPartNumber: product.partNumber
      };
      summary.review += 1;
      continue;
    }
    if (currentManufacturer?.manufacturer?.trim().toLowerCase() === 'walsin' &&
        currentManufacturer.confidence === 'pattern-high') {
      reviewUpdates[partNumber] = {
        status: 'manufacturer-conflict',
        existingManufacturer: currentManufacturer.manufacturer,
        officialManufacturer: MANUFACTURER,
        officialPartNumber: product.partNumber,
        reason: 'Existing Walsin pattern-high mapping preserved.'
      };
      summary.review += 1;
      continue;
    }
    if (isKnownManufacturer(currentManufacturer) && !isSamsung(currentManufacturer)) {
      reviewUpdates[partNumber] = {
        status: 'manufacturer-conflict',
        existingManufacturer: currentManufacturer.manufacturer,
        officialManufacturer: MANUFACTURER,
        officialPartNumber: product.partNumber
      };
      summary.review += 1;
      continue;
    }
    const currentSpec = specUpdates[partNumber];
    if (currentSpec && !isSamsung(currentSpec)) {
      reviewUpdates[partNumber] = {
        status: 'specification-conflict',
        existingManufacturer: currentSpec.manufacturer ?? null,
        officialPartNumber: product.partNumber
      };
      summary.review += 1;
      continue;
    }

    if (currentManufacturer?.confidence === 'verified' && isSamsung(currentManufacturer)) {
      summary.manufacturerVerified += 1;
    } else {
      manufacturerUpdates[partNumber] = {
        manufacturer: MANUFACTURER,
        source: 'manufacturer-product-search',
        confidence: 'verified'
      };
      summary.manufacturerVerified += 1;
    }

    let enriched = product;
    const existing = specUpdates[partNumber];
    if (existing && hasCompleteSpecification(existing)) {
      delete reviewUpdates[partNumber];
      delete unresolvedUpdates[partNumber];
      summary.alreadyComplete += 1;
      continue;
    }
    let detailAttempted = false;
    if (needsDetail(product) && summary.detailRequests < MAX_DETAIL_REQUESTS) {
      detailAttempted = true;
      summary.detailRequests += 1;
      try {
        enriched = await fetchDetail(product);
      } catch (error) {
        summary.errors += 1;
        unresolvedUpdates[partNumber] = {
          status: 'detail-request-failed',
          officialPartNumber: product.partNumber,
          reason: error.message
        };
        summary.unresolved += 1;
        continue;
      }
    }
    if (needsDetail(product) && !detailAttempted &&
        summary.detailRequests >= MAX_DETAIL_REQUESTS) {
      unresolvedUpdates[partNumber] = {
        status: 'detail-request-limit',
        officialPartNumber: product.partNumber
      };
      summary.unresolved += 1;
      continue;
    }

    const incoming = makeSpecification(enriched);
    const merged = mergeOfficialSpecification(existing, incoming);
    if (!merged) {
      reviewUpdates[partNumber] = {
        status: 'specification-conflict',
        existingManufacturer: existing?.manufacturer ?? null,
        officialPartNumber: product.partNumber
      };
      summary.review += 1;
      continue;
    }
    if (!Object.keys(merged.specs).length || !merged.source.url) {
      unresolvedUpdates[partNumber] = {
        status: 'insufficient-official-structured-data',
        officialPartNumber: product.partNumber
      };
      summary.unresolved += 1;
      continue;
    }
    const specificationChanged = !existing || JSON.stringify(existing) !== JSON.stringify(merged);
    specUpdates[partNumber] = merged;
    delete reviewUpdates[partNumber];
    delete unresolvedUpdates[partNumber];
    if (specificationChanged) summary.specsAdded += 1;
    else summary.alreadyComplete += 1;
  }

  const now = new Date().toISOString();
  const manufacturerChanged = itemsChanged(manufacturers, manufacturerUpdates);
  const reviewChanged = itemsChanged(review, reviewUpdates);
  const unresolvedChanged = itemsChanged(unresolved, unresolvedUpdates);
  const updatedManufacturerData = {
    ...manufacturerData,
    ...(manufacturerChanged ? { updatedAt: now } : {}),
    items: manufacturerUpdates
  };
  const updatedSpecsData = { ...specsData, items: specUpdates };
  const outputs = [
    [MANUFACTURERS_PATH, updatedManufacturerData],
    [SPECS_PATH, updatedSpecsData],
    [REVIEW_PATH, {
      ...reviewData,
      version: 1,
      ...(reviewChanged ? { updatedAt: now } : {}),
      items: reviewUpdates
    }],
    [UNRESOLVED_PATH, {
      ...unresolvedData,
      version: 1,
      ...(unresolvedChanged ? { updatedAt: now } : {}),
      items: unresolvedUpdates
    }]
  ];
  if (options.dryRun) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      fileWrites: 'none',
      summary
    }, null, 2));
    return;
  }
  const backups = await writeAtomically(outputs);
  console.log(JSON.stringify({ summary, backups }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Samsung MLCC update failed.');
  process.exitCode = 1;
}
