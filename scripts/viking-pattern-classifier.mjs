const CAPACITOR_SIZES = ['01', '02', '03', '05', '06', '08', '10', '12', '20', '25'];
const MCF_CAPACITOR_SIZES = ['E5', '01', '02', '03', '05', '06', '08', '10', '12', '18', '20', '25'];
const CAPACITOR_TOLERANCES = 'ABCDFGJKMZ';
const CAPACITOR_FIELDS_BY_SERIES = {
  MC: {
    sizes: CAPACITOR_SIZES,
    dielectrics: 'NBX',
    packaging: 'T',
    voltages: ['6V3', '250', '500', '101', '102', '202', '302', '402', '502', '602']
  },
  MCRF: {
    sizes: CAPACITOR_SIZES,
    dielectrics: 'NBX',
    packaging: 'T',
    voltages: ['6V3', '250', '500', '101', '102', '202', '302', '402', '502', '602']
  },
  MCF: {
    sizes: MCF_CAPACITOR_SIZES,
    dielectrics: 'NBXST',
    packaging: 'TW',
    voltages: ['4V0', '6V3', '250', '500', '101', '102', '202', '302', '402', '502']
  }
};

export const VIKING_CATALOG_SERIES = {
  Capacitor: [
    'MC', 'MCRF', 'MCF', 'MCF(A)..A', 'IM', 'OP', 'SC',
    'AR5K', 'ARHA', 'AREP', 'AREA', 'AVSK', 'AVEA', 'AVHA'
  ],
  Resistor: [
    'AR', 'ARG', 'ARN', 'ARP', 'ARF', 'ARW', 'ARM..A', 'ART..A',
    'ARTP..A', 'ARHV..A', 'CR..AC', 'CR..A..', 'CRTC..A', 'CRHT..A',
    'CRP', 'CRW', 'CSMW', 'CRS', '4T', 'LR', 'LRP', 'LRP..A', 'LRJ', 'LRSW..A',
    'MF', 'MF..A', 'WMN', 'WMB', 'WMK', 'WMP', 'HVR..A', 'HVR',
    'HVRC', 'CRG', 'CRG..A', 'ASG', 'ASG..A', 'HVRG', 'HVRG..A',
    'PWRG', 'PWRG..A', 'SWRG', 'SWRG..A', 'TFAW', 'CN21&1',
    'AS Array', 'AS..A Array', 'ASE', 'ASF', 'ASF..A',
    'CNF', 'CNF..A', 'CN..A', 'ARW'
  ],
  Inductor: [
    'AL', 'CL-S', 'CL-SA', 'MLH', 'MLH-G', 'MLH-GA', 'WL', 'NL-M',
    'CBM', 'CBF', 'CBF..A', 'CMX', 'CMX..A', 'CMA', 'CMH', 'CMC',
    'PCM', 'SDIA', 'SDIA..A', 'SDE..A', 'SDA', 'SDA..A', 'SDB',
    'SDN', 'DRGH', 'DRGR'
  ]
};
export const VIKING_CATALOG_SOURCES = [
  'references/viking/Capacitor Catalog.pdf',
  'references/viking/Inductor Catalog.pdf',
  'references/viking/Resistor Catalog-1.pdf',
  'references/viking/Resistor Catalog-2.pdf'
];

const RESISTOR_REVIEW_FAMILIES = {
  CSMW: ['36', '08', '62', '20', '25'],
  HVR: ['02', '03', '05', '06', '08', '0A', '12'],
  CRG: ['01', '02', '03', '05', '06', '08', '10', '12'],
  CRW: ['08', '62', '20', '25'],
  CRP: ['06', '12'],
  CRTC: ['02', '03', '05', '06'],
  CRHT: ['02', '03', '05'],
  'CR-': ['01', '02', '03', '05', '06', '10', '0A', '12'],
  ARHV: ['05', '06', '13'],
  ARTP: ['02', '03', '05'],
  ARM: ['02', '03', '05', '06'],
  ART: ['02', '03', '05', '06'],
  ARF: ['01', '02', '03', '05', '06'],
  ARP: ['03', '05', '06', '12'],
  ARN: ['03', '05', '06', '12'],
  ARG: ['02', '03', '05', '06'],
  ARW: ['08', '62', '20', '25'],
  AR: ['01', '02', '03', '05', '06', '13', '10', '20', '12'],
  CRS: [],
  '4T': [],
  LR: [],
  LRP: [],
  LRJ: [],
  LRSW: [],
  MF: [],
  WMN: [],
  WMB: [],
  WMK: [],
  WMP: [],
  HVRC: [],
  ASG: [],
  HVRG: [],
  PWRG: [],
  SWRG: [],
  TFAW: [],
  CN21: [],
  AS: [],
  ASE: [],
  ASF: [],
  CNF: [],
  CN: [],
  RAM: [],
  PR: [],
  TAR: []
};
const RESISTOR_FAMILY_ORDER = Object.keys(RESISTOR_REVIEW_FAMILIES)
  .sort((left, right) => right.length - left.length);
