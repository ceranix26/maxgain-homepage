const API_ENDPOINT = 'https://api.mouser.com/api/v1/search/partnumber';

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function diagnosticPropertyNames(value, apiKey) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value).map(name => apiKey ? name.split(apiKey).join('[REDACTED]') : name);
}

function redactApiKey(value, apiKey) {
  if (typeof value === 'string') {
    return apiKey ? value.split(apiKey).join('[REDACTED]') : value;
  }
  if (Array.isArray(value)) return value.map(item => redactApiKey(item, apiKey));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, item]) => [
      name === apiKey ? '[REDACTED]' : name,
      redactApiKey(item, apiKey)
    ]));
  }
  return value;
}

function diagnoseUnexpectedResponse(data, status, apiKey) {
  const diagnostic = {
    httpStatus: status,
    topLevelPropertyNames: diagnosticPropertyNames(data, apiKey)
  };
  const results = data?.SearchResults;

  if (results !== undefined) {
    diagnostic.searchResultsPropertyNames = diagnosticPropertyNames(results, apiKey);
    diagnostic.partsIsArray = Array.isArray(results?.Parts);
    if (Array.isArray(results?.Parts)) {
      diagnostic.partsLength = results.Parts.length;
    }
    for (const field of ['NumberOfResult', 'NumberOfResults']) {
      if (Object.hasOwn(results, field)) {
        diagnostic[field] = {
          typeof: typeof results[field],
          rawValue: redactApiKey(results[field], apiKey)
        };
      }
    }
  }

  console.error(JSON.stringify(diagnostic, null, 2));
  process.exitCode = 1;
}

async function main() {
  const [searchedPartNumber] = process.argv.slice(2);
  if (process.argv.slice(2).length !== 1 || !searchedPartNumber.trim()) {
    fail('Usage: node scripts/lookup-mouser.mjs <manufacturer-part-number>');
    return;
  }

  const apiKey = process.env.MOUSER_API_KEY;
  if (!apiKey) {
    fail('Missing required environment variable: MOUSER_API_KEY');
    return;
  }

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
          mouserPartNumber: searchedPartNumber
        }
      }),
      signal: AbortSignal.timeout(20_000)
    });
  } catch {
    fail('Mouser API request failed.');
    return;
  }

  if (!response.ok) {
    fail(`Mouser API returned HTTP ${response.status}.`);
    return;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    fail('Mouser API returned invalid JSON.');
    return;
  }

  const results = data?.SearchResults;
  if (data?.Errors?.length || results?.Errors?.length || !results ||
      !Array.isArray(results.Parts)) {
    diagnoseUnexpectedResponse(data, response.status, apiKey);
    return;
  }

  const countField = Object.hasOwn(results, 'NumberOfResult')
    ? 'NumberOfResult'
    : Object.hasOwn(results, 'NumberOfResults')
      ? 'NumberOfResults'
      : '';
  const rawCount = countField ? results[countField] : results.Parts.length;
  const numberOfResults = typeof rawCount === 'number'
    ? rawCount
    : typeof rawCount === 'string' && /^\d+$/.test(rawCount)
      ? Number(rawCount)
      : Number.NaN;
  if (!Number.isInteger(numberOfResults) || numberOfResults < 0) {
    diagnoseUnexpectedResponse(data, response.status, apiKey);
    return;
  }

  const exactMatches = results.Parts
    .filter(part => part?.ManufacturerPartNumber === searchedPartNumber)
    .map(part => {
      const match = {};
      for (const field of [
        'ManufacturerPartNumber',
        'Manufacturer',
        'Description',
        'Category',
        'DataSheetUrl',
        'LifecycleStatus',
        'ROHSStatus'
      ]) {
        if (part[field] !== undefined && part[field] !== null) {
          match[field] = part[field];
        }
      }
      return match;
    });

  console.log(JSON.stringify(redactApiKey({
    searchedPartNumber,
    numberOfResults,
    exactMatchCount: exactMatches.length,
    exactMatches
  }, apiKey), null, 2));
}

await main();
