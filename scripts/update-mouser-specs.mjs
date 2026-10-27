import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const INVENTORY_PATH = path.join(DATA_DIR, 'inventory-status.json');
const SPECS_PATH = path.join(DATA_DIR, 'product-specs.json');
const REVIEW_PATH = path.join(DATA_DIR, 'product-specs-review.json');
const UNRESOLVED_PATH = path.join(DATA_DIR, 'product-specs-unresolved.json');
const API_ENDPOINT = 'https://api.mouser.com/api/v1/search/partnumber';
const MIN_REQUEST_INTERVAL_MS = 2_400;
const PRODUCT_FIELDS = [
  'ManufacturerPartNumber',
  'Manufacturer',
  'Description',
  'Category',
  'DataSheetUrl',
  'ProductDetailUrl',
  'ProductUrl',
  'LifecycleStatus',
  'ROHSStatus'
];
const ATTRIBUTE_FIELDS = [
  'Attributes',
  'ProductAttributes',
  'Specifications',
  'ProductSpecifications',
  'TechnicalSpecifications'
];

function parseArguments() {
  const options = {
    dryRun: false,
    retry: false,
    includeLowConfidence: false,
    limit: Infinity
  };
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--retry') {
      options.retry = true;
    } else if (argument === '--include-low-confidence') {
      options.includeLowConfidence = true;
    } else if (argument === '--limit') {
      const rawLimit = args[++i];
      if (!rawLimit || !/^\d+$/.test(rawLimit) || Number(rawLimit) < 1) {
        throw new Error('--limit requires a positive integer.');
      }
      options.limit = Number(rawLimit);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

async function readJson(filePath, label, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    if (error instanceof SyntaxError) throw new Error(`${label} is not valid JSON.`);
    throw new Error(`Could not read ${label}: ${error.message}`);
  }
}

function validateItemsFile(data, label, allowMissingVersion = false) {
  if (!data || Array.isArray(data) || typeof data !== 'object' ||
      (!allowMissingVersion && data.version !== 1) ||
      (allowMissingVersion && data.version !== undefined && data.version !== 1) ||
      !data.items || Array.isArray(data.items) || typeof data.items !== 'object') {
    throw new Error(`${label} must contain a version 1 items object.`);
  }
  return data;
}

function isHighConfidencePartNumber(value) {
  const partNumber = String(value ?? '').trim();
  return partNumber.length >= 5 &&
    !/\s/.test(partNumber) &&
    /[A-Za-z]/.test(partNumber) &&
    /\d/.test(partNumber) &&
    /^[A-Za-z0-9._/+\\-]+$/.test(partNumber);
}

function normalizeCount(results) {
  const field = Object.hasOwn(results, 'NumberOfResult')
    ? 'NumberOfResult'
    : Object.hasOwn(results, 'NumberOfResults')
      ? 'NumberOfResults'
      : '';
  const rawCount = field ? results[field] : results.Parts.length;
  const count = typeof rawCount === 'number'
    ? rawCount
    : typeof rawCount === 'string' && /^\d+$/.test(rawCount)
      ? Number(rawCount)
      : Number.NaN;
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function safelyCopy(value, apiKey) {
  if (typeof value === 'string') {
    return apiKey ? value.split(apiKey).join('[REDACTED]') : value;
  }
  if (Array.isArray(value)) return value.map(item => safelyCopy(item, apiKey));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      apiKey ? key.split(apiKey).join('[REDACTED]') : key,
      safelyCopy(item, apiKey)
    ]));
  }
  return value;
}

function getHttpsImageUrl(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() ||
      /[\s\u0000-\u001f]/.test(value) || !/^https:\/\//i.test(value)) {
    return '';
  }
  try {
    return new URL(value).protocol === 'https:' ? value : '';
  } catch {
    return '';
  }
}