const RESISTANCE_VALUE_CODE = /^(?:\d{4}|\dR\d{2}|\d{2}R\d)$/;
const PADDED_RESISTANCE_VALUE_CODE = /^-{0,6}(?:\d{1,4}|\d{1,3}[RKM]\d{0,2}|0R)$/;
const AR_ORDERING_PATTERNS = {
  AR: /^(01|02|03|05|06|13|10|20|12)([TABCDF])([TB])([5XOSBNCD])([NXWMVOUQT]?)(\d{4}|\dR\d{2}|\d{2}R\d)(A|N)?$/,
  ARG: /^(02|03|05|06)([BCDF])([TB])([CD])(\d{4}|\dR\d{2}|\d{2}R\d)(N)?$/,
  ARN: /^(03|05|06|12)([BCDF])([TB])([CD])([UTSI])(\d{4}|\dR\d{2}|\d{2}R\d)(N)?$/,
  ARP: /^(03|05|06|12)([BCDF])([TB])([CD])(\d{4}|\dR\d{2}|\d{2}R\d)(N)?$/,
  ARF: /^(01|02|03|05|06)([BCDF])([TB])([CD])([ZNWPO])(\d{4}|\dR\d{2}|\d{2}R\d)(N)?$/,
  ARW: /^(08|62|20|25)([BCDF])([TB])([CD])([UTASR])(\d{4}|\dR\d{2}|\d{2}R\d)(A|NA)$/,
  ARM: /^(02|03|05|06)([QABD])([TB])([SBCDE])([YXMWV]?)(\d{4}|\dR\d{2}|\d{2}R\d)(A|NA)$/,
  ART: /^(02|03|05|06)([BDF])([TB])([CD])(\d{4}|\dR\d{2}|\d{2}R\d)(A|NA)$/,
  ARTP: /^(02|03|05)([BDF])([TB])([CD])(\d{4}|\dR\d{2}|\d{2}R\d)A$/,
  ARHV: /^(05|06|13)([BCDF])([TB])([BNCD])(\d{4}|\dR\d{2}|\d{2}R\d)(A|NA)$/
};
const AR_MATCHED_PATTERNS = {
  AR: 'AR(size)[TABCDF][TB][5XOSBNCD][optional NXWMVOUQT][4-char resistance][optional A|N]',
  ARG: 'ARG(02|03|05|06)[BCDF][TB][CD][4-char resistance][optional N]',
  ARN: 'ARN(03|05|06|12)[BCDF][TB][CD][UTSI][4-char resistance][optional N]',
  ARP: 'ARP(03|05|06|12)[BCDF][TB][CD][4-char resistance][optional N]',
  ARF: 'ARF(01|02|03|05|06)[BCDF][TB][CD][ZNWPO][4-char resistance][optional N]',
  ARW: 'ARW(08|62|20|25)[BCDF][TB][CD][UTASR][4-char resistance](A|NA)',
  ARM: 'ARM(02|03|05|06)[QABD][TB][SBCDE][YXMWV][4-char resistance](A|NA)',
  ART: 'ART(02|03|05|06)[BDF][TB][CD][4-char resistance](A|NA)',
  ARTP: 'ARTP(02|03|05)[BDF][TB][CD][4-char resistance]A',
  ARHV: 'ARHV(05|06|13)[BCDF][TB][BNCD][4-char resistance](A|NA)'
};
const AR_POWER_CODES = {
  AR: 'NXWMVOUQT',
  ARN: 'UTSI',
  ARF: 'ZNWPO',
  ARW: 'UTASR',
  ARM: 'YXMWV'
};

