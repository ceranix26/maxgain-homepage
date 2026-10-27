import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const INVENTORY_PATH = path.join(DATA_DIR, 'inventory-status.json');
const MANUFACTURERS_PATH = path.join(DATA_DIR, 'product-manufacturers.json');
const SPECS_PATH = path.join(DATA_DIR, 'product-specs.json');
const ALIASES_PATH = path.join(DATA_DIR, 'product-aliases.json');
const COMPANIES = {
  technology: {
    name: 'Johanson Technology',
    host: 'www.johansontechnology.com',
    searchUrl: 'https://www.johansontechnology.com/search/pn/',
    reviewPath: path.join(DATA_DIR, 'johanson-technology-review.json')
  },
  dielectrics: {
    name: 'Johanson Dielectrics',
    host: 'www.johansondielectrics.com',
    searchUrl: 'https://www.johansondielectrics.com/search/pn/',
    reviewPath: path.join(DATA_DIR, 'johanson-dielectrics-review.json')
  }
};
const REQUEST_DELAY_MS = 1_000;
const MAX_REQUESTS = 200;
let lastRequestAt = 0;
let totalRequests = 0;

function parseArguments() {
  const options = {
    dryRun: false,
    retry: false,
    limit: Infinity,
    limitProvided: false,
    partNumber: ''
  };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dry-run') {
      options.dryRun = true;
    } else if (args[i] === '--retry') {
      options.retry = true;
    } else if (args[i] === '--limit') {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1) {
        throw new Error('--limit requires a positive integer.');
      }
      options.limit = Number(value);
      options.limitProvided = true;
    } else if (args[i] === '--part-number') {
      const value = args[++i];
      if (!value || value.startsWith('--') || !value.trim()) {
        throw new Error('--part-number requires a non-empty part number.');
      }
      if (options.partNumber) {
        throw new Error('--part-number may be supplied only once.');
      }
      options.partNumber = value;
    } else {
      throw new Error(`Unknown argument: ${args[i]}`);
    }
  }
  if (options.partNumber && options.limitProvided) {
    throw new Error('--part-number cannot be used together with --limit.');
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

function safeJohansonUrl(value, baseUrl, expectedCompany) {
  if (typeof value !== 'string' || !value.trim() ||
      /[\s\u0000-\u001f]/.test(value.trim())) return '';
  try {
    const url = new URL(value.trim(), baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    const hostname = url.hostname.replace(/^www\./i, '');
    const allowedCompanies = expectedCompany ? [expectedCompany] : Object.values(COMPANIES);
    const allowed = allowedCompanies.some(company => {
      const root = company.host.replace(/^www\./i, '');
      return hostname === root || hostname.endsWith(`.${root}`);
    });
    if (!allowed) return '';
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

function parseSearchResults(html, company) {
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
    const safeDetailUrl = safeJohansonUrl(detailHref, company.searchUrl, company);
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
  const company = Object.values(COMPANIES).find(candidate =>
    new URL(detailUrl).hostname.replace(/^www\./i, '') === candidate.host.replace(/^www\./i, '')
  );
  let source = company ? safeJohansonUrl(detailUrl, company.searchUrl, company) : '';
  const documents = new Map();
  const labeledFields = labeledValues(html);
  const companyEvidence = {
    manufacturer: readNamedField(labeledFields, [
      'manufacturer', 'manufacturer name', 'company', 'company name', 'brand', 'product brand'
    ]),
    productCategory: readNamedField(labeledFields, [
      'product category', 'product family', 'family', 'product type', 'category'
    ]),
    canonicalUrl: source,
    canonicalCompany: ''
  };
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = attributesFromTag(tag);
    if (attributes.rel?.toLowerCase().split(/\s+/).includes('canonical') && attributes.href) {
      companyEvidence.canonicalUrl = safeJohansonUrl(attributes.href, detailUrl);
      if (companyEvidence.canonicalUrl) source = companyEvidence.canonicalUrl;
      break;
    }
  }
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = attributesFromTag(tag);
    const label = (attributes.property || attributes.name || '').toLowerCase();
    const value = attributes.content?.trim() ?? '';
    if (!value) continue;
    if (!companyEvidence.manufacturer && /manufacturer|company|brand/.test(label)) {
      companyEvidence.manufacturer = value;
    }
    if (!companyEvidence.productCategory && /category|product.?group|product.?type/.test(label)) {
      companyEvidence.productCategory = value;
    }
  }
  for (const [, attributes, contents] of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi
  )) {
    if (!/\btype\s*=\s*(['"])application\/(?:ld\+)?json\1/i.test(attributes)) continue;
    try {
      const structured = JSON.parse(contents);
      const records = Array.isArray(structured) ? structured : [structured];
      for (const record of records) {
        const manufacturer = record?.manufacturer?.name ?? record?.brand?.name ??
          record?.manufacturer ?? record?.brand;
        const productCategory = record?.category ?? record?.productGroup ?? record?.additionalType;
        if (!companyEvidence.manufacturer && typeof manufacturer === 'string') {
          companyEvidence.manufacturer = manufacturer;
        }
        if (!companyEvidence.productCategory && typeof productCategory === 'string') {
          companyEvidence.productCategory = productCategory;
        }
      }
    } catch {
      continue;
    }
  }
  companyEvidence.canonicalCompany = Object.values(COMPANIES).find(candidate => {
    if (!companyEvidence.canonicalUrl) return false;
    return new URL(companyEvidence.canonicalUrl).hostname.replace(/^www\./i, '') ===
      candidate.host.replace(/^www\./i, '');
  })?.name ?? '';

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
    if (!/product|information|datasheet|data sheet|specification|technical/i.test(anchorText) &&
        !/product|information|datasheet|specification/i.test(href)) continue;
    const resolved = company ? safeJohansonUrl(href, detailUrl, company) : '';
    if (!resolved) continue;
    const label = `${anchorText} ${href}`.toLowerCase();
    const type = /datasheet|data sheet|product data|specification/i.test(label)
      ? 'datasheet'
      : 'product-information';
    if (!documents.has(type)) documents.set(type, resolved);
  }

  return {
    specs,
    source,
    companyEvidence,
    datasheetUrl: documents.get('datasheet') ?? '',
    infoPdf: documents.get('product-information') ?? documents.get('datasheet') ?? ''
  };
}

function normalizePartNumber(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function isRateLimitStop(status) {
  return status === 429;
}

async function fetchHtml(url, onRequest, allowedHost, redirectCount = 0) {
  if (totalRequests >= MAX_REQUESTS) throw new Error('Reached the 200-request execution limit.');
  const wait = REQUEST_DELAY_MS - (Date.now() - lastRequestAt);
  if (lastRequestAt && wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  totalRequests += 1;
  onRequest();
  const response = await fetch(url, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'MAXGAIN Johanson manufacturer specification lookup/1.0'
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
    if (target.protocol !== 'https:' ||
        target.hostname.replace(/^www\./i, '') !== allowedHost.replace(/^www\./i, '') ||
        target.username || target.password) {
      throw new Error('Rejected non-official or non-HTTPS redirect');
    }
    return fetchHtml(target.href, onRequest, allowedHost, redirectCount + 1);
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

async function writeAtomically(outputs) {
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const changed = [];
  for (const [filePath, value] of outputs) {
    const content = `${JSON.stringify(value, null, 2)}\n`;
    let existing;
    try {
      existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (JSON.stringify(existing) !== JSON.stringify(value)) {
      changed.push({ filePath, content, existed: existing !== undefined });
    }
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
      await fs.writeFile(temporaryPath, entry.content, { encoding: 'utf8', flag: 'wx' });
      JSON.parse(await fs.readFile(temporaryPath, 'utf8'));
      staged.push({ temporaryPath, filePath: entry.filePath });
    }
    for (const entry of staged) await fs.rename(entry.temporaryPath, entry.filePath);
  } catch (error) {
    for (const entry of staged) await fs.rm(entry.temporaryPath, { force: true });
    throw new Error(`Could not atomically write Johanson data: ${error.message}`);
  }
  return backups;
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

function isCandidatePartNumber(partNumber) {
  const value = partNumber.trim();
  if (value.length < 6 || /\s/.test(value) ||
      !/^[A-Z0-9][A-Z0-9._/+\\-]*$/i.test(value)) return false;
  if (!/[A-Z]/i.test(value) || !/\d/.test(value)) return false;
  return /^[A-Z]{1,8}\d[A-Z0-9._/+\\-]{3,}$/i.test(value) ||
    /^\d{3,5}[A-Z]{1,}[A-Z0-9._/+\\-]{2,}$/i.test(value);
}

function isJohansonManufacturer(record) {
  return typeof record?.manufacturer === 'string' &&
    /^Johanson (Technology|Dielectrics)$/i.test(record.manufacturer.trim());
}

function isInStock(inventoryRecord) {
  return inventoryRecord?.status === 'in-stock';
}

function createCompanySummary(candidates) {
  return {
    candidates,
    requests: 0,
    legacyExact: 0,
    globalExact: 0,
    aliasesAdded: 0,
    manufacturerVerified: 0,
    specsAdded: 0,
    review: 0,
    unresolved: 0,
    errors: 0
  };
}

function makeManufacturerRecord(company) {
  return {
    manufacturer: company.name,
    source: 'manufacturer-product-search',
    confidence: 'verified'
  };
}

function normalizeOfficialRecords(results, inventoryPartNumber) {
  const key = normalizePartNumber(inventoryPartNumber);
  const exact = results.filter(result =>
    normalizePartNumber(result.globalPartNumber) === key ||
    normalizePartNumber(result.legacyPartNumber) === key
  );
  return [...new Map(exact.map(result => [
    normalizePartNumber(result.globalPartNumber),
    result
  ])).values()];
}

function canonicalGlobalPartNumber(result) {
  return normalizePartNumber(result.globalPartNumber);
}

function explicitCompanyKey(detail) {
  const explicit = normalizePartNumber(detail.companyEvidence?.manufacturer)
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ');
  if (explicit === 'JTI' || explicit === 'JOHANSON TECHNOLOGY') return 'technology';
  if (explicit === 'JDI' || explicit === 'JOHANSON DIELECTRICS') return 'dielectrics';
  return '';
}

function isExplicitCategoryCompanyMatch(detail, company) {
  const explicit = detail.companyEvidence?.productCategory.trim().toLowerCase();
  return Boolean(explicit && explicit.includes(company.name.toLowerCase()));
}

async function fetchAuthoritativeDetail(company, result, summary) {
  if (totalRequests >= MAX_REQUESTS) {
    throw new Error('Reached the 200-request execution limit before detail lookup.');
  }
  const html = await fetchHtml(
    result.detailUrl,
    () => { summary.requests += 1; },
    company.host
  );
  return parseDetailPage(html, result.detailUrl);
}

async function resolveSharedGlobalOwnership(matchesByCompany, summaryByCompany) {
  const entries = [...matchesByCompany.entries()];
  if (entries.length !== 2 ||
      canonicalGlobalPartNumber(entries[0][1]) !== canonicalGlobalPartNumber(entries[1][1])) {
    return null;
  }

  const details = new Map();
  const errors = [];
  for (const [key, result] of entries) {
    const company = COMPANIES[key];
    try {
      details.set(key, await fetchAuthoritativeDetail(company, result, summaryByCompany[key]));
    } catch (error) {
      errors.push({ manufacturer: company.name, message: error.message });
      if (totalRequests >= MAX_REQUESTS || isRateLimitStop(error.status)) break;
    }
  }

  const valid = entries.filter(([key]) => details.has(key));
  const explicitOwners = new Set(valid
    .map(([key]) => explicitCompanyKey(details.get(key)))
    .filter(Boolean));
  if (explicitOwners.size === 1) {
    const [key] = explicitOwners;
    const owner = entries.find(([entryKey]) => entryKey === key);
    const authoritativeEntry = valid.find(([entryKey]) =>
      explicitCompanyKey(details.get(entryKey)) === key
    );
    const authoritativeDetail = authoritativeEntry
      ? details.get(authoritativeEntry[0])
      : null;
    if (owner && authoritativeDetail) {
      return {
        companyKey: key,
        match: owner[1],
        detail: authoritativeDetail,
        resolution: 'explicit-manufacturer'
      };
    }
  }

  const categoryMatches = valid.filter(([key]) =>
    isExplicitCategoryCompanyMatch(details.get(key), COMPANIES[key])
  );
  if (explicitOwners.size === 0 && categoryMatches.length === 1) {
    const [[key, result]] = categoryMatches;
    return {
      companyKey: key,
      match: result,
      detail: details.get(key),
      resolution: 'explicit-product-category'
    };
  }

  return {
    unresolved: true,
    globalPartNumber: canonicalGlobalPartNumber(entries[0][1]),
    details: Object.fromEntries([...details].map(([key, detail]) => [
      COMPANIES[key].name,
      {
        url: detail.source,
        manufacturer: detail.companyEvidence?.manufacturer || null,
        productCategory: detail.companyEvidence?.productCategory || null,
        canonicalUrl: detail.companyEvidence?.canonicalUrl || null,
        canonicalCompany: detail.companyEvidence?.canonicalCompany || null
      }
    ])),
    errors
  };
}

function mergeOfficialSpecs(existing, incoming) {
  if (existing && existing.manufacturer !== incoming.manufacturer) return null;
  if (!existing) return incoming;
  const specs = { ...(existing.specs ?? {}) };
  const existingLegacy = Array.isArray(existing.partNumbers?.legacy)
    ? existing.partNumbers.legacy
    : [];
  const incomingLegacy = Array.isArray(incoming.partNumbers?.legacy)
    ? incoming.partNumbers.legacy
    : [];
  for (const [name, value] of Object.entries(incoming.specs ?? {})) {
    if (!Object.hasOwn(specs, name)) specs[name] = value;
  }
  return {
    ...incoming,
    ...existing,
    manufacturer: incoming.manufacturer,
    category: existing.category ?? incoming.category,
    partNumbers: {
      ...incoming.partNumbers,
      ...existing.partNumbers,
      primary: incoming.partNumbers.primary,
      legacy: [...new Set([
        ...existingLegacy,
        ...incomingLegacy
      ])]
    },
    specs,
    source: existing.source ?? incoming.source,
    ...(existing.sourceDocument || incoming.sourceDocument
      ? { sourceDocument: existing.sourceDocument ?? incoming.sourceDocument }
      : {})
  };
}

async function main() {
  const options = parseArguments();
  const inventoryData = await readJson(INVENTORY_PATH, 'inventory-status.json');
  const manufacturersData = await readJson(MANUFACTURERS_PATH, 'product-manufacturers.json');
  const specsData = await readJson(SPECS_PATH, 'product-specs.json');
  const aliasData = await readJson(ALIASES_PATH, 'product-aliases.json', { version: 1, aliases: {} });
  const inventory = requireItems(inventoryData, 'inventory-status.json', false);
  const manufacturerItems = requireItems(manufacturersData, 'product-manufacturers.json');
  const specItems = requireItems(specsData, 'product-specs.json');
  if (!aliasData || aliasData.version !== 1 || !aliasData.aliases ||
      typeof aliasData.aliases !== 'object' || Array.isArray(aliasData.aliases)) {
    throw new Error('product-aliases.json must contain version 1 and an aliases object.');
  }

  const reviewFiles = {};
  const reviewItems = {};
  const summaries = {};
  for (const [key, company] of Object.entries(COMPANIES)) {
    const data = await readJson(company.reviewPath, `${company.name} review`, {
      version: 1,
      items: {}
    });
    reviewFiles[key] = data;
    reviewItems[key] = requireItems(data, `${company.name} review`);
    summaries[key] = createCompanySummary(0);
  }

  const inventoryPartNumbers = Object.keys(inventory).filter(partNumber => partNumber.trim());
  let candidates = inventoryPartNumbers.filter(partNumber =>
    isCandidatePartNumber(partNumber) &&
    (!manufacturerItems[partNumber]?.manufacturer ||
      isJohansonManufacturer(manufacturerItems[partNumber]))
  );
  if (options.partNumber) {
    const exact = inventoryPartNumbers.filter(partNumber =>
      normalizePartNumber(partNumber) === normalizePartNumber(options.partNumber)
    );
    if (exact.length !== 1) {
      throw new Error(`Part Number "${options.partNumber}" must match exactly one inventory key.`);
    }
    if (!isCandidatePartNumber(exact[0])) {
      throw new Error(`Part Number "${options.partNumber}" is not a plausible alphanumeric manufacturer Part Number.`);
    }
    candidates = exact;
  }
  candidates.sort((left, right) =>
    Number(isInStock(inventory[right])) - Number(isInStock(inventory[left])) ||
    (left < right ? -1 : left > right ? 1 : 0)
  );
  candidates = candidates.slice(0, options.limit);
  for (const summary of Object.values(summaries)) summary.candidates = candidates.length;

  const manufacturerUpdates = { ...manufacturerItems };
  const specUpdates = { ...specItems };
  const aliases = { ...aliasData.aliases };
  const originalManufacturerItems = { ...manufacturerItems };
  const originalSpecItems = { ...specItems };
  const originalAliases = { ...aliasData.aliases };
  const originalReviewItems = Object.fromEntries(
    Object.entries(reviewItems).map(([key, value]) => [key, { ...value }])
  );
  const updatedReviewItems = Object.fromEntries(
    Object.entries(reviewItems).map(([key, value]) => [key, { ...value }])
  );
  const updates = { manufacturers: new Set() };
  let requestLimitReached = false;

  for (const inventoryPartNumber of candidates) {
    if (totalRequests >= MAX_REQUESTS) {
      requestLimitReached = true;
      break;
    }
    if (!options.retry && Object.values(updatedReviewItems).some(items =>
      Object.hasOwn(items, inventoryPartNumber)
    )) continue;
    const matchesByCompany = new Map();
    const lookupErrors = [];
    const ambiguousCompanies = new Set();
    let searchesCompleted = 0;
    for (const [key, company] of Object.entries(COMPANIES)) {
      if (totalRequests >= MAX_REQUESTS) {
        requestLimitReached = true;
        break;
      }
      const summary = summaries[key];
      const searchUrl = new URL(company.searchUrl);
      searchUrl.searchParams.set('s', inventoryPartNumber);
      let results;
      try {
        results = parseSearchResults(await fetchHtml(
          searchUrl.href,
          () => { summary.requests += 1; },
          company.host
        ), company);
        searchesCompleted += 1;
      } catch (error) {
        if (totalRequests >= MAX_REQUESTS) requestLimitReached = true;
        summary.errors += 1;
        lookupErrors.push({ company: company.name, message: error.message });
        if (totalRequests >= MAX_REQUESTS || isRateLimitStop(error.status)) {
          requestLimitReached = totalRequests >= MAX_REQUESTS;
          break;
        }
        continue;
      }
      const exactResults = normalizeOfficialRecords(results, inventoryPartNumber);
      if (exactResults.length > 1) {
        summary.review += 1;
        ambiguousCompanies.add(key);
        updatedReviewItems[key][inventoryPartNumber] = {
          status: 'ambiguous-exact-matches',
          originalPartNumber: inventoryPartNumber,
          matches: exactResults
        };
      } else if (exactResults.length === 1) {
        matchesByCompany.set(key, exactResults[0]);
      }
    }

    if (lookupErrors.length) {
      for (const key of Object.keys(COMPANIES)) {
        const hasExactMatch = matchesByCompany.has(key);
        if (hasExactMatch) summaries[key].review += 1;
        else summaries[key].unresolved += 1;
        updatedReviewItems[key][inventoryPartNumber] = {
          status: totalRequests >= MAX_REQUESTS ? 'request-limit-reached' : 'partial-search-error',
          originalPartNumber: inventoryPartNumber,
          matches: [...matchesByCompany.entries()].map(([matchKey, result]) => ({
            manufacturer: COMPANIES[matchKey].name,
            globalPartNumber: result.globalPartNumber,
            legacyPartNumber: result.legacyPartNumber,
            detailUrl: result.detailUrl
          })),
          errors: lookupErrors
        };
      }
      continue;
    }

    if (searchesCompleted < Object.keys(COMPANIES).length) {
      for (const [key] of Object.entries(COMPANIES)) {
        summaries[key].unresolved += 1;
        updatedReviewItems[key][inventoryPartNumber] = {
          status: 'request-limit-reached',
          originalPartNumber: inventoryPartNumber
        };
      }
      continue;
    }

    if (ambiguousCompanies.size) continue;

    let resolvedDetail;
    if (matchesByCompany.size > 1) {
      const globalPartNumbers = new Set(
        [...matchesByCompany.values()].map(canonicalGlobalPartNumber)
      );
      if (globalPartNumbers.size > 1) {
        for (const [key] of matchesByCompany) {
          summaries[key].review += 1;
          updatedReviewItems[key][inventoryPartNumber] = {
            status: 'cross-company-exact-match',
            originalPartNumber: inventoryPartNumber,
            matches: [...matchesByCompany.entries()].map(([companyKey, result]) => ({
              manufacturer: COMPANIES[companyKey].name,
              globalPartNumber: result.globalPartNumber,
              legacyPartNumber: result.legacyPartNumber
            }))
          };
        }
        continue;
      }

      const ownership = await resolveSharedGlobalOwnership(matchesByCompany, summaries);
      if (!ownership || ownership.unresolved) {
        for (const [key] of matchesByCompany) {
          summaries[key].review += 1;
          updatedReviewItems[key][inventoryPartNumber] = {
            status: 'cross-company-exact-match',
            originalPartNumber: inventoryPartNumber,
            globalPartNumber: ownership?.globalPartNumber ??
              canonicalGlobalPartNumber([...matchesByCompany.values()][0]),
            matches: [...matchesByCompany.entries()].map(([companyKey, result]) => ({
              manufacturer: COMPANIES[companyKey].name,
              globalPartNumber: result.globalPartNumber,
              legacyPartNumber: result.legacyPartNumber,
              detailUrl: result.detailUrl
            })),
            detailEvidence: ownership?.details ?? {},
            errors: ownership?.errors ?? []
          };
        }
        continue;
      }
      matchesByCompany.clear();
      matchesByCompany.set(ownership.companyKey, ownership.match);
      resolvedDetail = ownership.detail;
    }

    if (matchesByCompany.size === 0) {
      if (lookupErrors.length) {
        for (const [key, company] of Object.entries(COMPANIES)) {
          if (!options.retry && updatedReviewItems[key][inventoryPartNumber]) continue;
          summaries[key].unresolved += 1;
          updatedReviewItems[key][inventoryPartNumber] = {
            status: requestLimitReached ? 'request-limit-reached' : 'lookup-error',
            originalPartNumber: inventoryPartNumber,
            errors: lookupErrors
          };
        }
      } else {
        for (const [key] of Object.entries(COMPANIES)) {
          if (!options.retry && updatedReviewItems[key][inventoryPartNumber]) continue;
          summaries[key].unresolved += 1;
          updatedReviewItems[key][inventoryPartNumber] = {
            status: 'no-exact-match',
            originalPartNumber: inventoryPartNumber
          };
        }
      }
      continue;
    }

    const [[companyKey, match]] = matchesByCompany;
    const company = COMPANIES[companyKey];
    const summary = summaries[companyKey];
    const inputKey = normalizePartNumber(inventoryPartNumber);
    const globalKey = normalizePartNumber(match.globalPartNumber);
    const matchedByGlobal = normalizePartNumber(match.globalPartNumber) === inputKey;
    if (matchedByGlobal) summary.globalExact += 1;
    else summary.legacyExact += 1;

    const manufacturerTargets = [...new Set([inventoryPartNumber, match.globalPartNumber])];
    const manufacturerConflict = manufacturerTargets.find(partNumber => {
      const existing = manufacturerUpdates[partNumber];
      return existing && (existing.confidence === 'verified'
        ? existing.manufacturer !== company.name
        : existing.manufacturer !== company.name);
    });
    if (manufacturerConflict) {
      summary.review += 1;
      updatedReviewItems[companyKey][inventoryPartNumber] = {
        status: 'manufacturer-conflict',
        originalPartNumber: inventoryPartNumber,
        globalPartNumber: match.globalPartNumber,
        existingManufacturer: manufacturerUpdates[manufacturerConflict].manufacturer
      };
      continue;
    }

    const existingSpec = specUpdates[match.globalPartNumber] ??
      specUpdates[inventoryPartNumber];
    const conflictingSpec = [...new Set([match.globalPartNumber, inventoryPartNumber])]
      .map(partNumber => specUpdates[partNumber])
      .find(record => record && record.manufacturer !== company.name);
    if (conflictingSpec) {
      summary.review += 1;
      updatedReviewItems[companyKey][inventoryPartNumber] = {
        status: 'specification-conflict',
        originalPartNumber: inventoryPartNumber,
        globalPartNumber: match.globalPartNumber,
        existingManufacturer: conflictingSpec.manufacturer ?? null
      };
      continue;
    }

    const aliasesForProduct = match.legacyPartNumber &&
      normalizePartNumber(match.legacyPartNumber) !== globalKey
      ? [match.legacyPartNumber]
      : [];
    const aliasConflicts = [];
    const aliasesCandidate = { ...aliases };
    let aliasesAdded = 0;
    for (const alias of aliasesForProduct) {
      const result = mergeAlias(aliasesCandidate, alias, match.globalPartNumber);
      if (result.conflict) aliasConflicts.push(result.conflict);
      else if (result.added) aliasesAdded += 1;
    }
    if (aliasConflicts.length) {
      summary.review += 1;
      updatedReviewItems[companyKey][inventoryPartNumber] = {
        status: 'alias-conflict',
        originalPartNumber: inventoryPartNumber,
        globalPartNumber: match.globalPartNumber,
        conflicts: aliasConflicts
      };
      continue;
    }
    Object.assign(aliases, aliasesCandidate);
    summary.aliasesAdded += aliasesAdded;

    for (const partNumber of manufacturerTargets) {
      const existing = manufacturerUpdates[partNumber];
      if (!existing || existing.manufacturer === company.name) {
        if (!existing || existing.confidence !== 'verified') {
          manufacturerUpdates[partNumber] = makeManufacturerRecord(company);
          updates.manufacturers.add(partNumber);
        }
      }
    }
    summary.manufacturerVerified += 1;

    let detail = resolvedDetail;
    if (!detail) {
      try {
        if (totalRequests >= MAX_REQUESTS) {
          throw new Error('Reached the 200-request execution limit before detail lookup.');
        }
        const detailHtml = await fetchHtml(
          match.detailUrl,
          () => { summary.requests += 1; },
          company.host
        );
        detail = parseDetailPage(detailHtml, match.detailUrl);
      } catch (error) {
        summary.errors += 1;
        summary.unresolved += 1;
        updatedReviewItems[companyKey][inventoryPartNumber] = {
          status: 'detail-lookup-error',
          originalPartNumber: inventoryPartNumber,
          ...match,
          reason: error.message
        };
        continue;
      }
    }

    const record = {
      manufacturer: company.name,
      ...(existingSpec?.category ? { category: existingSpec.category } : {}),
      partNumbers: {
        ...(existingSpec?.partNumbers ?? {}),
        primary: match.globalPartNumber,
        legacy: [...new Set([
          ...(existingSpec?.partNumbers?.legacy ?? []),
          ...(match.legacyPartNumber ? [match.legacyPartNumber] : [])
        ])]
      },
      ...(match.lifecycle ? { lifecycle: match.lifecycle } : existingSpec?.lifecycle
        ? { lifecycle: existingSpec.lifecycle }
        : {}),
      ...(match.description ? { description: match.description } : existingSpec?.description
        ? { description: existingSpec.description }
        : {}),
      source: {
        type: 'manufacturer',
        name: company.name,
        title: `${company.name} Product Data`,
        url: detail.source
      },
      ...(detail.infoPdf ? {
        sourceDocument: { title: 'Product Information PDF', url: detail.infoPdf }
      } : {}),
      ...(detail.datasheetUrl ? {
        datasheet: { title: `${company.name} Datasheet`, url: detail.datasheetUrl }
      } : {}),
      specs: { ...detail.specs, ...(existingSpec?.specs ?? {}) }
    };
    const mergedSpec = mergeOfficialSpecs(existingSpec, record);
    if (!mergedSpec) {
      summary.review += 1;
      updatedReviewItems[companyKey][inventoryPartNumber] = {
        status: 'specification-conflict',
        originalPartNumber: inventoryPartNumber,
        globalPartNumber: match.globalPartNumber
      };
      continue;
    }
    if (!Object.keys(detail.specs).length && !existingSpec?.specs) {
      summary.unresolved += 1;
      updatedReviewItems[companyKey][inventoryPartNumber] = {
        status: 'insufficient-official-structured-specifications',
        originalPartNumber: inventoryPartNumber,
        globalPartNumber: match.globalPartNumber
      };
    } else {
      const specificationChanged = !existingSpec ||
        JSON.stringify(existingSpec) !== JSON.stringify(mergedSpec);
      specUpdates[match.globalPartNumber] = mergedSpec;
      if (specificationChanged) summary.specsAdded += 1;
      delete updatedReviewItems[companyKey][inventoryPartNumber];
    }
  }

  const outputs = [
    [MANUFACTURERS_PATH, {
      ...manufacturersData,
      ...(updates.manufacturers.size ? { updatedAt: new Date().toISOString() } : {}),
      items: manufacturerUpdates
    }],
    [ALIASES_PATH, { ...aliasData, version: 1, aliases }],
    [SPECS_PATH, { ...specsData, version: 1, items: specUpdates }],
    ...Object.entries(COMPANIES).map(([key, company]) => [
      company.reviewPath,
      {
        ...reviewFiles[key],
        version: 1,
        items: updatedReviewItems[key]
      }
    ])
  ];

  let backups = [];
  if (options.dryRun) {
    const changedEntries = (before, after) => Object.entries(after)
      .filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value))
      .map(([key, value]) => ({ partNumber: key, ...value }));
    const proposedReviews = Object.fromEntries(
      Object.entries(updatedReviewItems).map(([key, items]) => [
        COMPANIES[key].name,
        {
          updated: Object.fromEntries(Object.entries(items).filter(([partNumber, value]) =>
            JSON.stringify(originalReviewItems[key][partNumber]) !== JSON.stringify(value)
          )),
          cleared: Object.keys(originalReviewItems[key])
            .filter(partNumber => !Object.hasOwn(items, partNumber))
        }
      ])
    );
    console.log(JSON.stringify({
      mode: 'dry-run',
      persistence: 'No files, temporary outputs, or backups were written.',
      totalRequests,
      companies: summaries,
      proposedManufacturerMappings: changedEntries(originalManufacturerItems, manufacturerUpdates),
      proposedAliases: Object.entries(aliases)
        .filter(([alias, primary]) => originalAliases[alias] !== primary)
        .map(([alias, primary]) => ({ alias, primary })),
      proposedSpecifications: changedEntries(originalSpecItems, specUpdates),
      proposedReviewAndUnresolved: proposedReviews,
      requestLimitReached
    }, null, 2));
    if (Object.values(summaries).some(summary => summary.errors > 0)) {
      process.exitCode = 1;
    }
    return;
  } else {
    backups = await writeAtomically(outputs);
  }
  console.log(JSON.stringify({
    mode: options.dryRun ? 'dry-run' : 'complete',
    requestLimitReached,
    totalRequests,
    companies: summaries,
    backups
  }, null, 2));
  if (Object.values(summaries).some(summary => summary.errors > 0)) {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Johanson specification lookup failed.');
  process.exitCode = 1;
}
