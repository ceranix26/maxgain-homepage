const PROD_HOST = `https://oapi${process.env.ECOUNT_ZONE}.ecount.com`;
const INV_HOST = `https://oapi${process.env.ECOUNT_ZONE}.ecount.com`;

const COM_CODE = process.env.ECOUNT_COM_CODE;
const USER_ID = process.env.ECOUNT_USER_ID;
const ZONE = process.env.ECOUNT_ZONE;
const TEST_KEY = process.env.ECOUNT_API_CERT_KEY;
const PROD_KEY = process.env.ECOUNT_API_CERT_KEY;
const MAX_PRODUCT_REQUESTS = 20;
const PRODUCT_CODE_UPPER_BOUND = 'ZZZZZZZZZZZZZZZZZZZZ';
const PRODUCT_REQUEST_DELAY_MS = 2_000;

for (const [name, value] of Object.entries({
  ECOUNT_COM_CODE: COM_CODE,
  ECOUNT_USER_ID: USER_ID,
  ECOUNT_ZONE: ZONE,
  ECOUNT_TEST_API_CERT_KEY: TEST_KEY,
  ECOUNT_API_CERT_KEY: PROD_KEY
})) {
  if (!value) throw new Error(`Missing environment variable: ${name}`);
}

const args = process.argv.slice(2);
if (args.some(argument => argument !== '--diagnose-products')) {
  throw new Error(`Unknown argument: ${args.find(argument => argument !== '--diagnose-products')}`);
}
const diagnoseProducts = args.includes('--diagnose-products');

async function post(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'identity',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text);

  if (String(data.Status) !== '200') {
    throw new Error(
      `ECOUNT: ${JSON.stringify(data.Error || data.Errors || data).slice(0, 1000)}`
    );
  }

  return data;
}

function deepFind(obj, key) {
  if (!obj || typeof obj !== 'object') return undefined;

  if (Object.prototype.hasOwnProperty.call(obj, key)) {
    return obj[key];
  }

  for (const value of Object.values(obj)) {
    const found = deepFind(value, key);
    if (found !== undefined) return found;
  }

  return undefined;
}

async function login(host, key) {
  const result = await post(`${host}/OAPI/V2/OAPILogin`, {
    COM_CODE,
    USER_ID,
    ZONE,
    API_CERT_KEY: key,
    LAN_TYPE: 'ko-KR'
  });

  const sessionId = deepFind(result, 'SESSION_ID');

  if (!sessionId) throw new Error('SESSION_ID not found');

  return sessionId;
}

async function getProducts(sessionId, from = '', to = '') {
  const body = {
    SESSION_ID: sessionId,
    PROD_CD: '',
    PROD_TYPE: '',
    COMMA_FLAG: 'N'
  };
  if (from) body.FROM_PROD_CD = from;
  if (to) body.TO_PROD_CD = to;

  const result = await post(
    `${PROD_HOST}/OAPI/V2/InventoryBasic/GetBasicProductsList?SESSION_ID=${encodeURIComponent(sessionId)}`,
    body
  );

  let rows = result?.Data?.Result ?? [];

  if (typeof rows === 'string') {
    rows = JSON.parse(rows);
  }

  if (!Array.isArray(rows)) {
    throw new Error('Product Result is not an array');
  }

  return rows;
}

async function getAllProducts(sessionId) {
  const products = new Map();
  const seenProductCodes = new Set();
  let rawRowCount = 0;
  let fromProductCode = '';

  for (let requestNumber = 1; requestNumber <= MAX_PRODUCT_REQUESTS; requestNumber += 1) {
    const previousCursor = fromProductCode;
    if (requestNumber > 1) {
      await new Promise(resolve => setTimeout(resolve, PRODUCT_REQUEST_DELAY_MS));
    }
    const rows = previousCursor
      ? await getProducts(sessionId, previousCursor, PRODUCT_CODE_UPPER_BOUND)
      : await getProducts(sessionId);
    rawRowCount += rows.length;

    if (rows.length === 0) break;

    const lastRow = rows.at(-1);
    if (lastRow?.PROD_CD == null || String(lastRow.PROD_CD).trim() === '') {
      throw new Error(`Product Master request ${requestNumber} ended with a row missing PROD_CD.`);
    }

    let newProductCodes = 0;
    for (const row of rows) {
      const prodCd = String(row.PROD_CD ?? '').trim();
      const partNumber = String(row.PROD_DES ?? '').trim();
      if (!prodCd) continue;

      if (!seenProductCodes.has(prodCd)) {
        newProductCodes += 1;
        seenProductCodes.add(prodCd);
      }
      if (!partNumber) continue;

      products.set(prodCd, {
        prodCd,
        partNumber,
        size: String(row.SIZE_DES ?? '').trim(),
        balFlag: String(row.BAL_FLAG ?? '').trim(),
        prodType: String(row.PROD_TYPE ?? '').trim()
      });
    }

    console.log(`PRODUCT MASTER REQUEST ${requestNumber} NEW UNIQUE CODES:`, newProductCodes);
    if (rows.length < 10_000) break;

    const nextCursor = lastRow.PROD_CD;
    if (newProductCodes === 0 && String(nextCursor) === String(previousCursor)) break;
    fromProductCode = nextCursor;

    if (requestNumber === MAX_PRODUCT_REQUESTS) {
      throw new Error(`Product Master pagination exceeded the ${MAX_PRODUCT_REQUESTS}-request safety limit.`);
    }
  }

  return { products, rawRowCount };
}