const INDUCTOR_FAMILIES = {
  AL: ['01', '02'],
  CL: ['E5', '01', '02', '03', '05'],
  MLH: ['03', '05', '06', '08'],
  'MLH-G': ['03', '05', '06', '08'],
  'MLH-GA': ['03', '05', '06', '08'],
  WL: [],
  'NL-M': [],
  CBM: [],
  CBF: [],
  'CBF.A': [],
  CMX: [],
  'CMX.A': [],
  CMA: [],
  CMH: [],
  CMC: [],
  PCM: [],
  SDIA: [],
  'SDIA.A': [],
  'SDE.A': [],
  SDA: [],
  'SDA.A': [],
  SDB: [],
  SDN: [],
  DRGH: [],
  DRGR: []
};
const INDUCTOR_FAMILY_ORDER = Object.keys(INDUCTOR_FAMILIES)
  .sort((left, right) => right.length - left.length);

const CATALOG_CONSTRUCTION = {
  capacitor: {
    series: ['MC', 'MCRF', 'MCF'],
    sizeCodes: CAPACITOR_FIELDS_BY_SERIES,
    toleranceCodes: CAPACITOR_TOLERANCES.split(''),
    packagingCodes: { T: 'taping reel', W: '13-inch taping reel (MCF)' },
    dielectricCodes: { MC: 'N/B/X', MCRF: 'N/B/X', MCF: 'N/B/X/S/T' },
    voltageCodes: CAPACITOR_FIELDS_BY_SERIES,
    capacitanceCode: '[0-9R]{3}',
    fields: ['series', 'size', 'capacitance tolerance', 'packaging', 'dielectric', 'voltage', 'capacitance']
  },
  resistor: {
    CSMW: {
      sizes: ['36', '08', '62', '20', '25'],
      fields: ['type', 'dimensions', 'resistance tolerance F/G/J', 'packaging T', 'TCR D/E/K', 'power U/T/A/S/R', 'R + 3 digits', 'marking A/N']
    },
    HVR: {
      sizes: ['02', '03', '05', '06', '08', '0A', '12'],
      fields: ['type', 'dimensions', 'resistance tolerance F/J', 'packaging T/V/W', 'TCR E/F/H', 'power X/V/W/U/T', '4-digit resistance']
    },
    CRG: {
      sizes: ['01', '02', '03', '05', '06', '08', '10', '12'],
      fields: ['type', 'dimensions', 'resistance tolerance F/J', 'function L/H/P', 'packaging 4/7', 'resistance with R/K/M multiplier']
    },
    CR: {
      sizes: ['01', '02', '03', '05', '06', '10', '0A', '12'],
      fields: ['CR- type', 'dimensions', 'resistance tolerance', 'function code', 'packaging code', 'right-aligned resistance code', 'AC inspection suffix for standard AC series']
    },
    CRP: {
      sizes: ['06', '12'],
      fields: ['product type', 'dimensions', 'resistance tolerance F/J', 'function L', 'packaging 4/7', 'right-aligned resistance code']
    },
    CRW: {
      sizes: ['08', '62', '20', '25'],
      fields: ['product type', 'dimensions', 'resistance tolerance D/F/J', 'function L/P', 'packaging 4/7', 'right-aligned resistance code']
    },
    CRTC: {
      sizes: ['02', '03', '05', '06'],
      fields: ['product type', 'dimensions', 'resistance tolerance B/C/D/F', 'packaging T/V/W', 'TCR C/D', 'power Y/X/W/P/V/O', 'resistance code', 'automotive marking A']
    },
    CRHT: {
      sizes: ['02', '03', '05'],
      fields: ['product type', 'dimensions', 'resistance tolerance D/F/J or jumper', 'packaging T/V/W', 'TCR E/F or jumper', 'power X/W/V/U', 'resistance code', 'automotive marking A']
    },
    AR: {
      sizes: ['01', '02', '03', '05', '06', '13', '10', '20', '12'],
      fields: ['product type', 'dimensions', 'resistance tolerance T/A/B/C/D/F', 'packaging T/B', 'TCR 5/X/O/S/B/N/C/D', 'optional power rating N/X/W/M/V/O/U/Q/T', 'resistance code', 'optional marking N or automotive A']
    },
    ARG: {
      sizes: ['02', '03', '05', '06'],
      fields: ['product type', 'dimensions', 'resistance tolerance B/C/D/F', 'packaging T/B', 'TCR C/D', 'resistance code', 'optional no-marking N']
    },
    ARN: {
      sizes: ['03', '05', '06', '12'],
      fields: ['product type', 'dimensions', 'resistance tolerance B/C/D/F', 'packaging T/B', 'TCR C/D', 'power U/T/S/I', 'resistance code', 'optional no-marking N']
    },
    ARP: {
      sizes: ['03', '05', '06', '12'],
      fields: ['product type', 'dimensions', 'resistance tolerance B/C/D/F', 'packaging T/B', 'TCR C/D', 'optional standard power rating', 'resistance code', 'optional no-marking N']
    },
    ARF: {
      sizes: ['01', '02', '03', '05', '06'],
      fields: ['product type', 'dimensions', 'resistance tolerance B/C/D/F', 'packaging T/B', 'TCR C/D', 'power Z/N/W/P/O', 'resistance code', 'optional no-marking N']
    },
    ARM: {
      sizes: ['02', '03', '05', '06'],
      fields: ['product type', 'dimensions', 'resistance tolerance Q/A/B/D', 'packaging T/B', 'TCR S/B/C/D/E', 'optional power Y/X/M/W/V', 'resistance code', 'marking A/NA']
    },
    ART: {
      sizes: ['02', '03', '05', '06'],
      fields: ['product type', 'dimensions', 'resistance tolerance B/D/F', 'packaging T/B', 'TCR C/D', 'optional standard power rating', 'resistance code', 'marking A/NA']
    },
    ARTP: {
      sizes: ['02', '03', '05'],
      fields: ['product type', 'dimensions', 'resistance tolerance B/D/F', 'packaging T/B', 'TCR C/D', 'optional standard power rating', 'resistance code', 'automotive marking A']
    },
    ARHV: {
      sizes: ['05', '06', '13'],
      fields: ['product type', 'dimensions', 'resistance tolerance B/C/D/F', 'packaging T/B', 'TCR B/N/C/D', 'optional standard power rating', 'resistance code', 'marking A/NA']
    }
  },
  inductor: {
    AL: {
      sizes: ['01', '02'],
      fields: ['type', 'dimensions', 'inductance tolerance B/C/S/F/G/H/J', 'packaging T', 'inductance code', 'standard/01 high-current/02 high-Q variant']
    },
    CL: {
      sizes: ['E5', '01', '02', '03', '05'],
      fields: ['type', 'dimensions', 'inductance tolerance W/B/C/S/G/H/J/K', 'packaging T', 'optional Q high-Q appearance', 'inductance code', 'internal suffix -S/-S01/-S02']
    },
    MLH: {
      sizes: ['03', '05', '06', '08'],
      fields: ['type', 'dimensions; ordering construction not present in the inspected catalog page']
    }
  }
};

