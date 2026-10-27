import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const SPECS_PATH = path.join(DATA_DIR, 'product-specs.json');
const INDEX_PATH = path.join(DATA_DIR, 'product-image-index.json');
const SPECS_BACKUP_PATH = path.join(DATA_DIR, 'product-specs.backup.json');
const INDEX_BACKUP_PATH = path.join(DATA_DIR, 'product-image-index.backup.json');
const IMAGE_DIR = path.join(ROOT, 'assets', 'images', 'products');
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const TARGET_OUTPUT_BYTES = 20 * 1024;
const MAX_OUTPUT_BYTES = 30 * 1024;
const MIN_QUALITY = 60;
const QUALITY_STEP = 4;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'MAXGAIN Product Image Sync/1.0';
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'tiff', 'avif']);

function parseArguments() {
  const options = { dryRun: false, limit: Infinity };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--dry-run') {
      options.dryRun = true;
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

async function loadJson(filePath, label, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    if (error instanceof SyntaxError) throw new Error(`${label} contains invalid JSON.`);
    throw new Error(`Could not read ${label}: ${error.message}`);
  }
}

function validateSpecs(data) {
  if (!data || data.version !== 1 || !data.items ||
      typeof data.items !== 'object' || Array.isArray(data.items)) {
    throw new Error('product-specs.json must contain version 1 and an items object.');
  }
}

function validateIndex(data) {
  if (!data || (data.version !== undefined && data.version !== 1) ||
      !data.items || typeof data.items !== 'object' || Array.isArray(data.items)) {
    throw new Error('product-image-index.json must contain an items object.');
  }
}

function parseImage(image) {
  if (typeof image === 'string') {
    return { url: image.trim(), source: '', sourceType: '' };
  }
  if (image && typeof image === 'object' && !Array.isArray(image)) {
    return {
      url: typeof image.url === 'string' ? image.url.trim() : '',
      source: typeof image.source === 'string' ? image.source : '',
      sourceType: typeof image.type === 'string' ? image.type : ''
    };
  }
  return { url: '', source: '', sourceType: '' };
}

function isLocalProductImage(value) {
  const segments = value.split('/');
  return /^assets\/images\/products\/[A-Za-z0-9._/-]+$/.test(value) &&
    segments.every(segment => segment && segment !== '.' && segment !== '..');
}

