import { joinDisplaySpecs } from './catalog-display-specs-core.mjs';

async function initialize() {
  const ready = window.__maxgainFacetSearchReady;
  if (!ready) return;
  document.removeEventListener('maxgain-facet-search-ready', initialize);
  try {
    const response = await fetch('data/catalog-display-specs.v1.json', { cache: 'no-store' });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const joined = joinDisplaySpecs(ready.inventoryData, await response.json());
    ready.setDisplaySpecs(joined);
  } catch (error) {
    console.error('Approved display specifications rejected:', error);
  }
}

document.addEventListener('maxgain-facet-search-ready', initialize);
initialize();