const comparePartNumbers = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function classifyCapacitor(partNumber) {
  const series = ['MCRF', 'MCF', 'MC'].find(code => partNumber.startsWith(code));
  if (!series) return null;

  const remainder = partNumber.slice(series.length);
  const sizeCode = remainder.slice(0, 2);
  const fields = CAPACITOR_FIELDS_BY_SERIES[series];
  const validSizes = fields.sizes;
  if (!validSizes.includes(sizeCode)) return null;

  const pattern = new RegExp(
    `^(?:${validSizes.join('|')})[${CAPACITOR_TOLERANCES}][${fields.packaging}][${fields.dielectrics}](?:${fields.voltages.join('|')})[0-9R]{3}$`
  );
  const complete = pattern.test(remainder);
  return {
    group: 'Capacitor',
    family: series,
    sizeCode,
    pattern: complete ? 'pattern-high' : 'pattern-review',
    matchedPattern: `${series}(${validSizes.join('|')})[${CAPACITOR_TOLERANCES}][${fields.packaging}][${fields.dielectrics}](${fields.voltages.join('|')})[0-9R]{3}`,
    reason: complete
      ? 'Matches the catalog Part Number construction: series, size, tolerance, packaging, dielectric, voltage, and capacitance.'
      : 'Official series and catalog size code match, but the complete capacitor ordering fields do not.'
  };
}