async function diagnoseProductPagination(sessionId) {
  const requests = [
    { label: 'Unbounded', from: '', to: '' },
    { label: 'FROM only', from: '2203-009900', to: '' },
    {
      label: 'FROM and TO',
      from: '2203-009900',
      to: 'ZZZZZZZZZZZZZZZZZZZZ'
    },
    {
      label: 'Known historical next range',
      from: '2203-010049',
      to: 'ZZZZZZZZZZZZZZZZZZZZ'
    },
    {
      label: 'Later historical range',
      from: 'M-0653',
      to: 'ZZZZZZZZZZZZZZZZZZZZ'
    }
  ];

  for (const [index, request] of requests.entries()) {
    const rows = await getProducts(sessionId, request.from, request.to);
    const productCodes = rows
      .map(row => String(row.PROD_CD ?? '').trim())
      .filter(Boolean);
    const uniqueProductCodes = [...new Set(productCodes)];
    const sortedProductCodes = [...uniqueProductCodes].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0
    );

    console.log(`\nPRODUCT MASTER REQUEST ${index + 1}: ${request.label}`);
    console.log('FROM_PROD_CD:', request.from || '(not set)');
    console.log('TO_PROD_CD:', request.to || '(not set)');
    console.log('ROW COUNT:', rows.length);
    console.log('FIRST PROD_CD:', productCodes[0] ?? null);
    console.log('LAST PROD_CD:', productCodes.at(-1) ?? null);
    console.log('UNIQUE PROD_CD VALUES:', uniqueProductCodes.length);
    console.log('MINIMUM PROD_CD:', sortedProductCodes[0] ?? null);
    console.log('MAXIMUM PROD_CD:', sortedProductCodes.at(-1) ?? null);
    console.log('FIRST 10 PROD_CD VALUES:', productCodes.slice(0, 10));
    console.log('LAST 10 PROD_CD VALUES:', productCodes.slice(-10));
  }
}

function collectInventory(node, output = []) {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectInventory(item, output);
    }
    return output;
  }

  if (node && typeof node === 'object') {
    const code =
      node.PROD_CD ??
      node.PROD_CODE ??
      node.ITEM_CD;

    const qty =
      node.BAL_QTY ??
      node.BALANCE_QTY ??
      node.QTY;

    if (code != null && qty != null) {
      output.push({
        prodCd: String(code).trim(),
        quantity: Number(String(qty).replaceAll(',', '')) || 0
      });
    }

    for (const value of Object.values(node)) {
      collectInventory(value, output);
    }
  }

  return output;
}

console.log('=== PRODUCT MASTER ===');

const testSession = await login(PROD_HOST, TEST_KEY);
if (diagnoseProducts) {
  await diagnoseProductPagination(testSession);
} else {
  await updateInventory(testSession);
}

