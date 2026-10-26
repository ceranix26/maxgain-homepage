const API_ENDPOINT = 'https://api.mouser.com/api/v1/search/partnumber';

function fail(message) {
  console.error(message);
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
    fail('Mouser API returned an invalid or unsuccessful response.');
    return;
  }

  const numberOfResults = Number(results.NumberOfResults);
  if (!Number.isInteger(numberOfResults) || numberOfResults < 0) {
    fail('Mouser API response did not include a valid result count.');
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

  console.log(JSON.stringify({
    searchedPartNumber,
    numberOfResults,
    exactMatchCount: exactMatches.length,
    exactMatches
  }, null, 2));
}

await main();