function classifyResistor(partNumber) {
  for (const family of RESISTOR_FAMILY_ORDER) {
    const prefix = family === 'CR-' ? 'CR-' : family;
    if (!partNumber.startsWith(prefix)) continue;

    const remainder = partNumber.slice(prefix.length);
    const sizeCode = remainder.slice(0, 2);
    const validSizes = RESISTOR_REVIEW_FAMILIES[family];
    if (!validSizes.length || !validSizes.includes(sizeCode)) return null;
    const ordering = remainder.slice(2);
    if (!ordering) return null;

    let complete = false;
    let matchedPattern = `${family}(${validSizes.join('|')})[official ordering fields]`;
    let reason = `Official ${family} family and size code match, but the complete ordering structure is not validated.`;

    if (family.startsWith('AR')) {
      const schema = AR_ORDERING_PATTERNS[family];
      complete = schema.test(remainder);
      matchedPattern = AR_MATCHED_PATTERNS[family].replace(
        '(size)',
        `(${validSizes.join('|')})`
      );
      reason = complete
        ? `Matches the official ${family} ordering structure, including dimensions, tolerance, packaging, TCR, power where applicable, resistance, and marking.`
        : `Official ${family} series and size code match, but the complete catalog ordering fields do not.`;
      if (!complete && !isPlausibleArOrdering(family, ordering)) return null;
    } else if (family === 'CR-') {
      const standardMatch = /^([BCDFJ])([LEPHM])([0-9A-D])(-{0,6}(?:\d{1,4}|\d{1,3}[RKM]\d{0,2}|0R))(AC)$/.exec(ordering);
      const automotiveMatch = /^([DFJ])([ACDUQ])([2-9A-D])(-{0,6}(?:\d{1,4}|\d{1,3}[RKM]\d{0,2}|0R))$/.exec(ordering);
      const standard = standardMatch && isPaddedResistanceValueCode(standardMatch[4]);
      const automotive = automotiveMatch && isPaddedResistanceValueCode(automotiveMatch[4]);
      complete = Boolean(standard || automotive);
      matchedPattern = standard
        ? `CR-(${validSizes.join('|')})[BCDFJ][LEPHM][0-9A-D][padded resistance code]AC`
        : `CR-(${validSizes.join('|')})[DFJ][ACDUQ][2-9A-D][padded resistance code]`;
      reason = complete
        ? `Matches the catalog ${standard ? 'CR..AC standard' : 'CR..A automotive'} ordering structure, including size, tolerance, function, packaging, and resistance.`
        : 'Official CR family and size code match, but the complete function, packaging, resistance, or suffix fields are incomplete.';
      if (!complete && !isPlausibleCrOrdering(ordering)) return null;
    } else if (family === 'CRW') {
      const match = /^([DFJ])([LP])([47])(-{0,6}(?:\d{1,4}|\d{1,3}[RKM]\d{0,2}|0R))$/.exec(ordering);
      complete = Boolean(match && isPaddedResistanceValueCode(match[4]));
      matchedPattern = `CRW(${validSizes.join('|')})[DFJ][LP][47][padded resistance code]`;
      reason = complete
        ? 'Matches the catalog CRW wide-terminal ordering structure, including size, tolerance, function, packaging, and resistance.'
        : 'Official CRW family and size code match, but the complete ordering fields do not.';
      if (!complete && !/^[DFJLP47RKM0-9-]{1,24}$/.test(ordering)) return null;
    } else if (family === 'CRP') {
      const match = /^([FJ])(L)([47])(-{0,6}(?:\d{1,4}|\d{1,3}[RKM]\d{0,2}|0R))$/.exec(ordering);
      complete = Boolean(match && isPaddedResistanceValueCode(match[4]));
      matchedPattern = `CRP(${validSizes.join('|')})[FJ]L[47][padded resistance code]`;
      reason = complete
        ? 'Matches the catalog CRP high-power ordering structure, including size, tolerance, function, packaging, and resistance.'
        : 'Official CRP family and size code match, but the complete ordering fields do not.';
      if (!complete && !/^[FJL47RKM0-9-]{1,24}$/.test(ordering)) return null;
    } else if (family === 'CRTC') {
      complete = /^([BCDF])([TVW])([CD])([YXWPVO])(\d{4}|\dR\d{2}|\d{2}R\d)A$/.test(ordering);
      matchedPattern = `CRTC(${validSizes.join('|')})[BCDF][TVW][CD][YXWPVO][resistance code]A`;
      reason = complete
        ? 'Matches the catalog CRTC automotive high-precision ordering structure, including tolerance, packaging, TCR, power, resistance, and marking.'
        : 'Official CRTC family and size code match, but the complete ordering fields do not.';
      if (!complete && !/^[BCDFTVWCDYXWPVOA0-9R]{1,24}$/.test(ordering)) return null;
    } else if (family === 'CRHT') {
      complete = /^([DFJ-])([TVW])([EF-])([XWVU])(\d{4}|\dR\d{2}|\d{2}R\d)A$/.test(ordering);
      matchedPattern = `CRHT(${validSizes.join('|')})[DFJ|-][TVW][EF|-][XWVU][resistance code]A`;
      reason = complete
        ? 'Matches the catalog CRHT automotive high-temperature ordering structure, including tolerance, packaging, TCR, power, resistance, and marking.'
        : 'Official CRHT family and size code match, but the complete ordering fields do not.';
      if (!complete && !/^[DFJTVWEFXWVUA0-9R-]{1,24}$/.test(ordering)) return null;
    } else if (family === 'CSMW') {
      complete = /^[FGJ]T[DEK][UTASR]R\d{3}[AN]$/.test(ordering);
    } else if (family === 'HVR') {
      complete = /^[FJ][TVW][EFH][XVWUT]\d{4}$/.test(ordering);
    } else if (family === 'CRG') {
      complete = /^[FJ][LHP][47](?:\d{1,3}[RKM]\d?|\d{1,3}[KM])$/.test(ordering);
    }

    return {
      group: 'Resistor',
      family: family === 'CR-' ? 'CR' : family,
      sizeCode,
      pattern: complete ? 'pattern-high' : 'pattern-review',
      matchedPattern,
      reason: complete
        ? reason
        : reason || `Official ${family} family and size code match, but the complete ordering fields do not.`
    };
  }

  return null;
}

