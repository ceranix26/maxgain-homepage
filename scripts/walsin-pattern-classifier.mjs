const MLCC_CANDIDATE_PATTERN = /^0402B[0-9A-Z]+CT$/;
export const RESISTOR_FAMILIES = {
  WR: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25'],
  MR: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25'],
  SR: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25'],
  WW: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25'],
  WF: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25'],
  WK: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25'],
  MF: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25'],
  SF: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25'],
  WA: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25'],
  MA: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25'],
  SA: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25'],
  WT: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25'],
  TTL: ['01', '02', '04', '06', '08', '10', '12', '18', '20', '25']
};
const RESISTOR_FAMILY_ORDER = Object.keys(RESISTOR_FAMILIES).sort((a, b) => b.length - a.length);
const COMPLETE_ORDERING_PATTERNS = {
  WR: /^[XWZ](?:\d{3,4}|\dR\d|R\d{2,3})[FJKP][A-Z]{2}$/,
  WA: /^[XWZ](?:\d{3,4}|\dR\d|R\d{2,3})[FJKP][A-Z]{2}$/,
  WW: /^[XM]R\d{3}[FJKP][A-Z]{2}$/,
  WF: /^[HGP](?:\d{3,4}|\d{2}R\d|\dR\d{2})[BFJKP][A-Z]{2}$/
};

export function classifyWalsinMlcc(partNumber) {
  return MLCC_CANDIDATE_PATTERN.test(partNumber)
    ? {
        category: 'MLCC',
        family: '0402B',
        sizeCode: '0402',
        pattern: 'pattern-high',
        reason: 'Official Walsin MLCC structure: 0402B + alphanumeric body + CT suffix'
      }
    : null;
}

export function classifyWalsinResistor(partNumber) {
  const trimmed = String(partNumber ?? '').trim();
  if (!trimmed) return null;

  for (const family of RESISTOR_FAMILY_ORDER) {
    if (!trimmed.startsWith(family)) continue;

    const remainder = trimmed.slice(family.length);
    const sizeMatch = remainder.match(/^(\d{2})(.*)$/);
    if (!sizeMatch) {
      return {
        category: 'resistor',
        family,
        sizeCode: null,
        pattern: 'pattern-review',
        reason: 'Official family found but missing valid catalog size code'
      };
    }

    const sizeCode = sizeMatch[1];
    const ordering = sizeMatch[2];
    if (!RESISTOR_FAMILIES[family].includes(sizeCode)) {
      return {
        category: 'resistor',
        family,
        sizeCode: null,
        pattern: 'pattern-review',
        reason: 'Official family present but size code is not in the approved Walsin catalog set'
      };
    }

    const completeOrdering = COMPLETE_ORDERING_PATTERNS[family]?.test(ordering) ?? false;
    return {
      category: 'resistor',
      family,
      sizeCode,
      pattern: completeOrdering ? 'pattern-high' : 'pattern-review',
      reason: completeOrdering
        ? 'Official Walsin family, valid size code, and complete catalog ordering-code structure'
        : 'Official family and size present, but the complete ordering-code structure is not validated'
    };
  }

  return null;
}