function copyProduct(product, apiKey) {
  const output = {};
  for (const field of PRODUCT_FIELDS) {
    if (product[field] !== undefined && product[field] !== null) {
      output[field] = safelyCopy(product[field], apiKey);
    }
  }
  const productAttributes = product.ProductAttributes;
  if (Array.isArray(productAttributes) ||
      (productAttributes && typeof productAttributes === 'object')) {
    output.ProductAttributes = safelyCopy(productAttributes, apiKey);
  }
  for (const field of ATTRIBUTE_FIELDS) {
    if (field === 'ProductAttributes') continue;
    const value = product[field];
    if (Array.isArray(value) || (value && typeof value === 'object')) {
      output[field] = safelyCopy(value, apiKey);
    }
  }
  const imageUrl = getHttpsImageUrl(product.ImagePath);
  if (imageUrl) {
    output.image = {
      url: safelyCopy(imageUrl, apiKey),
      source: 'Mouser',
      type: 'representative'
    };
  }
  return output;
}

function apiErrorText(errors) {
  return JSON.stringify(errors).toLowerCase();
}

async function searchMouser(partNumber, apiKey) {
  const endpoint = new URL(API_ENDPOINT);
  endpoint.searchParams.set('apiKey', apiKey);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        SearchByPartRequest: {
          mouserPartNumber: partNumber
        }
      }),
      signal: AbortSignal.timeout(20_000)
    });
  } catch {
    return { error: 'request-failed' };
  }

  if (response.status === 401 || response.status === 403) {
    return { stop: true, error: 'authentication-error' };
  }
  if (response.status === 429) {
    return { stop: true, error: 'rate-limit-error' };
  }
  if (!response.ok) {
    return { error: `http-${response.status}` };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { error: 'invalid-json' };
  }

  const results = data?.SearchResults;
  const errors = data?.Errors ?? results?.Errors;
  if ((Array.isArray(errors) && errors.length) ||
      (errors && !Array.isArray(errors) &&
        (typeof errors !== 'object' || Object.keys(errors).length > 0))) {
    const errorText = apiErrorText(errors);
    const stop = /auth|unauthor|invalid.?key|rate.?limit|too many requests|throttl/.test(errorText);
    return { stop, error: stop ? 'authentication-or-rate-limit-error' : 'api-error' };
  }
  if (!results || !Array.isArray(results.Parts)) {
    return { error: 'unexpected-response' };
  }

  const numberOfResults = normalizeCount(results);
  if (numberOfResults === null) return { error: 'invalid-result-count' };

  return { parts: results.Parts };
}

function makeReviewEntry(partNumber, matches, apiKey) {
  const products = matches.map(product => copyProduct(product, apiKey));
  if (products.length === 1) {
    return {
      status: 'single-exact-match',
      originalPartNumber: partNumber,
      ...products[0],
      source: 'Mouser'
    };
  }
  return {
    status: 'multiple-exact-matches',
    originalPartNumber: partNumber,
    matches: products,
    source: 'Mouser'
  };
}

async function writeAtomically(files) {
  const temporaryFiles = [];
  try {
    for (const [filePath, contents] of files) {
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      await fs.writeFile(temporaryPath, contents, { encoding: 'utf8', flag: 'wx' });
      temporaryFiles.push([temporaryPath, filePath]);
    }
    for (const [temporaryPath, filePath] of temporaryFiles) {
      await fs.rename(temporaryPath, filePath);
    }
  } catch (error) {
    await Promise.all(temporaryFiles.map(([temporaryPath]) =>
      fs.rm(temporaryPath, { force: true })));
    throw error;
  }
}