function isPlausibleArOrdering(family, ordering) {
  const toleranceCodes = {
    AR: 'TABCDF',
    ARG: 'BCDF',
    ARN: 'BCDF',
    ARP: 'BCDF',
    ARF: 'BCDF',
    ARW: 'BCDF',
    ARM: 'QABD',
    ART: 'BDF',
    ARTP: 'BDF',
    ARHV: 'BCDF'
  };
  if (!toleranceCodes[family]?.includes(ordering[0] ?? '')) return false;
  if (ordering.length === 1) return true;
  if (!'TB'.includes(ordering[1] ?? '')) return false;

  const tcrCodes = {
    AR: '5XOSBNCD',
    ARG: 'CD',
    ARN: 'CD',
    ARP: 'CD',
    ARF: 'CD',
    ARW: 'CD',
    ARM: 'SBCDE',
    ART: 'CD',
    ARTP: 'CD',
    ARHV: 'BNCD'
  };
  if (!tcrCodes[family].includes(ordering[2] ?? '')) return false;
  let value = ordering.slice(3);
  const powerCodes = AR_POWER_CODES[family] ?? '';
  if (powerCodes.includes(value[0] ?? '')) value = value.slice(1);

  const markingCodes = {
    AR: 'AN',
    ARG: 'N',
    ARN: 'N',
    ARP: 'N',
    ARF: 'N',
    ARW: 'AN',
    ARM: 'AN',
    ART: 'AN',
    ARTP: 'A',
    ARHV: 'AN'
  };
  const allowedMarkings = markingCodes[family];
  if (allowedMarkings.includes(value.at(-1) ?? '') && value.length > 1) {
    value = value.slice(0, -1);
  }
  return value.length <= 4 && /^[0-9R]*$/.test(value);
}

function isPaddedResistanceValueCode(value) {
  return value.length <= 7 && PADDED_RESISTANCE_VALUE_CODE.test(value);
}