async function updateInventory(testSession) {
  const { products: productMap, rawRowCount } = await getAllProducts(testSession);

  console.log('PRODUCT MASTER RAW ROWS:', rawRowCount);
  console.log('UNIQUE PRODUCT CODES:', productMap.size);
  if (productMap.size < 10_000) {
    console.warn(`WARNING: Product Master returned only ${productMap.size} unique products.`);
  }
  if (productMap.size < 10_000) {
    throw new Error(
      `Refusing to update inventory: Product Master returned ${productMap.size} valid products; at least 10000 are required.`
    );
  }

  console.log('\n=== INVENTORY ===');

  const prodSession = await login(INV_HOST, PROD_KEY);

  const baseDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })
    .format(new Date())
    .replaceAll('-', '');

  const inventoryResponse = await post(
    `${INV_HOST}/OAPI/V2/InventoryBalance/GetListInventoryBalanceStatusByLocation?SESSION_ID=${encodeURIComponent(prodSession)}`,
    {
      SESSION_ID: prodSession,
      BASE_DATE: baseDate,
      ZERO_FLAG: 'Y',
      BAL_FLAG: 'Y',
      DEL_GUBUN: 'Y',
      COM_CODE,
      USER_ID,
      ZONE,
      API_CERT_KEY: PROD_KEY,
      LAN_TYPE: 'ko-KR'
    }
  );

  const inventoryRows = collectInventory(inventoryResponse);

  console.log('RAW INVENTORY ROWS:', inventoryRows.length);

  const inventoryMap = new Map();

  for (const row of inventoryRows) {
    inventoryMap.set(
      row.prodCd,
      (inventoryMap.get(row.prodCd) || 0) + row.quantity
    );
  }

  console.log('UNIQUE INVENTORY CODES:', inventoryMap.size);

  console.log('\n=== MERGE ===');

  const partNumberMap = new Map();

  for (const product of productMap.values()) {
    const quantity = inventoryMap.get(product.prodCd) || 0;
    const existing = partNumberMap.get(product.partNumber);

    if (!existing) {
      partNumberMap.set(product.partNumber, {
        quantity,
        productCodes: [product.prodCd]
      });
    } else {
      existing.quantity += quantity;
      existing.productCodes.push(product.prodCd);
    }
  }

  let inStock = 0;
  let outOfStock = 0;

  for (const item of partNumberMap.values()) {
    if (item.quantity > 0) inStock++;
    else outOfStock++;
  }

  console.log('TOTAL PART NUMBERS:', partNumberMap.size);
  console.log('IN STOCK:', inStock);
  console.log('OUT OF STOCK:', outOfStock);

  console.log('\n=== SAMPLE ===');

  for (const [partNumber, info] of [...partNumberMap.entries()].slice(0, 5)) {
    console.log({
      partNumber,
      status: info.quantity > 0 ? 'in-stock' : 'out-of-stock'
    });
  }

  function getStockLevel(quantity) {
    if (quantity <= 0) return '재고 없음';
    if (quantity < 100) return '소량';
    if (quantity < 500) return '100+';
    if (quantity < 1000) return '500+';
    return '1,000+';
  }

  const items = Object.fromEntries(
    [...partNumberMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([partNumber, info]) => [
        partNumber,
        {
          status: info.quantity > 0 ? 'in-stock' : 'out-of-stock',
          label: info.quantity > 0 ? '재고 있음' : '재고 없음',
          stockLevel: getStockLevel(info.quantity)
        }
      ])
  );

  const output = {
    updatedAt: new Date().toISOString(),
    baseDate,
    source: 'ECOUNT',
    totalPartNumbers: Object.keys(items).length,
    items
  };

  const fs = await import('node:fs/promises');
  await fs.mkdir('data', { recursive: true });

  validateInventoryOutput(output, productMap.size, inStock, outOfStock);
  const temporaryPath = `data/inventory-status.json.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(output, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx'
    });
    const temporaryOutput = JSON.parse(await fs.readFile(temporaryPath, 'utf8'));
    validateInventoryOutput(temporaryOutput, productMap.size, inStock, outOfStock);
    await fs.rename(temporaryPath, 'data/inventory-status.json');
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }

  console.log(
    `Integrated inventory JSON created: ${Object.keys(items).length} Part Numbers`
  );
}

function validateInventoryOutput(output, uniqueProductCount, inStock, outOfStock) {
  if (uniqueProductCount < 10_000) {
    throw new Error(`Cannot write inventory with only ${uniqueProductCount} unique Product Master products.`);
  }
  if (output.totalPartNumbers !== inStock + outOfStock) {
    throw new Error('Cannot write inventory: total Part Numbers do not equal in-stock plus out-of-stock.');
  }
  if (!output.items || Object.keys(output.items).length !== output.totalPartNumbers) {
    throw new Error('Cannot write inventory: items count does not equal totalPartNumbers.');
  }
}