async function main() {
  const options = parseArguments();
  const apiKey = process.env.MOUSER_API_KEY;
  if (!apiKey) throw new Error('Missing required environment variable: MOUSER_API_KEY.');

  const inventory = validateItemsFile(
    await readJson(INVENTORY_PATH, 'inventory-status.json'),
    'inventory-status.json',
    true
  );
  const specifications = validateItemsFile(
    await readJson(SPECS_PATH, 'product-specs.json'),
    'product-specs.json'
  );
  const review = validateItemsFile(
    await readJson(REVIEW_PATH, 'product-specs-review.json', { version: 1, items: {} }),
    'product-specs-review.json'
  );
  const unresolved = validateItemsFile(
    await readJson(UNRESOLVED_PATH, 'product-specs-unresolved.json', { version: 1, items: {} }),
    'product-specs-unresolved.json'
  );

  const inventoryPartNumbers = Object.keys(inventory.items);
  const specified = new Set(Object.keys(specifications.items));
  const alreadyProcessed = new Set([
    ...Object.keys(review.items),
    ...Object.keys(unresolved.items)
  ]);
  const unprocessedInventoryPartNumbers = inventoryPartNumbers.filter(partNumber =>
    String(partNumber ?? '').trim() &&
    !specified.has(partNumber) &&
    (options.retry || !alreadyProcessed.has(partNumber))
  );
  const highConfidenceCandidates = unprocessedInventoryPartNumbers
    .filter(isHighConfidencePartNumber);
  const lowConfidenceCandidates = unprocessedInventoryPartNumbers
    .filter(partNumber => !isHighConfidencePartNumber(partNumber));
  const candidates = options.includeLowConfidence
    ? [...highConfidenceCandidates, ...lowConfidenceCandidates]
    : highConfidenceCandidates;
  const requestedPartNumbers = candidates.slice(0, options.limit);
  const summary = {
    inventoryTotal: inventoryPartNumbers.length,
    alreadySpecified: inventoryPartNumbers.filter(partNumber => specified.has(partNumber)).length,
    eligible: candidates.length,
    highConfidence: highConfidenceCandidates.length,
    lowConfidenceSkipped: options.includeLowConfidence ? 0 : lowConfidenceCandidates.length,
    apiRequests: 0,
    singleExactMatches: 0,
    multipleExactMatches: 0,
    unresolved: 0,
    errors: 0
  };

  let previousRequestAt = 0;
  let stopped = false;
  for (const partNumber of requestedPartNumbers) {
    const delay = MIN_REQUEST_INTERVAL_MS - (Date.now() - previousRequestAt);
    if (previousRequestAt && delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    previousRequestAt = Date.now();
    summary.apiRequests += 1;

    const result = await searchMouser(partNumber, apiKey);
    if (result.error) {
      summary.errors += 1;
      console.error(`ERROR ${partNumber}: ${result.error}`);
      if (result.stop) {
        stopped = true;
        break;
      }
      continue;
    }

    const exactMatches = result.parts.filter(product =>
      typeof product?.ManufacturerPartNumber === 'string' &&
      product.ManufacturerPartNumber.toLowerCase() === partNumber.toLowerCase()
    );
    if (exactMatches.length === 0) {
      summary.unresolved += 1;
      unresolved.items[partNumber] = {
        originalPartNumber: partNumber,
        reason: 'no-exact-mpn-match'
      };
      delete review.items[partNumber];
      console.log(`${options.dryRun ? 'WOULD MARK UNRESOLVED' : 'UNRESOLVED'} ${partNumber}`);
    } else {
      const entry = makeReviewEntry(partNumber, exactMatches, apiKey);
      review.items[partNumber] = entry;
      delete unresolved.items[partNumber];
      if (exactMatches.length === 1) {
        summary.singleExactMatches += 1;
        console.log(`${options.dryRun ? 'WOULD REVIEW' : 'REVIEW'} ${partNumber}: single exact match`);
      } else {
        summary.multipleExactMatches += 1;
        console.log(`${options.dryRun ? 'WOULD REVIEW' : 'REVIEW'} ${partNumber}: multiple exact matches`);
      }
    }
  }

  if (!options.dryRun && !stopped && summary.errors === 0) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await writeAtomically([
      [REVIEW_PATH, `${JSON.stringify(review, null, 2)}\n`],
      [UNRESOLVED_PATH, `${JSON.stringify(unresolved, null, 2)}\n`]
    ]);
  } else if (options.dryRun) {
    console.log('Dry run: review and unresolved files were not written.');
  } else if (stopped || summary.errors > 0) {
    console.error('Review and unresolved files were not written because processing did not complete successfully.');
  }

  console.log('Summary:');
  console.log(JSON.stringify(summary, null, 2));
  if (summary.errors > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown importer error.';
  console.error(message);
  process.exitCode = 1;
}