function isPlausibleCrOrdering(ordering) {
  const variants = [
    { tolerances: 'BCDFJ', functions: 'LEPHM', packages: '0123456789ABCD' },
    { tolerances: 'DFJ', functions: 'ACDUQ', packages: '23456789ABCD' }
  ];

  return variants.some(({ tolerances, functions, packages }) => {
    if (!tolerances.includes(ordering[0] ?? '')) return false;
    if (ordering.length === 1) return true;
    if (!functions.includes(ordering[1] ?? '')) return false;
    if (ordering.length === 2) return true;
    if (!packages.includes(ordering[2] ?? '')) return false;
    return /^[A-Z0-9-]{0,20}$/.test(ordering.slice(3));
  });
}

function classifyInductor(partNumber) {
  for (const family of INDUCTOR_FAMILY_ORDER) {
    const code = family === 'CL' ? 'CL' : family;
    if (!partNumber.startsWith(code)) continue;

    const remainder = partNumber.slice(code.length);
    const validSizes = INDUCTOR_FAMILIES[family];
    if (!validSizes.length) return null;

    const sizeCode = validSizes.find(size => remainder.startsWith(size));
    if (!sizeCode) return null;

    let complete = false;
    if (family === 'AL') {
      complete = /^[BCSFGHJ]T(?:\d{2}N\d?|\dN\d|R\d{2}|\d{2}U\d?)(?:01|02)?$/.test(remainder.slice(2));
    } else if (family === 'CL') {
      complete = /^[WBCSGHJK]TQ?(?:\d{2}N\d?|\dN\d|R\d{2})-(?:S|S01|S02)$/.test(
        remainder.slice(sizeCode.length)
      );
    }

    return {
      group: 'Inductor',
      family,
      sizeCode,
      pattern: complete ? 'pattern-high' : 'pattern-review',
      matchedPattern: family === 'AL'
        ? `AL(${validSizes.join('|')})[BCSFGHJ]T[inductance code](01|02)?`
        : `CL(${validSizes.join('|')})[WBCSGHJK]TQ?[inductance code]-(S|S01|S02)`,
      reason: complete
        ? `Matches the catalog ${family} construction, including size, tolerance, packaging, and inductance encoding.`
        : `Official ${family} series and size code match, but the complete inductor ordering fields do not.`
    };
  }

  return null;
}

export function classifyVikingPartNumber(partNumber) {
  const code = String(partNumber ?? '').trim().toUpperCase();
  if (!code) return null;
  return classifyCapacitor(code) ?? classifyResistor(code) ?? classifyInductor(code);
}

export function sampleVikingHigh(candidates, maxSamples = 50) {
  const families = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.group}\u0000${candidate.family}`;
    const group = families.get(key) ?? [];
    group.push(candidate);
    families.set(key, group);
  }

  for (const group of families.values()) {
    group.sort((left, right) => comparePartNumbers(left.partNumber, right.partNumber));
  }

  const smallGroups = [...families.entries()]
    .filter(([, group]) => group.length <= 5)
    .sort(([left], [right]) => comparePartNumbers(left, right));
  const largeGroups = [...families.entries()]
    .filter(([, group]) => group.length > 5)
    .sort(([left], [right]) => comparePartNumbers(left, right));
  const smallCount = smallGroups.reduce((count, [, group]) => count + group.length, 0);
  if (smallCount > maxSamples) {
    throw new Error(`Cannot include every small Viking family within the ${maxSamples}-sample maximum.`);
  }

  const selected = smallGroups.flatMap(([, group]) => group);
  let remaining = maxSamples - selected.length;
  if (largeGroups.length > remaining) {
    throw new Error(`Cannot sample every Viking family within the ${maxSamples}-sample maximum.`);
  }

  const quotas = new Map(largeGroups.map(([key]) => [key, 1]));
  remaining -= largeGroups.length;
  while (remaining > 0) {
    let allocated = false;
    for (const [key, group] of largeGroups) {
      const current = quotas.get(key);
      if (current < group.length && remaining > 0) {
        quotas.set(key, current + 1);
        remaining -= 1;
        allocated = true;
      }
    }
    if (!allocated) break;
  }

  for (const [key, group] of largeGroups) {
    const count = quotas.get(key);
    for (let index = 0; index < count; index += 1) {
      const position = Math.floor(((index + 0.5) * group.length) / count);
      selected.push(group[position]);
    }
  }

  return selected.sort((left, right) => comparePartNumbers(left.partNumber, right.partNumber));
}

export const VIKING_CATALOG_CONSTRUCTION = CATALOG_CONSTRUCTION;