function parseRemoteUrl(value) {
  if (!value || value !== value.trim() || /[\s\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function getCandidates(items) {
  const candidates = [];
  let skipped = 0;
  let review = 0;

  for (const [partNumber, product] of Object.entries(items)) {
    const image = parseImage(product?.image);
    if (!image.url) {
      skipped += 1;
    } else if (isLocalProductImage(image.url)) {
      skipped += 1;
    } else if (parseRemoteUrl(image.url)) {
      candidates.push({ partNumber, product, image });
    } else {
      review += 1;
      console.warn(`REVIEW ${partNumber}: image URL is not an allowed HTTPS URL.`);
    }
  }
  return { candidates, skipped, review };
}

async function importSharp() {
  try {
    const module = await import('sharp');
    return module.default;
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
      throw new Error('Image processing dependency is missing. Install the existing-project dependency "sharp" before running this utility.');
    }
    throw new Error(`Could not load the sharp image processor: ${error.message}`);
  }
}

async function downloadImage(startUrl) {
  let currentUrl = startUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const parsedUrl = parseRemoteUrl(currentUrl);
    if (!parsedUrl) throw new Error('URL or redirect target is not a credential-free HTTPS URL.');

    const response = await fetch(parsedUrl, {
      redirect: 'manual',
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/tiff',
        'User-Agent': USER_AGENT
      },
      signal: AbortSignal.timeout(30_000)
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error(`Redirect ${response.status} did not include a location.`);
      if (redirects === MAX_REDIRECTS) throw new Error('Image URL exceeded the redirect limit.');
      const redirectedUrl = new URL(location, parsedUrl);
      if (redirectedUrl.protocol !== 'https:' || redirectedUrl.username || redirectedUrl.password) {
        throw new Error('Redirect target is not a credential-free HTTPS URL.');
      }
      currentUrl = redirectedUrl.href;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Image server returned HTTP ${response.status}.`);
    }

    const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
      await response.body?.cancel();
      throw new Error('Image URL returned an HTML response.');
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
      await response.body?.cancel();
      throw new Error('Image exceeds the 10 MB source size limit.');
    }
    if (!response.body) throw new Error('Image response has no body.');

    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of response.body) {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_SOURCE_BYTES) {
        await response.body.cancel();
        throw new Error('Image exceeds the 10 MB source size limit.');
      }
      chunks.push(Buffer.from(chunk));
    }
    if (totalBytes === 0) throw new Error('Image response is empty.');
    return Buffer.concat(chunks, totalBytes);
  }

  throw new Error('Image redirect processing failed.');
}

async function inspectImage(sharp, input) {
  let metadata;
  try {
    metadata = await sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw new Error('Downloaded content is not a supported image.');
  }
  if (!ALLOWED_FORMATS.has(metadata.format) ||
      !Number.isInteger(metadata.width) ||
      !Number.isInteger(metadata.height) ||
      metadata.width < 1 ||
      metadata.height < 1) {
    throw new Error('Downloaded content is not a supported raster image.');
  }
  return metadata;
}

async function optimizeImage(sharp, input) {
  let lastOutput;
  for (let quality = 88; quality >= MIN_QUALITY; quality -= QUALITY_STEP) {
    const output = await sharp(input, {
      failOn: 'error',
      limitInputPixels: 40_000_000
    })
      .rotate()
      .resize({
        width: 160,
        height: 160,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality, effort: 5 })
      .toBuffer();

    const metadata = await sharp(output).metadata();
    lastOutput = {
      buffer: output,
      width: metadata.width,
      height: metadata.height,
      quality
    };
    if (output.byteLength <= TARGET_OUTPUT_BYTES) return lastOutput;
  }

  if (lastOutput.buffer.byteLength > MAX_OUTPUT_BYTES) {
    throw new Error('Optimized image remains above 30 KB at quality 60; review required.');
  }
  return lastOutput;
}

async function writeFileAtomically(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, contents, { flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function backupFile(sourcePath, backupPath, fallbackContents) {
  try {
    await fs.copyFile(sourcePath, backupPath, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeFileAtomically(backupPath, fallbackContents);
  }
}

async function main() {
  const options = parseArguments();
  const specs = await loadJson(SPECS_PATH, 'product-specs.json');
  validateSpecs(specs);
  const imageIndex = await loadJson(INDEX_PATH, 'product-image-index.json', {
    version: 1,
    items: {}
  });
  validateIndex(imageIndex);
  const sharp = await importSharp();
  const { candidates, skipped, review: invalidCount } = getCandidates(specs.items);
  const requested = candidates.slice(0, options.limit);
  const summary = {
    candidates: candidates.length,
    downloaded: 0,
    optimized: 0,
    deduplicated: 0,
    skipped,
    review: invalidCount,
    errors: 0,
    originalBytes: 0,
    optimizedBytes: 0
  };
  const updates = new Map();
  const newImageFiles = new Map();
  const hashesThisRun = new Set();
  let changed = false;

  for (const candidate of requested) {
    try {
      const original = await downloadImage(candidate.image.url);
      summary.downloaded += 1;
      summary.originalBytes += original.byteLength;
      const hash = crypto.createHash('sha256').update(original).digest('hex');
      const indexed = imageIndex.items[hash];
      const indexedPath = typeof indexed?.localPath === 'string' &&
        isLocalProductImage(indexed.localPath)
        ? indexed.localPath
        : `assets/images/products/${hash.slice(0, 16)}.webp`;
      const absoluteImagePath = path.join(ROOT, indexedPath);
      let outputBytes;

      if (indexed && hashesThisRun.has(hash)) {
        summary.deduplicated += 1;
        outputBytes = newImageFiles.get(hash)?.byteLength ?? indexed.optimizedBytes ?? 0;
      } else {
        try {
          await fs.access(absoluteImagePath);
          if (indexed) {
            summary.deduplicated += 1;
            outputBytes = indexed.optimizedBytes ?? (await fs.stat(absoluteImagePath)).size;
          } else {
            throw new Error('No matching image-index record.');
          }
        } catch {
          await inspectImage(sharp, original);
          const optimized = await optimizeImage(sharp, original);
          if (optimized.buffer.byteLength > MAX_OUTPUT_BYTES) {
            summary.review += 1;
            console.warn(`REVIEW ${candidate.partNumber}: optimized image exceeds 30 KB.`);
            continue;
          }
          const existingIndex = imageIndex.items[hash];
          imageIndex.items[hash] = {
            localPath: indexedPath,
            source: candidate.image.source || new URL(candidate.image.url).hostname,
            sourceType: candidate.image.sourceType || 'unspecified',
            originalBytes: original.byteLength,
            optimizedBytes: optimized.buffer.byteLength,
            width: optimized.width,
            height: optimized.height
          };
          if (!options.dryRun) newImageFiles.set(hash, optimized.buffer);
          if (existingIndex) {
            summary.deduplicated += 1;
          } else {
            summary.optimized += 1;
          }
          outputBytes = optimized.buffer.byteLength;
        }
      }

      hashesThisRun.add(hash);
      summary.optimizedBytes += outputBytes;
      const newImageValue = typeof candidate.product.image === 'string'
        ? indexedPath
        : { ...candidate.product.image, url: indexedPath };
      if (candidate.product.image.url !== indexedPath ||
          typeof candidate.product.image === 'string') {
        candidate.product.image = newImageValue;
        updates.set(candidate.partNumber, newImageValue);
        changed = true;
      }
      console.log(`${options.dryRun ? 'WOULD LOCALIZE' : 'LOCALIZED'} ${candidate.partNumber} -> ${indexedPath}`);
    } catch (error) {
      if (/review required/.test(error.message)) {
        summary.review += 1;
        console.warn(`REVIEW ${candidate.partNumber}: ${error.message}`);
      } else {
        summary.errors += 1;
        console.error(`ERROR ${candidate.partNumber}: ${error.message}`);
      }
    }
  }

  if (!options.dryRun && changed && summary.errors === 0) {
    const specsJson = `${JSON.stringify(specs, null, 2)}\n`;
    const indexJson = `${JSON.stringify(imageIndex, null, 2)}\n`;
    await backupFile(SPECS_PATH, SPECS_BACKUP_PATH, specsJson);
    await backupFile(INDEX_PATH, INDEX_BACKUP_PATH, JSON.stringify({
      version: 1,
      items: {}
    }, null, 2) + '\n');

    await fs.mkdir(IMAGE_DIR, { recursive: true });
    for (const [hash, buffer] of newImageFiles) {
      const outputPath = path.join(IMAGE_DIR, `${hash.slice(0, 16)}.webp`);
      await writeFileAtomically(outputPath, buffer);
    }

    await writeFileAtomically(SPECS_PATH, specsJson);
    await writeFileAtomically(INDEX_PATH, indexJson);
  } else if (options.dryRun) {
    console.log('Dry run: JSON, backup, and image files were not written.');
  }

  console.log('Summary:');
  console.log(JSON.stringify(summary, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Image synchronization failed.');
  process.exitCode = 1;
}
