// Public display-only contract. These values never participate in keyword or facet matching.
const own = (object, key) => Object.hasOwn(object, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim() && !/[\u0000-\u001f]/.test(value);

function exactKeys(value, required, path) {
  if (!object(value) || required.some(key => !own(value, key)) ||
      Object.keys(value).some(key => !required.includes(key))) {
    throw new Error(`${path}: invalid fields`);
  }
}

function approvedEvidence(value, path) {
  const keys = ['sourceLabel', 'rawValue', 'sourceUrl', 'sourceSha256',
    'retrievedAt', 'reviewTargetVersion', 'reviewStatus'];
  exactKeys(value, keys, path);
  for (const key of ['sourceLabel', 'rawValue']) {
    if (!text(value[key])) throw new Error(`${path}.${key}: text required`);
  }
  if (!/^[a-f0-9]{64}$/.test(value.reviewTargetVersion)) throw new Error(`${path}: invalid review target`);
  if (value.reviewStatus !== 'APPROVED') throw new Error(`${path}: unapproved evidence`);
  if (!/^[a-f0-9]{64}$/.test(value.sourceSha256)) throw new Error(`${path}: invalid SHA256`);
  if (!/^\d{4}-\d\d-\d\dT/.test(value.retrievedAt) || !Number.isFinite(Date.parse(value.retrievedAt))) {
    throw new Error(`${path}: invalid retrieval time`);
  }
  let url;
  try { url = new URL(value.sourceUrl); } catch { throw new Error(`${path}: invalid source URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash ||
      !url.hostname || url.hostname.endsWith('.invalid')) throw new Error(`${path}: invalid source URL`);
}

export function validateDisplaySpecs(index) {
  exactKeys(index, ['version', 'datasetKind', 'generatedAt', 'items'], 'index');
  if (index.version !== 1 || index.datasetKind !== 'approved-catalog-specifications') {
    throw new Error('Unexpected display specification dataset');
  }
  if (!/^\d{4}-\d\d-\d\dT/.test(index.generatedAt) || !Number.isFinite(Date.parse(index.generatedAt))) {
    throw new Error('Invalid generation time');
  }
  if (!object(index.items)) throw new Error('Invalid items');
  for (const [partNumber, item] of Object.entries(index.items)) {
    if (!text(partNumber) || partNumber !== partNumber.trim() || partNumber.length > 250) throw new Error('Invalid exact part number');
    exactKeys(item, ['manufacturer', 'specifications'], `items[${partNumber}]`);
    if (!text(item.manufacturer) || item.manufacturer.length > 120 || !Array.isArray(item.specifications) ||
        !item.specifications.length || item.specifications.length > 200) {
      throw new Error(`items[${partNumber}]: invalid manufacturer or specifications`);
    }
    const pairs = new Set();
    item.specifications.forEach((spec, position) => {
      const path = `items[${partNumber}].specifications[${position}]`;
      exactKeys(spec, ['label', 'raw_value', 'review_status', 'evidence'], path);
      if (!text(spec.label) || spec.label.length > 200 || !text(spec.raw_value) || spec.raw_value.length > 2000 ||
          spec.review_status !== 'APPROVED' ||
          !Array.isArray(spec.evidence) || !spec.evidence.length) throw new Error(`${path}: unapproved or empty`);
      const pair = JSON.stringify([spec.label, spec.raw_value]);
      if (pairs.has(pair)) throw new Error(`${path}: duplicate value`);
      pairs.add(pair);
      spec.evidence.forEach((proof, proofIndex) => approvedEvidence(proof, `${path}.evidence[${proofIndex}]`));
    });
  }
  return index;
}

// Inventory keys are authoritative and exact. No case folding, trimming, or inferred aliases.
export function joinDisplaySpecs(inventory, index) {
  validateDisplaySpecs(index);
  if (!object(inventory?.items)) throw new Error('Invalid inventory');
  const joined = new Map();
  for (const [partNumber, item] of Object.entries(index.items)) {
    if (own(inventory.items, partNumber)) joined.set(partNumber, item);
  }
  return joined;
}
