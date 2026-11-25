import { applySelection, getStepOptions, joinApprovedFacets } from './spec-facets-core.mjs';

const status = document.getElementById('specFacetsStatus');
const steps = document.getElementById('specFacetsSteps');
const order = ['family', 'size', 'value', 'tolerance'];
const labels = {
  family: ['제품군', 'Product family'],
  size: ['크기', 'Size'],
  value: ['정전용량 / 저항값', 'Capacitance / resistance'],
  tolerance: ['허용오차', 'Tolerance']
};
const selection = {};
let rows = [];
let state = 'loading';

const english = () => document.documentElement.lang === 'en';
const message = (ko, en) => english() ? en : ko;

function render() {
  steps.replaceChildren();
  if (state === 'loading') {
    status.textContent = message('규격 정보를 확인하는 중입니다.', 'Checking specification data.');
    return;
  }
  if (state === 'unavailable') {
    status.textContent = message('규격 검색을 사용할 수 없습니다. Part Number 검색은 계속 사용할 수 있습니다.',
      'Specification search is unavailable. Part Number search remains available.');
    return;
  }
  if (!rows.length) {
    status.textContent = message('승인된 규격 0건입니다. Part Number 검색은 계속 사용할 수 있습니다.',
      'No approved specifications yet. Part Number search remains available.');
    return;
  }
  const selected = selection.family ? applySelection(rows, selection).length : rows.length;
  status.textContent = message(`승인 규격 ${rows.length}건 · 현재 선택 ${selected}건`,
    `${rows.length} approved specifications · ${selected} current matches`);
  const options = getStepOptions(rows, selection);
  for (const key of order) {
    if (!options[key].length) continue;
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'spec-facets-step';
    const legend = document.createElement('legend');
    legend.textContent = labels[key][english() ? 1 : 0];
    const choices = document.createElement('div');
    choices.className = 'spec-facets-choices';
    for (const option of options[key]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = `${option.label} (${option.count})`;
      button.setAttribute('aria-pressed', String(selection[key] === option.value));
      button.addEventListener('click', () => {
        const next = selection[key] === option.value ? '' : option.value;
        for (const later of order.slice(order.indexOf(key))) delete selection[later];
        if (next) selection[key] = next;
        render();
        if (selection.family) window.__maxgainFacetSearchReady.showFacetResults(applySelection(rows, selection));
        else window.__maxgainFacetSearchReady.showNormalSearch();
      });
      choices.append(button);
    }
    fieldset.append(legend, choices);
    steps.append(fieldset);
  }
}

async function initialize() {
  const ready = window.__maxgainFacetSearchReady;
  if (!ready) return;
  document.removeEventListener('maxgain-facet-search-ready', initialize);
  try {
    const response = await fetch('data/catalog-facet-index.v1.json', { cache: 'no-store' });
    if (response.status === 404) {
      state = 'ready';
      render();
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const index = await response.json();
    const result = joinApprovedFacets(ready.inventoryData, index,
      { expectedKind: 'approved-catalog' });
    rows = ready.setApprovedFacets(index, result.rows);
    state = 'ready';
    window.__maxgainFacetSearch = { onNormalSearch() {
      if (selection.family) {
        for (const key of order) delete selection[key];
        render();
      }
    } };
    render();
  } catch (error) {
    console.error('Approved facet index rejected:', error);
    state = 'unavailable';
    render();
  }
}

document.addEventListener('maxgain-facet-search-ready', initialize);
new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
initialize();
