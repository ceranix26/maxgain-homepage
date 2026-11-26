const IMAGE_PATH = /^assets\/images\/notices\/[a-f0-9]{64}\.webp$/;
const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const UTC_TIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/;
const LINK = /^https:\/\/(?:www\.)?maxgain\.co\.kr(?:\/[^\s\\#]*)?$/;
const SNOOZE_KEY = 'maxgain.site-popups.hide-all-day.v1';

export function localDay(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new Error('Valid date required');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function hiddenToday(storage, date = new Date()) {
  try { return storage?.getItem(SNOOZE_KEY) === localDay(date); } catch { return false; }
}

export function hideAllToday(storage, date = new Date()) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  try { storage.setItem(SNOOZE_KEY, localDay(date)); return true; } catch { return false; }
}

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => expected.includes(key)) &&
    expected.filter(key => key !== 'linkUrl').every(key => Object.hasOwn(value, key));
}

function validLink(raw) {
  if (typeof raw !== 'string' || raw.length > 1000 || !LINK.test(raw)) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash &&
      (url.hostname === 'maxgain.co.kr' || url.hostname === 'www.maxgain.co.kr');
  } catch { return false; }
}

export function validatePopupManifest(manifest) {
  if (!exactKeys(manifest, ['version', 'generatedAt', 'items']) || manifest.version !== 1 ||
      typeof manifest.generatedAt !== 'string' || !UTC_TIME.test(manifest.generatedAt) ||
      !Number.isFinite(Date.parse(manifest.generatedAt)) ||
      !Array.isArray(manifest.items) || manifest.items.length > 2) {
    throw new Error('Invalid popup manifest');
  }
  const ids = new Set();
  const priorities = new Set();
  for (const item of manifest.items) {
    if (!exactKeys(item, ['id', 'title', 'alt', 'imageUrl', 'priority', 'linkUrl']) ||
        typeof item.id !== 'string' || !ID.test(item.id) || ids.has(item.id) ||
        typeof item.title !== 'string' || !item.title.trim() || item.title.length > 160 ||
        typeof item.alt !== 'string' || !item.alt.trim() || item.alt.length > 240 ||
        typeof item.imageUrl !== 'string' || !IMAGE_PATH.test(item.imageUrl) ||
        !Number.isInteger(item.priority) || item.priority < 1 || item.priority > 2 || priorities.has(item.priority) ||
        (Object.hasOwn(item, 'linkUrl') && !validLink(item.linkUrl))) {
      throw new Error('Invalid popup item');
    }
    ids.add(item.id);
    priorities.add(item.priority);
  }
  return [...manifest.items].sort((a, b) => a.priority - b.priority);
}
