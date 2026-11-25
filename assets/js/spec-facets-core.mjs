// Proposed v1 consumer. This module never calls Hub or ECOUNT.
const REVIEW_STATES = new Set(['APPROVED', 'UNREVIEWED', 'REJECTED']);
const FAMILIES = new Set(['MLCC', 'Chip Resistor']);
const SIZE_SYSTEMS = new Set(['EIA-inch', 'metric']);
const OWN = (value, key) => Object.hasOwn(value, key);

function requireObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: object required`);
  return value;
}

function requireKeys(value, required, allowed, path) {
  requireObject(value, path);
  for (const key of required) if (!OWN(value, key)) throw new Error(`${path}.${key}: required`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${path}.${key}: unknown field`);
}

function requireText(value, path) {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`${path}: nonempty text required`);
  }
}

function requireTime(value, path) {
  requireText(value, path);
  if (!/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${path}: date-time required`);
  }
}

export function canonicalDecimal(value) {
  const match = typeof value === 'string' &&
    /^(0|[1-9]\d*)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) throw new Error('nonnegative decimal string required');
  const exponent = Number(match[3] || '0');
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) throw new Error('invalid decimal exponent');
  let digits = `${match[1]}${match[2] || ''}`.replace(/^0+/, '');
  if (!digits) return '0e0';
  const trimmed = digits.replace(/0+$/, '');
  return `${trimmed}e${exponent - (match[2]?.length || 0) + digits.length - trimmed.length}`;
}

function requireDecimal(value, path, positive = false) {
  let canonical;
  try { canonical = canonicalDecimal(value); } catch { throw new Error(`${path}: nonnegative decimal string required`); }
  if (positive && canonical === '0e0') throw new Error(`${path}: invalid number`);
}

function validateEvidence(values, path, datasetKind, reviewTargetVersion) {
  if (!Array.isArray(values) || !values.length) throw new Error(`${path}: evidence required`);
  values.forEach((value, index) => {
    const at = `${path}[${index}]`;
    const fields = ['sourceLabel', 'rawValue', 'sourceUrl', 'sourceSha256',
      'retrievedAt', 'reviewTargetVersion', 'reviewStatus'];
    requireKeys(value, fields, fields, at);
    requireText(value.sourceLabel, `${at}.sourceLabel`);
    requireText(value.rawValue, `${at}.rawValue`);
    requireText(value.sourceUrl, `${at}.sourceUrl`);
    let url;
    try { url = new URL(value.sourceUrl); } catch { throw new Error(`${at}.sourceUrl: invalid URL`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
        (datasetKind === 'approved-catalog' && url.hostname.endsWith('.invalid'))) {
      throw new Error(`${at}.sourceUrl: approved HTTPS URL required`);
    }
    if (!/^[a-f0-9]{64}$/.test(value.sourceSha256)) throw new Error(`${at}.sourceSha256: SHA256 required`);
    requireTime(value.retrievedAt, `${at}.retrievedAt`);
    requireText(value.reviewTargetVersion, `${at}.reviewTargetVersion`);
    if (value.reviewTargetVersion !== reviewTargetVersion) throw new Error(`${at}.reviewTargetVersion: mismatched record version`);
    if (!REVIEW_STATES.has(value.reviewStatus)) throw new Error(`${at}.reviewStatus: unsupported`);
  });
}

function validateField(value, path, datasetKind, reviewTargetVersion, type) {
  const required = type === 'size' ? ['raw', 'normalized', 'system', 'evidence']
    : type === 'quantity' ? ['raw', 'normalizedValue', 'unit', 'evidence']
      : type === 'tolerance' ? ['raw', 'plusPercent', 'minusPercent', 'evidence']
        : ['raw', 'normalized', 'evidence'];
  requireKeys(value, required, required, path);
  requireText(value.raw, `${path}.raw`);
  if (type === 'quantity') {
    requireDecimal(value.normalizedValue, `${path}.normalizedValue`, value.unit === 'F');
    if (!['F', 'ohm'].includes(value.unit)) throw new Error(`${path}.unit: unsupported`);
  } else if (type === 'tolerance') {
    requireDecimal(value.plusPercent, `${path}.plusPercent`);
    requireDecimal(value.minusPercent, `${path}.minusPercent`);
  } else {
    requireText(value.normalized, `${path}.normalized`);
    if (type === 'family' && !FAMILIES.has(value.normalized)) throw new Error(`${path}.normalized: unsupported family`);
    if (type === 'size' && !SIZE_SYSTEMS.has(value.system)) throw new Error(`${path}.system: required`);
  }
  validateEvidence(value.evidence, `${path}.evidence`, datasetKind, reviewTargetVersion);
}

export function validateFacetIndex(index, { expectedKind } = {}) {
  requireKeys(index, ['version', 'datasetKind', 'generatedAt', 'items'],
    ['version', 'datasetKind', 'generatedAt', 'items'], 'index');
  if (index.version !== 1) throw new Error('index.version: unsupported');
  if (!['synthetic-fixture', 'approved-catalog'].includes(index.datasetKind) ||
      (expectedKind && index.datasetKind !== expectedKind)) throw new Error('index.datasetKind: unexpected');
  requireTime(index.generatedAt, 'index.generatedAt');
  requireObject(index.items, 'index.items');
  const aliases = new Map();
  for (const [partNumber, item] of Object.entries(index.items)) {
    requireText(partNumber, 'index.items key');
    const path = `index.items[${partNumber}]`;
    requireKeys(item, ['manufacturer', 'aliases', 'parseStatus', 'reviewTargetVersion', 'reviewStatus', 'facets'],
      ['manufacturer', 'aliases', 'parseStatus', 'reviewTargetVersion', 'reviewStatus', 'facets'], path);
    requireText(item.manufacturer, `${path}.manufacturer`);
    requireText(item.reviewTargetVersion, `${path}.reviewTargetVersion`);
    if (!Array.isArray(item.aliases)) throw new Error(`${path}.aliases: array required`);
    item.aliases.forEach((alias, aliasIndex) => {
      const at = `${path}.aliases[${aliasIndex}]`;
      requireKeys(alias, ['partNumber', 'relation', 'reviewStatus', 'evidence'],
        ['partNumber', 'relation', 'reviewStatus', 'evidence'], at);
      requireText(alias.partNumber, `${at}.partNumber`);
      if (alias.relation !== 'LEGACY_TO_GPN') throw new Error(`${at}.relation: unsupported`);
      if (!REVIEW_STATES.has(alias.reviewStatus)) throw new Error(`${at}.reviewStatus: unsupported`);
      validateEvidence(alias.evidence, `${at}.evidence`, index.datasetKind, item.reviewTargetVersion);
    });
    if (new Set(item.aliases.map(alias => partKey(alias.partNumber))).size !== item.aliases.length) {
      throw new Error(`${path}.aliases: duplicate`);
    }
    if (!['PARSED_EXACT', 'REVIEW_REQUIRED'].includes(item.parseStatus)) throw new Error(`${path}.parseStatus: unsupported`);
    if (!REVIEW_STATES.has(item.reviewStatus)) throw new Error(`${path}.reviewStatus: unsupported`);
    const f = item.facets;
    requireObject(f, `${path}.facets`);
    validateField(f.family, `${path}.facets.family`, index.datasetKind, item.reviewTargetVersion, 'family');
    const quantityKey = f.family.normalized === 'MLCC' ? 'capacitance' : 'resistance';
    requireKeys(f, ['family', 'size', quantityKey, 'tolerance'],
      ['family', 'size', quantityKey, 'tolerance'], `${path}.facets`);
    validateField(f.size, `${path}.facets.size`, index.datasetKind, item.reviewTargetVersion, 'size');
    validateField(f[quantityKey], `${path}.facets.${quantityKey}`, index.datasetKind, item.reviewTargetVersion, 'quantity');
    validateField(f.tolerance, `${path}.facets.tolerance`, index.datasetKind, item.reviewTargetVersion, 'tolerance');
    if (f[quantityKey].unit !== (quantityKey === 'capacitance' ? 'F' : 'ohm')) {
      throw new Error(`${path}.facets.${quantityKey}.unit: wrong family unit`);
    }
    if (index.datasetKind === 'approved-catalog' && (!isSelectable(item) || item.aliases.some(alias => !isApprovedAlias(alias)))) {
      throw new Error(`${path}: unapproved data cannot be published`);
    }
    for (const name of [partNumber, ...item.aliases.filter(isApprovedAlias).map(alias => alias.partNumber)]) {
      const key = partKey(name);
      const owner = aliases.get(key);
      if (owner && owner !== partNumber) throw new Error(`Conflicting alias: ${name}`);
      aliases.set(key, partNumber);
    }
  }
  return index;
}

export function validateInventory(inventory) {
  requireKeys(inventory, ['updatedAt', 'baseDate', 'source', 'totalPartNumbers', 'items'],
    ['updatedAt', 'baseDate', 'source', 'totalPartNumbers', 'items'], 'inventory');
  requireTime(inventory.updatedAt, 'inventory.updatedAt');
  requireText(inventory.baseDate, 'inventory.baseDate');
  requireText(inventory.source, 'inventory.source');
  requireObject(inventory.items, 'inventory.items');
  if (inventory.totalPartNumbers !== Object.keys(inventory.items).length) throw new Error('inventory count mismatch');
  for (const [partNumber, stock] of Object.entries(inventory.items)) {
    requireText(partNumber, 'inventory item key');
    requireKeys(stock, ['status', 'label', 'stockLevel'], ['status', 'label', 'stockLevel'], `inventory[${partNumber}]`);
    if (!['in-stock', 'out-of-stock'].includes(stock.status)) throw new Error(`inventory[${partNumber}].status`);
    requireText(stock.label, `inventory[${partNumber}].label`);
    if (typeof stock.stockLevel !== 'string') throw new Error(`inventory[${partNumber}].stockLevel`);
  }
  return inventory;
}

// Identity joins retain exact case, spacing, punctuation, and leading zeroes.
export const partKey = value => typeof value === 'string' ? value : null;
const valueKey = field => `${canonicalDecimal(field.normalizedValue)}:${field.unit}`;
const toleranceKey = field => `${canonicalDecimal(field.plusPercent)}:${canonicalDecimal(field.minusPercent)}`;

function isSelectable(item) {
  const f = item.facets;
  const quantity = f.family.normalized === 'MLCC' ? f.capacitance : f.resistance;
  return item.parseStatus === 'PARSED_EXACT' && item.reviewStatus === 'APPROVED' &&
    [f.family, f.size, quantity, f.tolerance].every(field =>
      field.evidence.every(evidence => evidence.reviewStatus === 'APPROVED'));
}

function isApprovedAlias(alias) {
  return alias.reviewStatus === 'APPROVED' &&
    alias.evidence.every(evidence => evidence.reviewStatus === 'APPROVED');
}

export function joinApprovedFacets(inventory, index, { expectedKind } = {}) {
  validateInventory(inventory);
  validateFacetIndex(index, { expectedKind });
  const stock = new Map(Object.entries(inventory.items).map(([part, value]) => [partKey(part), { part, value }]));
  const rows = [];
  const counts = { catalogRecords: Object.keys(index.items).length, unreviewed: 0, noActiveInventoryMatch: 0, usable: 0 };
  for (const [canonicalPartNumber, item] of Object.entries(index.items)) {
    if (!isSelectable(item)) { counts.unreviewed += 1; continue; }
    const matched = [...new Set([canonicalPartNumber, ...item.aliases.filter(isApprovedAlias).map(alias => alias.partNumber)].map(partKey))]
      .map(key => stock.get(key)).filter(Boolean);
    if (!matched.length) { counts.noActiveInventoryMatch += 1; continue; }
    const f = item.facets;
    const quantity = f.family.normalized === 'MLCC' ? f.capacitance : f.resistance;
    rows.push({
      canonicalPartNumber,
      inventoryPartNumbers: matched.map(entry => entry.part),
      manufacturer: item.manufacturer,
      family: f.family.normalized,
      size: `${f.size.system}:${f.size.normalized}`,
      sizeLabel: `${f.size.normalized} (${f.size.system})`,
      value: valueKey(quantity),
      valueLabel: formatQuantity(quantity),
      tolerance: toleranceKey(f.tolerance),
      toleranceLabel: formatTolerance(f.tolerance),
      status: matched.some(entry => entry.value.status === 'in-stock') ? 'in-stock' : 'out-of-stock'
    });
  }
  counts.usable = rows.length;
  return { rows, counts };
}

function decimalText(value, shift = 0) {
  const [digits, power] = canonicalDecimal(value).split('e');
  if (digits === '0') return '0';
  const point = digits.length + Number(power) + shift;
  if (point > 40 || point < -40) return `${digits[0]}${digits.length > 1 ? `.${digits.slice(1)}` : ''}e${point - 1}`;
  if (point <= 0) return `0.${'0'.repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + '0'.repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

function formatQuantity(field) {
  const [digits, power] = canonicalDecimal(field.normalizedValue).split('e');
  const magnitude = digits === '0' ? -Infinity : digits.length - 1 + Number(power);
  const units = field.unit === 'F'
    ? [[0, 'F'], [-3, 'mF'], [-6, 'µF'], [-9, 'nF'], [-12, 'pF']]
    : [[6, 'MΩ'], [3, 'kΩ'], [0, 'Ω']];
  const [unitPower, label] = units.find(([candidate]) => magnitude >= candidate) || units.at(-1);
  return `${decimalText(field.normalizedValue, -unitPower)} ${label}`;
}

function formatTolerance(field) {
  const plus = decimalText(field.plusPercent), minus = decimalText(field.minusPercent);
  return canonicalDecimal(field.plusPercent) === canonicalDecimal(field.minusPercent)
    ? `±${plus}%` : `+${plus}% / -${minus}%`;
}

export function applySelection(rows, selection = {}) {
  return rows.filter(row => (!selection.family || row.family === selection.family) &&
    (!selection.size || row.size === selection.size) &&
    (!selection.value || row.value === selection.value) &&
    (!selection.tolerance || row.tolerance === selection.tolerance));
}

function optionCounts(rows, key, labelKey = key) {
  const options = new Map();
  for (const row of rows) {
    const value = row[key];
    const entry = options.get(value) || { value, label: row[labelKey], count: 0 };
    entry.count += 1;
    options.set(value, entry);
  }
  return [...options.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko', { numeric: true }));
}

export function getStepOptions(rows, selection = {}) {
  const byFamily = applySelection(rows, { family: selection.family });
  const bySize = applySelection(byFamily, { size: selection.size });
  const byValue = applySelection(bySize, { value: selection.value });
  return {
    family: optionCounts(rows, 'family'),
    size: selection.family ? optionCounts(byFamily, 'size', 'sizeLabel') : [],
    value: selection.size ? optionCounts(bySize, 'value', 'valueLabel') : [],
    tolerance: selection.value ? optionCounts(byValue, 'tolerance', 'toleranceLabel') : []
  };
}
