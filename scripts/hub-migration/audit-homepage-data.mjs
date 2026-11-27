import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync, chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const DATASETS = [
  ['product-specs.json', 'legacy-product-specs', 'items', 'legacy'],
  ['product-manufacturers.json', 'legacy-manufacturer-map', 'items', 'legacy'],
  ['product-aliases.json', 'legacy-alias-map', 'aliases', 'legacy'],
  ['product-candidates.json', 'legacy-part-candidates', 'items', 'legacy'],
  ['product-image-index.json', 'legacy-image-index', 'items', 'legacy'],
  ['product-item-groups.json', 'legacy-item-groups', 'items', 'legacy'],
  ['walsin-chip-resistor-review.json', 'legacy-review-draft', 'items', 'legacy'],
  ['inventory-status.json', 'generated-hub-inventory-public', 'items', 'generated'],
  ['catalog-display-specs.v1.json', 'generated-hub-approved-display-public', 'items', 'generated'],
  ['site-popups.v1.json', 'generated-hub-popup-public', 'items', 'generated'],
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : isObject(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const recordSha = value => sha256(JSON.stringify(canonical(value)));
const normalizeForDiagnosticOnly = value => String(value).trim().toUpperCase();
const pointerPart = value => String(value).replaceAll('~', '~0').replaceAll('/', '~1');

function readDataset(root, filename, collection) {
  const file = join(root, 'data', filename);
  const bytes = readFileSync(file);
  const parsed = JSON.parse(bytes);
  const records = parsed[collection];
  if (!isObject(records) && !(filename === 'site-popups.v1.json' && Array.isArray(records))) {
    throw new Error(`Invalid ${collection} in ${filename}`);
  }
  return { file: `data/${filename}`, sha256: sha256(bytes), bytes: bytes.length, parsed, records };
}

function assetDigests(root, subdir) {
  const base = join(root, 'assets', 'images', subdir);
  if (!existsSync(base)) return [];
  const files = [];
  const visit = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const bytes = readFileSync(path);
        files.push({ path: relative(root, path).replaceAll(sep, '/'), sha256: sha256(bytes), bytes: bytes.length });
      }
    }
  };
  visit(base);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function buildAudit(rootInput, { companyId = null, environment = 'PRODUCTION', companyScopeProvenance = null } = {}) {
  const root = realpathSync(rootInput);
  const loaded = Object.fromEntries(DATASETS.map(([name, datasetKind, collection, role]) =>
    [name, { ...readDataset(root, name, collection), datasetKind, collection, role }]));
  const active = new Set(Object.keys(loaded['inventory-status.json'].records));
  const files = [], records = [], datasetSummary = {};
  for (const [name, datasetKind, , role] of DATASETS) {
    const source = loaded[name];
    const entries = Object.entries(source.records).sort(([a], [b]) => a.localeCompare(b));
    const normalizedGroups = new Map();
    for (const [key] of entries) {
      const diagnosticKey = normalizeForDiagnosticOnly(key);
      if (!normalizedGroups.has(diagnosticKey)) normalizedGroups.set(diagnosticKey, []);
      normalizedGroups.get(diagnosticKey).push(key);
    }
    files.push({ dataset_kind: datasetKind, role, repository_relative_path: source.file,
      sha256: source.sha256, byte_length: source.bytes, record_count: entries.length });
    datasetSummary[datasetKind] = {
      record_count: entries.length,
      exact_active_source_keys: entries.filter(([key]) => active.has(key)).length,
      normalized_key_collision_groups: [...normalizedGroups.values()].filter(keys => keys.length > 1).length,
    };
    if (role !== 'legacy') continue;
    for (const [key, value] of entries) {
      const candidate = datasetKind === 'legacy-alias-map' ? value
        : datasetKind === 'legacy-image-index' ? null
          : typeof value?.partNumbers?.primary === 'string' ? value.partNumbers.primary : key;
      const exactMatches = [...new Set([key, candidate].filter(pn => typeof pn === 'string' && active.has(pn)))];
      const issues = ['COMPANY_ITEM_BINDING_UNVERIFIED', 'NO_CONFIRMED_ERP_BINDING', 'NO_VERIFIED_OFFICIAL_RAW_RECEIPT'];
      if (!companyId) issues.push('COMPANY_SCOPE_UNVERIFIED');
      if (!exactMatches.length) issues.push('NO_EXACT_ACTIVE_INVENTORY_MATCH');
      if ((normalizedGroups.get(normalizeForDiagnosticOnly(key)) || []).length > 1) issues.push('NORMALIZED_KEY_COLLISION_DIAGNOSTIC');
      records.push({
        dataset_kind: datasetKind,
        source_file_sha256: source.sha256,
        json_pointer: `/${source.collection}/${pointerPart(key)}`,
        source_key_raw: key,
        legacy_mpn_raw: datasetKind === 'legacy-image-index' ? null : key,
        manufacturer_raw: typeof value?.manufacturer === 'string' ? value.manufacturer : null,
        canonical_mpn_candidate: typeof candidate === 'string' ? candidate : null,
        inventory_exact_pn_matches: exactMatches,
        erp_binding: null,
        official_raw_sha256: null,
        source_observed_at: null,
        evidence_state: 'LEGACY_UNVERIFIED',
        import_allowed: false,
        publication_allowed: false,
        record_value_canonical_sha256: recordSha(value),
        issues,
      });
    }
  }

  const specs = loaded['product-specs.json'].records;
  const aliases = loaded['product-aliases.json'].records;
  const approved = loaded['catalog-display-specs.v1.json'].records;
  const sourceUrlCount = Object.values(specs).filter(value =>
    typeof value?.source?.url === 'string' && value.source.url.trim()).length;
  const sourceReceiptHashCount = Object.values(specs).filter(value =>
    typeof value?.source?.sha256 === 'string' || typeof value?.source?.sourceSha256 === 'string').length;
  const aliasExactTargetCount = Object.values(aliases).filter(target => typeof target === 'string' && active.has(target)).length;
  const aliasMissingExactTargetCount = Object.values(aliases).filter(target => typeof target !== 'string' || !active.has(target)).length;
  const approvedFieldCount = Object.values(approved).reduce((sum, item) =>
    sum + (Array.isArray(item?.specifications) ? item.specifications.length : 0), 0);
  const assets = [
    ...assetDigests(root, 'products'),
    ...assetDigests(root, 'notices'),
  ];
  return {
    schema_version: 1,
    kind: 'hub-homepage-legacy-audit.v1',
    audit_id: sha256(JSON.stringify([companyId, environment,
      files.map(file => [file.repository_relative_path, file.sha256]),
      assets.map(asset => [asset.path, asset.sha256])])),
    audited_at: new Date().toISOString(),
    repository: 'ceranix26/maxgain-homepage',
    source_commit: (() => {
      try { return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
      catch { return null; }
    })(),
    company_id: companyId,
    company_label: 'MAXGAIN',
    company_scope_provenance: companyScopeProvenance,
    environment,
    dry_run: true,
    publication_allowed: false,
    approval_granted: false,
    identity_rule: 'exact-part-number-only; case/whitespace normalized keys are diagnostic only',
    files,
    records,
    dataset_summary: datasetSummary,
    inventory_reference: {
      repository_relative_path: loaded['inventory-status.json'].file,
      sha256: loaded['inventory-status.json'].sha256,
      base_date: loaded['inventory-status.json'].parsed.baseDate ?? null,
      updated_at: loaded['inventory-status.json'].parsed.updatedAt ?? null,
      exact_part_number_count: active.size,
    },
    assets,
    coverage: {
      inventory_exact_part_numbers: active.size,
      legacy_specification_source_url_count: sourceUrlCount,
      legacy_specification_unverified_source_hash_field_count: sourceReceiptHashCount,
      alias_exact_active_target_count: aliasExactTargetCount,
      alias_target_not_in_current_active_inventory_exact_count: aliasMissingExactTargetCount,
      approved_display_part_numbers: Object.keys(approved).length,
      approved_display_field_count: approvedFieldCount,
    },
  };
}

export function verifyAuditAgainstSource(rootInput, audit) {
  const root = realpathSync(rootInput);
  if (audit.kind !== 'hub-homepage-legacy-audit.v1' || audit.dry_run !== true ||
      audit.publication_allowed !== false || audit.approval_granted !== false) {
    throw new Error('Audit safety envelope changed');
  }
  if (audit.files.length !== DATASETS.length) throw new Error('Dataset file count changed');
  const active = new Set(Object.keys(readDataset(root, 'inventory-status.json', 'items').records));
  let verifiedLegacyRecords = 0;
  for (const [name, kind, collection, role] of DATASETS) {
    const source = readDataset(root, name, collection);
    const file = audit.files.find(row => row.dataset_kind === kind);
    if (!file || file.repository_relative_path !== source.file || file.sha256 !== source.sha256 ||
        file.byte_length !== source.bytes || file.record_count !== Object.keys(source.records).length) {
      throw new Error(`Source file changed: ${name}`);
    }
    const rows = audit.records.filter(row => row.dataset_kind === kind);
    if (role !== 'legacy') {
      if (rows.length) throw new Error(`Generated public output included as legacy: ${name}`);
      continue;
    }
    if (rows.length !== Object.keys(source.records).length) throw new Error(`Legacy row count changed: ${name}`);
    const seen = new Set();
    for (const row of rows) {
      const key = row.source_key_raw;
      if (seen.has(key) || !Object.hasOwn(source.records, key) ||
          row.source_file_sha256 !== source.sha256 ||
          row.json_pointer !== `/${collection}/${pointerPart(key)}` ||
          row.record_value_canonical_sha256 !== recordSha(source.records[key])) {
        throw new Error(`Legacy record or pointer changed: ${name}`);
      }
      seen.add(key);
      const value = source.records[key];
      const candidate = kind === 'legacy-alias-map' ? value
        : kind === 'legacy-image-index' ? null
          : typeof value?.partNumbers?.primary === 'string' ? value.partNumbers.primary : key;
      const expectedMatches = [...new Set([key, candidate].filter(pn => typeof pn === 'string' && active.has(pn)))];
      if (JSON.stringify(row.inventory_exact_pn_matches) !== JSON.stringify(expectedMatches) ||
          row.erp_binding !== null || row.official_raw_sha256 !== null || row.source_observed_at !== null ||
          row.evidence_state !== 'LEGACY_UNVERIFIED' || row.import_allowed !== false ||
          row.publication_allowed !== false) throw new Error(`Legacy safety state changed: ${name}`);
      verifiedLegacyRecords++;
    }
  }
  const inventory = readDataset(root, 'inventory-status.json', 'items');
  if (audit.inventory_reference.sha256 !== inventory.sha256 ||
      audit.inventory_reference.base_date !== (inventory.parsed.baseDate ?? null) ||
      audit.inventory_reference.updated_at !== (inventory.parsed.updatedAt ?? null) ||
      audit.inventory_reference.exact_part_number_count !== active.size) {
    throw new Error('Inventory join reference changed');
  }
  const currentAssets = [...assetDigests(root, 'products'), ...assetDigests(root, 'notices')];
  if (JSON.stringify(audit.assets) !== JSON.stringify(currentAssets)) throw new Error('Local image assets changed');
  return { verifiedFiles: DATASETS.length, verifiedLegacyRecords, verifiedAssets: currentAssets.length };
}

export function writePrivateAudit(audit) {
  const dir = mkdtempSync(join(tmpdir(), 'maxgain-hub-audit-'));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, 'hub-homepage-legacy-audit.v1.json');
  writeFileSync(file, `${JSON.stringify(audit, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  chmodSync(file, 0o600);
  return file;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '../..'));
  const companyId = process.argv[3] || null;
  if (companyId && !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(companyId)) {
    throw new Error('Company ID must be a verified UUID');
  }
  const audit = buildAudit(root, {
    companyId,
    companyScopeProvenance: companyId ? { source: 'Hub operating company listing READ', checked_on_kst: '2026-11-27',
      confirms_company_scope_only: true, confirms_item_binding: false } : null,
  });
  const verification = verifyAuditAgainstSource(root, audit);
  const output = writePrivateAudit(audit);
  console.log(JSON.stringify({ output, outputSha256: sha256(readFileSync(output)),
    auditId: audit.audit_id, legacyRecords: audit.records.length,
    datasets: audit.dataset_summary, assets: audit.assets.length, coverage: audit.coverage, verification }));
}
