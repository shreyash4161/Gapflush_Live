const electron = require("electron");
const isElectronRuntime = typeof electron !== "string";
const { app, BrowserWindow, ipcMain, shell, dialog } = isElectronRuntime
  ? electron
  : {};
const path = require("path");
const fs = require("fs");
const os = require("os");
const chokidar = require("chokidar");

// --- 1. CONFIGURATION & PATHS ---
const basePath =
  os.platform() === "win32"
    ? "D:\\"
    : path.join(os.homedir(), "Desktop", "GapFlushTest");
const DEFAULT_SOURCE_DIR = path.join(basePath, "Source");
const DEFAULT_DESIRED_DIR = path.join(basePath, "Desired");
let STATE_FILE;
let CONFIG_FILE;
let preparedConfig;
let watcher;

const DEFAULT_CONFIG = {
  paths: {
    sourceDir: DEFAULT_SOURCE_DIR,
    desiredDir: DEFAULT_DESIRED_DIR,
  },
  defaultArea: "BIW OUT",
  defaultStation: "",
  areas: [
    "STAMPING IN",
    "STAMPING OUT",
    "BIW IN",
    "BIW OUT",
    "PAINT IN",
    "PAINT OUT",
    "TCF ASSEMBLY IN",
    "TCF ASSEMBLY OUT",
  ],
  dateFormat: "dd-mm-yyyy",
  timeSeparator: ":",
  inputColumns: {
    date: 0,
    time: 1,
    vin: 2,
    station: -1,
    location: 3,
    metricName: 4,
    side: 5,
    direction: 6,
    lsl: 7,
    target: 8,
    usl: 9,
    measured: 10,
    resultCode: 11,
  },
  columnAliases: {
    date: ["date", "inspectiondate", "scan_date"],
    time: ["time", "inspectiontime", "scan_time"],
    vin: ["vin", "bsn", "vehicle", "vehicleid", "vehicle_id"],
    station: ["station", "line", "shop", "cell"],
    location: ["location", "area_location", "joint", "jointname"],
    metricName: ["metric", "metricname", "point", "pointname", "characteristic"],
    side: ["side", "lh_rh"],
    direction: ["direction", "axis", "gapflush", "gap_flush"],
    lsl: ["lsl", "min", "lower", "lowerlimit", "lower_limit"],
    target: ["target", "nominal", "std", "standard"],
    usl: ["usl", "max", "upper", "upperlimit", "upper_limit"],
    measured: ["measured", "actual", "actualvalue", "value", "reading"],
    resultCode: ["result", "resultcode", "status", "statuscode", "code"],
  },
  resultMap: { 0: "NO", 1: "OF", "-1": "UF" },
  vendorMeasurementIdMap: {
    "HOOD TO FENDER LH 1 GAP": "L23G110AFV",
    "HOOD TO FENDER LH 1 FLUSH": "L23G110AMV",
    "HOOD TO FENDER LH 3 GAP": "L23G120AFV",
    "HOOD TO FENDER LH 3 FLUSH": "L23G120AMV",
    "FENDER TO FD LH 4 GAP": "L23G130AFV",
    "FENDER TO FD LH 4 FLUSH": "L23G130AMV",
    "FENDER TO FD LH 6 GAP": "L23G140AFV",
    "FENDER TO FD LH 6 FLUSH": "L23G140AMV",
    "FD TO BSO LH 9 GAP": "L23G150AFV",
    "FD TO BSO LH 9 FLUSH": "L23G150AMV",
    "FD TO RD LH 10 GAP": "L23G160AFV",
    "FD TO RD LH 10 FLUSH": "L23G160AMV",
    "FD TO RD LH 13 GAP": "L23G170AFV",
    "FD TO RD LH 13 FLUSH": "L23G170AMV",
    "RD TO BSO LH 14 GAP": "L23G180AFV",
    "RD TO BSO LH 14 FLUSH": "L23G180AMV",
    "RD TO BSO QUATER LH 18 GAP": "L23G190AFV",
    "RD TO BSO QUATER LH 18 FLUSH": "L23G190AMV",
    "HOOD TO FENDER RH 1 GAP": "L23G200AFV",
    "HOOD TO FENDER RH 1 FLUSH": "L23G200AMV",
    "HOOD TO FENDER RH 3 GAP": "L23G210AFV",
    "HOOD TO FENDER RH 3 FLUSH": "L23G210AMV",
    "FENDER TO FD RH 4 GAP": "L23G220AFV",
    "FENDER TO FD RH 4 FLUSH": "L23G220AMV",
    "FENDER TO FD RH 6 GAP": "L23G230AFV",
    "FENDER TO FD RH 6 FLUSH": "L23G230AMV",
    "FD TO BSO RH 9 GAP": "L23G240AFV",
    "FD TO BSO RH 9 FLUSH": "L23G240AMV",
    "FD TO RD RH 10 GAP": "L23G250AFV",
    "FD TO RD RH 10 FLUSH": "L23G250AMV",
    "FD TO RD RH 13 GAP": "L23G260AFV",
    "FD TO RD RH 13 FLUSH": "L23G260AMV",
    "RD TO BSO RH 14 GAP": "L23G270AFV",
    "RD TO BSO RH 14 FLUSH": "L23G270AMV",
    "RD TO BSO QUATER RH 18 GAP": "L23G280AFV",
    "RD TO BSO QUATER RH 18 FLUSH": "L23G280AMV",
    "LIFTGATE TO ROOF LH 20 GAP": "L23G290AFV",
    "LIFTGATE TO ROOF LH 20 FLUSH": "L23G290AMV",
    "LIFTGATE TO ROOF RH 22 GAP": "L23G300AFV",
    "LIFTGATE TO ROOF RH 22 FLUSH": "L23G300AMV",
  },
  headerOrder: ["vin", "final", "date", "time"],
  metricKeyOrder: ["metricName", "side", "direction"],
  lineOrder: ["metricKey", "passFail", "result", "measured", "lsl", "usl"],
  // Column positions for reading the desired/output compact format files.
  // These default to the standard 6-column JLR compact layout.
  desiredColumns: {
    metricKey: 0,
    passFail: 1,
    result: 2,
    measured: 3,
    lsl: 4,
    usl: 5,
  },
};

// --- 2. STATE MANAGEMENT ---
let stateDB = {};
let appConfig = DEFAULT_CONFIG;

function mergeConfig(config) {
  const safeConfig = config && typeof config === "object" ? config : {};
  const columnAliases = {
    ...DEFAULT_CONFIG.columnAliases,
    ...(safeConfig.columnAliases ? safeConfig.columnAliases : {}),
  };
  Object.keys(columnAliases).forEach((key) => {
    if (!Array.isArray(columnAliases[key])) {
      columnAliases[key] = DEFAULT_CONFIG.columnAliases[key] || [];
    }
  });
  const resultMap =
    safeConfig.resultMap && typeof safeConfig.resultMap === "object"
      ? safeConfig.resultMap
      : DEFAULT_CONFIG.resultMap;
  const normalizedResultMap = Object.fromEntries(
    Object.entries(resultMap).map(([key, value]) => [String(key), String(value)]),
  );

  const paths = {
    ...DEFAULT_CONFIG.paths,
    ...(safeConfig.paths && typeof safeConfig.paths === "object"
      ? safeConfig.paths
      : {}),
  };
  const vendorMeasurementIdMap = {
    ...DEFAULT_CONFIG.vendorMeasurementIdMap,
    ...(safeConfig.vendorMeasurementIdMap &&
    typeof safeConfig.vendorMeasurementIdMap === "object"
      ? safeConfig.vendorMeasurementIdMap
      : {}),
  };

  return {
    ...DEFAULT_CONFIG,
    ...safeConfig,
    paths,
    inputColumns: {
      ...DEFAULT_CONFIG.inputColumns,
      ...(safeConfig.inputColumns ? safeConfig.inputColumns : {}),
    },
    columnAliases,
    resultMap: normalizedResultMap,
    vendorMeasurementIdMap,
    areas:
      Array.isArray(safeConfig.areas) && safeConfig.areas.length > 0
        ? safeConfig.areas
        : DEFAULT_CONFIG.areas,
    headerOrder:
      Array.isArray(safeConfig.headerOrder) && safeConfig.headerOrder.length > 0
        ? safeConfig.headerOrder
        : DEFAULT_CONFIG.headerOrder,
    metricKeyOrder:
      Array.isArray(safeConfig.metricKeyOrder) &&
      safeConfig.metricKeyOrder.length > 0
        ? safeConfig.metricKeyOrder
        : DEFAULT_CONFIG.metricKeyOrder,
    lineOrder:
      Array.isArray(safeConfig.lineOrder) && safeConfig.lineOrder.length > 0
        ? safeConfig.lineOrder
        : DEFAULT_CONFIG.lineOrder,
    desiredColumns: {
      ...DEFAULT_CONFIG.desiredColumns,
      ...(safeConfig.desiredColumns && typeof safeConfig.desiredColumns === "object"
        ? safeConfig.desiredColumns
        : {}),
    },
  };
}

function getSourceDir() {
  return appConfig.paths && appConfig.paths.sourceDir
    ? appConfig.paths.sourceDir
    : DEFAULT_SOURCE_DIR;
}

function getDesiredDir() {
  return appConfig.paths && appConfig.paths.desiredDir
    ? appConfig.paths.desiredDir
    : DEFAULT_DESIRED_DIR;
}

function ensureRuntimeDirs() {
  [getSourceDir(), getDesiredDir()].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function prepareConfig(config) {
  const normalizedAliases = {};
  Object.entries(config.columnAliases).forEach(([key, aliases]) => {
    normalizedAliases[key] = aliases.map((alias) => normalizeHeader(alias));
  });
  return {
    normalizedAliases,
    inputColumns: config.inputColumns,
  };
}

function setRuntimeConfig(config) {
  appConfig = mergeConfig(config);
  preparedConfig = prepareConfig(appConfig);
  return appConfig;
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      stateDB = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    } catch (e) {
      stateDB = {};
    }
  }
}

function saveState() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(stateDB, null, 2));
}

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      appConfig = mergeConfig(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")));
      preparedConfig = prepareConfig(appConfig);
      return;
    } catch (e) {
      appConfig = mergeConfig(DEFAULT_CONFIG);
      preparedConfig = prepareConfig(appConfig);
    }
  }
  appConfig = mergeConfig(DEFAULT_CONFIG);
  saveConfig();
}

function saveConfig(newConfig = appConfig) {
  const previousSource = getSourceDir();
  appConfig = mergeConfig(newConfig);
  preparedConfig = prepareConfig(appConfig);
  ensureRuntimeDirs();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2), "utf-8");
  if (STATE_FILE && previousSource !== getSourceDir()) {
    stateDB = {};
saveState();
  }
  return appConfig;
}

function detectDelimiter(content) {
  const lines = content.split(/\r?\n/).slice(0, 5).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return ",";
  const delimiters = [",", ";", "\t"];
  const counts = { ",": 0, ";": 0, "\t": 0 };
  lines.forEach(line => {
    delimiters.forEach(d => {
      const match = line.split(d);
      if (match) counts[d] += match.length - 1;
    });
  });
  let best = ",";
  let maxCount = -1;
  delimiters.forEach(d => {
    if (counts[d] > maxCount) {
      maxCount = counts[d];
      best = d;
    }
  });
  return best;
}

function parseCsvLine(line, delimiter = ",") {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

function parseCsvContent(content) {
  return String(content || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseDate(text) {
  const parts = String(text || "").split(/[-/]/).map(p => p.trim());
  if (parts.length !== 3) return null;
  let year, month, day;
  if (parts[0].length === 4) {
    year = parseInt(parts[0]);
    month = parseInt(parts[1]);
    day = parseInt(parts[2]);
  } else if (parts[2].length === 4) {
    year = parseInt(parts[2]);
    const p0 = parseInt(parts[0]);
    const p1 = parseInt(parts[1]);
    if (p0 > 12) {
      day = p0;
      month = p1;
    } else if (p1 > 12) {
      month = p0;
      day = p1;
    } else {
      // Default to MM/DD/YYYY
      month = p0;
      day = p1;
    }
  } else {
    return null;
  }
  return { year, month, day };
}

function normalizeDateValue(value) {
  const parsed = parseDate(value);
  if (!parsed) return String(value || "").trim();
  const monthStr = String(parsed.month).padStart(2, "0");
  const dayStr = String(parsed.day).padStart(2, "0");
  const yearStr = String(parsed.year);
  return `${dayStr}-${monthStr}-${yearStr}`;
}

function normalizeTimeValue(value) {
  const separator = appConfig.timeSeparator || ":";
  const parts = String(value || "")
    .trim()
    .replace(/[ :.-]+/g, separator)
    .split(separator)
    .filter(Boolean);
  if (parts.length < 2) return String(value || "").trim();
  const hours = parts[0].padStart(2, "0");
  const minutes = parts[1].padStart(2, "0");
  const seconds = (parts[2] || "00").padStart(2, "0");
  return `${hours}${separator}${minutes}${separator}${seconds}`;
}

function normalizeNumberKey(value) {
  const num = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(num) ? num.toFixed(2) : "";
}

const KNOWN_THRESHOLD_TRIPLES = new Set(
  [
    ["3.00", "4.00", "5.00"],
    ["-4.00", "-3.00", "-2.00"],
    ["-1.00", "0.00", "1.00"],
    ["-1.00", "0.00", "0.00"],
    ["4.00", "5.00", "6.00"],
    ["2.80", "4.00", "5.20"],
    ["5.00", "6.00", "7.00"],
    ["-3.00", "-2.00", "-1.00"],
  ].map((triple) => triple.join("|")),
);

function chooseThresholdFields(numericValues) {
  if (numericValues.length < 3) return null;

  const combos = [];
  for (let a = 0; a < numericValues.length - 2; a++) {
    for (let b = a + 1; b < numericValues.length - 1; b++) {
      for (let c = b + 1; c < numericValues.length; c++) {
        combos.push([numericValues[a], numericValues[b], numericValues[c]]);
      }
    }
  }

  let best = null;
  let bestScore = -Infinity;
  combos.forEach((combo) => {
    const sorted = [...combo].sort((left, right) => left.num - right.num);
    const key = sorted.map((item) => normalizeNumberKey(item.value)).join("|");
    const span = Math.abs(sorted[2].num - sorted[0].num);
    let score = KNOWN_THRESHOLD_TRIPLES.has(key) ? 1000 : 0;
    if (sorted[0].num <= sorted[1].num && sorted[1].num <= sorted[2].num) score += 50;
    score -= span / 100;
    if (score > bestScore) {
      bestScore = score;
      best = sorted;
    }
  });

  if (!best) return null;
  const thresholdIndexes = new Set(best.map((item) => item.index));
  const actual = numericValues.find((item) => !thresholdIndexes.has(item.index));
  return {
    lsl: best[0].value,
    target: best[1].value,
    usl: best[2].value,
    measured: actual ? actual.value : "",
  };
}
function parseFlexibleFlagsHeader(cols) {
  const values = cols.map((col) => String(col || "").trim());
  const DATE_REGEX = /^(\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})$/;
  const TIME_REGEX = /^\d{1,2}[: ]\d{2}([: ]\d{2})?$/;
  const dateIndex = values.findIndex(v => DATE_REGEX.test(v));
  const timeIndex = values.findIndex(v => TIME_REGEX.test(v));
  if (dateIndex < 0 || timeIndex < 0) return null;

  const VIN_REGEX = /^(MAT|MH)[A-Z0-9]{5,}$|^[A-HJ-NPR-Z0-9]{17}$/i;
  const remaining = values
    .map((value, index) => ({ value, index }))
    .filter((item) => item.index !== dateIndex && item.index !== timeIndex);
  const vinItem = remaining.find((item) => VIN_REGEX.test(item.value)) || remaining[0];
  const stationItem =
    remaining.find((item) => item.index !== (vinItem ? vinItem.index : -1)) ||
    remaining[1];

  if (!vinItem || !stationItem || !vinItem.value || !stationItem.value) {
    return null;
  }

  return {
    vin: vinItem.value,
    station: stationItem.value,
    date: normalizeDateValue(values[dateIndex]),
    time: normalizeTimeValue(values[timeIndex]),
    diagnostics: [
      "VIN/BSN detected successfully.",
      "Station detected successfully.",
      "Date detected successfully.",
      "Time detected successfully.",
    ],
  };
}

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function buildColumnMap(cols) {
  const normalizedHeaders = cols.map((col) => normalizeHeader(col));
  const map = {};

  Object.entries(preparedConfig.normalizedAliases).forEach(([key, aliases]) => {
    const index = normalizedHeaders.findIndex((header) =>
      aliases.includes(header),
    );
    if (index >= 0) map[key] = index;
  });

  return map;
}

function hasUsableHeader(cols) {
  const map = buildColumnMap(cols);
  return Object.keys(map).length >= 3 && map.vin !== undefined;
}

function formatConfiguredDate(dateValue) {
  const parsed = parseDate(dateValue);
  if (!parsed) return dateValue || "";
  const month = String(parsed.month).padStart(2, "0");
  const day = String(parsed.day).padStart(2, "0");
  const year = parsed.year;

  if (appConfig.dateFormat === "yyyy-mm-dd") return `${year}-${month}-${day}`;
  if (appConfig.dateFormat === "mm-dd-yyyy") return `${month}-${day}-${year}`;
  return `${day}-${month}-${year}`;
}

function formatConfiguredTime(timeValue) {
  const separator = appConfig.timeSeparator || ":";
  return String(timeValue || "")
    .trim()
    .replace(/[ :.-]+/g, separator);
}

function buildOutputValue(token, row) {
  if (token === "area") return appConfig.defaultArea || "";
  if (token === "station") {
    return row.station || appConfig.defaultStation || appConfig.defaultArea || "";
  }
  if (token === "final") return row.final || "Final";
  if (token === "date") return formatConfiguredDate(row.date);
  if (token === "time") return formatConfiguredTime(row.time);
  if (token === "metricKey") {
    if (row.metricKey) return row.metricKey;
    return appConfig.metricKeyOrder
      .map((part) => row[part])
      .filter(Boolean)
      .join("_");
  }
  const val = row[token];
  if (val === null || val === undefined || val === "N/A" || val === "null") {
    return "";
  }
  return val;
}

function getHeaderOrderForFormat(formatInfo) {
  if (formatInfo && ["compact", "vendor11"].includes(formatInfo.type)) {
    return ["vin", "station", "date", "time"];
  }
  return appConfig.headerOrder;
}

function getLineOrderForFormat(formatInfo) {
  if (formatInfo && ["compact", "vendor11"].includes(formatInfo.type)) {
    return ["metricKey", "passFail", "result", "measured", "lsl", "usl"];
  }
  return appConfig.lineOrder;
}

function scoreMapping(columnMap, rows, isVendorFormat) {
  let score = 0;
  let totalEvaluated = 0;

  for (const row of rows) {
    const dateVal = row[columnMap.date];
    const timeVal = row[columnMap.time];
    const vinVal = row[columnMap.vin];
    const lslVal = parseFloat(row[columnMap.lsl]);
    const targetVal = parseFloat(row[columnMap.target]);
    const uslVal = parseFloat(row[columnMap.usl]);
    const measuredVal = parseFloat(row[columnMap.measured]);
    const resultVal = parseFloat(row[columnMap.resultCode]);

    let rowValid = true;

    // If a column assigned to a numeric role actually holds non-numeric text
    // (e.g. a side/direction/location value landed there), that's a hard signal
    // the mapping is wrong â€” don't let the later NaN-guarded checks silently
    // skip over it with no penalty.
    ["lsl", "target", "usl", "measured", "resultCode"].forEach((key) => {
      const idx = columnMap[key];
      if (idx === undefined) return;
      const rawText = row[idx] === undefined || row[idx] === null ? "" : String(row[idx]).trim();
      if (rawText !== "" && isNaN(parseFloat(rawText))) {
        rowValid = false;
      }
    });

    // Required fields cannot be empty in valid data
    if (!dateVal || !timeVal || !vinVal) {
      rowValid = false;
    }

    // Check date, time, vin pattern if present
    if (dateVal && !/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$|^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(dateVal)) rowValid = false;
    if (timeVal && !/^\d{1,2}[: ]\d{2}([: ]\d{2})?$/ .test(timeVal)) rowValid = false;
    if (vinVal && !/^(MAT|MH)[A-Z0-9]{5,}$/i.test(vinVal) && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(vinVal)) rowValid = false;

    // Check spec limit ordering
    if (!isNaN(lslVal) && !isNaN(targetVal) && !isNaN(uslVal)) {
      if (!(lslVal <= targetVal && targetVal <= uslVal)) {
        rowValid = false;
      } else {
        if (lslVal < targetVal) score += 0.05;
        if (targetVal < uslVal) score += 0.05;
      }
    }

    // Check result mapping
    if (rowValid && !isNaN(lslVal) && !isNaN(uslVal) && !isNaN(measuredVal) && !isNaN(resultVal)) {
      const isPass = measuredVal >= lslVal && measuredVal <= uslVal;
      if (resultVal === 0) {
        if (!isPass) rowValid = false;
      } else if (resultVal === -1) {
        if (measuredVal >= lslVal) rowValid = false;
      } else if (resultVal === 1) {
        if (measuredVal >= lslVal && measuredVal <= uslVal) rowValid = false;
      }
    }

    if (rowValid) {
      score += 1.0;
    }
    totalEvaluated++;
  }

  // Statistical Constancy
  const metricGroups = {};
  rows.forEach(row => {
    const metricPart = row[columnMap.metricName] || row[columnMap.location] || "";
    if (!metricPart) return;
    const sidePart = columnMap.side !== undefined ? (row[columnMap.side] || "") : "";
    const dirPart = columnMap.direction !== undefined ? (row[columnMap.direction] || "") : "";
    const mKey = `${metricPart}__${sidePart}__${dirPart}`;
    if (!metricGroups[mKey]) metricGroups[mKey] = [];
    metricGroups[mKey].push(row);
  });

  let varianceOk = true;
  Object.values(metricGroups).forEach(group => {
    if (group.length <= 1) return;
    const lsls = group.map(r => parseFloat(r[columnMap.lsl])).filter(v => !isNaN(v));
    const targets = group.map(r => parseFloat(r[columnMap.target])).filter(v => !isNaN(v));
    const usls = group.map(r => parseFloat(r[columnMap.usl])).filter(v => !isNaN(v));
    const measureds = group.map(r => parseFloat(r[columnMap.measured])).filter(v => !isNaN(v));

    const allSame = (arr) => arr.every(v => v === arr[0]);

    if (lsls.length > 0 && !allSame(lsls)) varianceOk = false;
    if (targets.length > 0 && !allSame(targets)) varianceOk = false;
    if (usls.length > 0 && !allSame(usls)) varianceOk = false;
    
    if (measureds.length > 1 && !allSame(measureds)) {
      score += 0.5;
    }
  });

  if (!varianceOk) {
    score -= 10.0;
  }

  return score;
}

function permute(arr, k) {
  const results = [];
  function helper(current, remaining) {
    if (current.length === k) {
      results.push(current);
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      helper([...current, remaining[i]], [...remaining.slice(0, i), ...remaining.slice(i + 1)]);
    }
  }
  helper([], arr);
  return results;
}

function detectColumnsFromContent(rows) {
  const maxCols = Math.max(...rows.map(r => r.length));
  if (maxCols === 0) return null;

  const sampleRows = rows.slice(0, 200);

  // 1. Try Known Vendor Mappings first
  const default12Map = { date: 0, time: 1, vin: 2, location: 3, metricName: 4, side: 5, direction: 6, lsl: 7, target: 8, usl: 9, measured: 10, resultCode: 11 };
  const default11Map = { date: 0, time: 1, vin: 2, station: 3, location: 4, metricName: 5, lsl: 6, target: 7, usl: 8, measured: 9, resultCode: 10 };

  if (maxCols === 12) {
    const score = scoreMapping(default12Map, sampleRows, false);
    if (score >= sampleRows.length * 0.95) {
      return {
        columnMap: default12Map,
        isVendorFormat: false,
        confidence: 1.0,
        warnings: []
      };
    }
  } else if (maxCols === 11) {
    const score = scoreMapping(default11Map, sampleRows, true);
    if (score >= sampleRows.length * 0.95) {
      return {
        columnMap: default11Map,
        isVendorFormat: true,
        confidence: 1.0,
        warnings: []
      };
    }
  }

  // 2. Statistical/Pattern Detection
  const colStats = Array.from({ length: maxCols }, () => ({
    dates: 0,
    times: 0,
    vins: 0,
    sides: 0,
    directions: 0,
    gapsOrFlush: 0,
    spaces: 0,
    numbers: 0,
    resultCodes: 0,
    totalNonEmpty: 0,
  }));

  const DATE_REGEX = /^(\d{1,2}[-/]\d{1,2}[-/]\d{4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})$/;
  const TIME_REGEX = /^\d{1,2}[: ]\d{2}([: ]\d{2})?$/;
  const VIN_REGEX = /^(MAT|MH)[A-Z0-9]{5,}$/i;
  const SIDE_REGEX = /^(LH|RH)$/i;
  const DIRECTION_REGEX = /^(G|F)$/i;
  const resultCodeKeys = new Set(
    Object.keys((appConfig && appConfig.resultMap) || {}).map((key) => String(key).trim()),
  );

  rows.forEach(row => {
    row.forEach((val, idx) => {
      const text = String(val || "").trim();
      if (!text) return;
      const stats = colStats[idx];
      stats.totalNonEmpty++;

      if (DATE_REGEX.test(text)) stats.dates++;
      if (TIME_REGEX.test(text)) stats.times++;
      if (VIN_REGEX.test(text)) stats.vins++;
      if (SIDE_REGEX.test(text)) stats.sides++;
      if (DIRECTION_REGEX.test(text)) stats.directions++;
      if (/GAP|FLUSH/i.test(text)) stats.gapsOrFlush++;
      if (/\s/.test(text)) stats.spaces++;
      if (resultCodeKeys.has(text)) stats.resultCodes++;

      if (!isNaN(parseFloat(text))) {
        stats.numbers++;
      }
    });
  });

  const columnMap = {};
  const warnings = [];
  const matchedIndices = new Set();

  // Date
  let bestDateIdx = -1, maxDatePct = 0.5;
  for (let i = 0; i < maxCols; i++) {
    const stats = colStats[i];
    if (stats.totalNonEmpty === 0) continue;
    const pct = stats.dates / stats.totalNonEmpty;
    if (pct > maxDatePct) { maxDatePct = pct; bestDateIdx = i; }
  }
  if (bestDateIdx !== -1) {
    columnMap.date = bestDateIdx;
    matchedIndices.add(bestDateIdx);
  } else {
    warnings.push("Missing Date column (low pattern confidence).");
  }

  // Time
  let bestTimeIdx = -1, maxTimePct = 0.5;
  for (let i = 0; i < maxCols; i++) {
    if (matchedIndices.has(i)) continue;
    const stats = colStats[i];
    if (stats.totalNonEmpty === 0) continue;
    const pct = stats.times / stats.totalNonEmpty;
    if (pct > maxTimePct) { maxTimePct = pct; bestTimeIdx = i; }
  }
  if (bestTimeIdx !== -1) {
    columnMap.time = bestTimeIdx;
    matchedIndices.add(bestTimeIdx);
  } else {
    warnings.push("Missing Time column (low pattern confidence).");
  }

  // VIN
  let bestVinIdx = -1, maxVinPct = 0.5;
  for (let i = 0; i < maxCols; i++) {
    if (matchedIndices.has(i)) continue;
    const stats = colStats[i];
    if (stats.totalNonEmpty === 0) continue;
    const pct = stats.vins / stats.totalNonEmpty;
    if (pct > maxVinPct) { maxVinPct = pct; bestVinIdx = i; }
  }
  if (bestVinIdx !== -1) {
    columnMap.vin = bestVinIdx;
    matchedIndices.add(bestVinIdx);
  } else {
    warnings.push("Missing VIN column (low pattern confidence).");
  }

  // Side
  let bestSideIdx = -1, maxSidePct = 0.5;
  for (let i = 0; i < maxCols; i++) {
    if (matchedIndices.has(i)) continue;
    const stats = colStats[i];
    if (stats.totalNonEmpty === 0) continue;
    const pct = stats.sides / stats.totalNonEmpty;
    if (pct > maxSidePct) { maxSidePct = pct; bestSideIdx = i; }
  }
  if (bestSideIdx !== -1) {
    columnMap.side = bestSideIdx;
    matchedIndices.add(bestSideIdx);
  }

  // Direction
  let bestDirIdx = -1, maxDirPct = 0.5;
  for (let i = 0; i < maxCols; i++) {
    if (matchedIndices.has(i)) continue;
    const stats = colStats[i];
    if (stats.totalNonEmpty === 0) continue;
    const pct = stats.directions / stats.totalNonEmpty;
    if (pct > maxDirPct) { maxDirPct = pct; bestDirIdx = i; }
  }
  if (bestDirIdx !== -1) {
    columnMap.direction = bestDirIdx;
    matchedIndices.add(bestDirIdx);
  }

  // Result Code: identified by its distinct discrete-code signature (exact match
  // against the configured codes, e.g. "0"/"1"/"-1") rather than by decimal value,
  // since this is what reliably tells it apart from measured/lsl/target/usl values
  // (which are formatted with decimals, e.g. "4.00") even when columns are shuffled.
  let bestResultIdx = -1, maxResultPct = 0.6;
  for (let i = 0; i < maxCols; i++) {
    if (matchedIndices.has(i)) continue;
    const stats = colStats[i];
    if (stats.totalNonEmpty === 0) continue;
    const pct = stats.resultCodes / stats.totalNonEmpty;
    if (pct > maxResultPct) { maxResultPct = pct; bestResultIdx = i; }
  }

  const hasSideAndDir = bestSideIdx !== -1 && bestDirIdx !== -1;

  // Identify text candidates vs numeric candidates from remaining indices
  const textCols = [];
  const numericCandidates = [];
  for (let i = 0; i < maxCols; i++) {
    if (matchedIndices.has(i)) continue;
    const stats = colStats[i];
    if (stats.totalNonEmpty === 0) {
      numericCandidates.push(i);
      continue;
    }
    const numPct = stats.numbers / stats.totalNonEmpty;
    if (numPct > 0.5) {
      numericCandidates.push(i);
    } else {
      textCols.push(i);
    }
  }

  if (hasSideAndDir) {
    let bestLocIdx = -1, maxSpaces = -1;
    textCols.forEach(idx => {
      const stats = colStats[idx];
      if (stats.spaces > maxSpaces) {
        maxSpaces = stats.spaces;
        bestLocIdx = idx;
      }
    });
    if (bestLocIdx !== -1) {
      columnMap.location = bestLocIdx;
      matchedIndices.add(bestLocIdx);
    }

    const remainingText = textCols.filter(idx => idx !== bestLocIdx);
    if (remainingText.length > 0) {
      columnMap.metricName = remainingText[0];
      matchedIndices.add(remainingText[0]);
    } else {
      warnings.push("Missing Measurement Name column.");
    }
  } else {
    let bestMetricIdx = -1, maxGaps = -1;
    textCols.forEach(idx => {
      const stats = colStats[idx];
      if (stats.gapsOrFlush > maxGaps) {
        maxGaps = stats.gapsOrFlush;
        bestMetricIdx = idx;
      }
    });
    if (bestMetricIdx !== -1) {
      columnMap.metricName = bestMetricIdx;
      matchedIndices.add(bestMetricIdx);
    }

    let bestLocIdx = -1, maxSpaces = -1;
    textCols.forEach(idx => {
      if (idx === bestMetricIdx) return;
      const stats = colStats[idx];
      if (stats.spaces > maxSpaces) {
        maxSpaces = stats.spaces;
        bestLocIdx = idx;
      }
    });
    if (bestLocIdx !== -1) {
      columnMap.location = bestLocIdx;
      matchedIndices.add(bestLocIdx);
    }

    const remainingText = textCols.filter(idx => idx !== bestMetricIdx && idx !== bestLocIdx);
    if (remainingText.length > 0) {
      columnMap.station = remainingText[0];
      matchedIndices.add(remainingText[0]);
    }
  }

  // Numeric fields permutation search.
  // Two variants are tried and the higher-scoring one wins:
  //   A) resultCode locked to the discrete-code column detected above, searching
  //      only lsl/target/usl/measured among the remaining candidates.
  //   B) all five roles (including resultCode) searched freely, as a safety net
  //      in case the discrete-code signal above didn't find a confident match.
  // Comparing scores (rather than always trusting the lock) means a wrong guess
  // in (A) can never beat a better-fitting assignment found by (B), and vice versa.
  const candidatesForLocked = numericCandidates.filter((idx) => idx !== bestResultIdx);
  const buildCandidateMap = (perm, lockedResultIdx) => {
    const map = {
      ...columnMap,
      lsl: perm[0],
      target: perm[1],
      usl: perm[2],
      measured: perm[3],
    };
    map.resultCode = lockedResultIdx !== undefined ? lockedResultIdx : perm[4];
    return map;
  };

  let lockedPerms = [];
  let lockedBestScore = -1;
  let lockedBestAssignment = null;
  if (bestResultIdx !== -1) {
    lockedPerms = permute(candidatesForLocked, Math.min(4, candidatesForLocked.length));
    lockedPerms.forEach(perm => {
      const score = scoreMapping(buildCandidateMap(perm, bestResultIdx), sampleRows, !hasSideAndDir);
      if (score > lockedBestScore) {
        lockedBestScore = score;
        lockedBestAssignment = perm;
      }
    });
  }

  const freePerms = permute(numericCandidates, Math.min(5, numericCandidates.length));
  let freeBestScore = -1;
  let freeBestAssignment = null;
  freePerms.forEach(perm => {
    const score = scoreMapping(buildCandidateMap(perm), sampleRows, !hasSideAndDir);
    if (score > freeBestScore) {
      freeBestScore = score;
      freeBestAssignment = perm;
    }
  });

  const useLocked = lockedBestAssignment !== null && lockedBestScore >= freeBestScore;
  const numericPerms = useLocked ? lockedPerms : freePerms;
  const bestNumericAssignment = useLocked
    ? (lockedBestAssignment ? [...lockedBestAssignment, bestResultIdx] : null)
    : freeBestAssignment;
  const bestNumericScore = useLocked ? lockedBestScore : freeBestScore;
  const lockedResultForBest = useLocked ? bestResultIdx : undefined;

  if (bestNumericAssignment) {
    if (bestNumericAssignment[0] !== undefined) {
      columnMap.lsl = bestNumericAssignment[0];
      matchedIndices.add(bestNumericAssignment[0]);
    }
    if (bestNumericAssignment[1] !== undefined) {
      columnMap.target = bestNumericAssignment[1];
      matchedIndices.add(bestNumericAssignment[1]);
    }
    if (bestNumericAssignment[2] !== undefined) {
      columnMap.usl = bestNumericAssignment[2];
      matchedIndices.add(bestNumericAssignment[2]);
    }
    if (bestNumericAssignment[3] !== undefined) {
      columnMap.measured = bestNumericAssignment[3];
      matchedIndices.add(bestNumericAssignment[3]);
    }
    if (bestNumericAssignment[4] !== undefined) {
      columnMap.resultCode = bestNumericAssignment[4];
      matchedIndices.add(bestNumericAssignment[4]);
    }
  }

  if (columnMap.lsl === undefined) warnings.push("Missing LSL column.");
  if (columnMap.usl === undefined) warnings.push("Missing USL column.");
  if (columnMap.measured === undefined) warnings.push("Missing Actual Value column.");
  if (columnMap.resultCode === undefined) warnings.push("Missing Result column.");

  // Compute confidence
  let confidence = 0.0;
  if (sampleRows.length > 0) {
    confidence = Math.min(1.0, bestNumericScore / sampleRows.length);
  } else {
    confidence = 1.0;
  }

  // Ambiguity check (run against whichever variant won above)
  let matchCount = 0;
  numericPerms.forEach(perm => {
    const score = scoreMapping(buildCandidateMap(perm, lockedResultForBest), sampleRows, !hasSideAndDir);
    if (Math.abs(score - bestNumericScore) < 0.01) {
      matchCount++;
    }
  });
  if (matchCount > 1) {
    confidence *= 0.8;
    warnings.push("Unable to uniquely identify numeric column roles due to identical data pattern matches.");
  }

  return {
    columnMap,
    isVendorFormat: !hasSideAndDir,
    confidence,
    warnings
  };
}

function detectInputFormat(lines, delimiter = ",") {
  const firstLineCols = parseCsvLine(lines[0], delimiter);
  
  // 1. Check if compact format
  const secondLineCols = lines[1] ? parseCsvLine(lines[1], delimiter) : [];
  if (
    firstLineCols.length >= 4 &&
    firstLineCols.length <= 5 &&
    parseFlexibleFlagsHeader(firstLineCols) &&
    secondLineCols.length >= 1
  ) {
    return {
      type: "compact",
      firstLineCols,
      dataLines: lines.slice(1),
      detectedFormat: "Identifier compact format",
      delimiter
    };
  }

  const firstContentRow = normalizeVendorRowByContent(firstLineCols, { type: "vendor11" });
  if (
    firstContentRow.vin &&
    firstContentRow.program &&
    firstContentRow.date &&
    firstContentRow.time &&
    firstContentRow.metric
  ) {
    return {
      type: "vendor11",
      columnMap: {},
      isVendorFormat: true,
      contentBasedRows: true,
      confidence: 1.0,
      warnings: ["Content-based vendor format detected."],
      dataLines: lines,
      detectedFormat: "Vendor content auto-detected",
      delimiter
    };
  }

  // 2. Check if the first line is a header
  const hasHeader = hasUsableHeader(firstLineCols);
  if (hasHeader) {
    const columnMap = buildColumnMap(firstLineCols);
    const isVendorFormat = columnMap.side === undefined && columnMap.direction === undefined;
    return {
      type: isVendorFormat ? "vendor11" : "header",
      columnMap,
      isVendorFormat,
      confidence: 1.0,
      warnings: [],
      dataLines: lines.slice(1),
      detectedFormat: isVendorFormat ? "Vendor 11-column inspection format (Header)" : "Header auto-detected",
      delimiter
    };
  }

  // 3. Position-independent content-based detection
  const rows = lines.map(line => parseCsvLine(line, delimiter));
  const detection = detectColumnsFromContent(rows);
  if (!detection) {
    return {
      type: "position",
      columnMap: {},
      isVendorFormat: false,
      confidence: 0.0,
      warnings: ["Could not detect column structure from file content."],
      dataLines: lines,
      detectedFormat: "Unknown Format",
      delimiter
    };
  }

  const { columnMap, isVendorFormat, confidence, warnings } = detection;
  return {
    type: isVendorFormat ? "vendor11" : "position",
    columnMap,
    isVendorFormat,
    confidence,
    warnings,
    dataLines: lines,
    detectedFormat: isVendorFormat ? "Vendor 11-column inspection format" : "Content auto-detected positions",
    delimiter
  };
}

function looksLikeVendorInspectionRow(cols) {
  if (!Array.isArray(cols) || cols.length !== 11) return false;
  const hasDate = /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cols[0] || "");
  const hasTime = /^\d{1,2}[: ]\d{2}([: ]\d{2})?$/.test(cols[1] || "");
  const numericFields = [6, 7, 8].every((index) => !isNaN(parseFloat(cols[index])));
  return hasDate && hasTime && Boolean(cols[2]) && Boolean(cols[5]) && numericFields;
}

function mapResultFromIdentifiers(identifier1, identifier2, measured, lsl, usl, direction) {
  const primary = String(identifier1 || "").trim().toUpperCase();
  const secondary = String(identifier2 || "").trim().toUpperCase();
  if (secondary) return secondary;
  if (primary === "P") return "NO";

  const actual = parseFloat(measured);
  const min = parseFloat(lsl);
  const max = parseFloat(usl);
  if (!isNaN(actual) && !isNaN(min) && actual < min) return "UF";
  if (!isNaN(actual) && !isNaN(max) && actual > max) {
    return String(direction || "").trim().toUpperCase() === "G" ? "TG" : "OF";
  }
  return primary === "F" ? "NG" : "NO";
}

function mapMachineResultCode(resultCode, measured, lsl, usl, direction) {
  const code = String(resultCode || "").trim();
  return appConfig.resultMap[code] || "NG";
}

function getMetricKeyForFormat(formatInfo, outputRow) {
  if (formatInfo.type === "vendor11") return outputRow.metricName || outputRow.location || "";
  const parts = [];
  if (outputRow.metricName) parts.push(outputRow.metricName);
  if (outputRow.side) parts.push(outputRow.side);
  if (outputRow.direction) parts.push(outputRow.direction);
  return parts.join("_");
}

function resolveVendorMeasurementId(row) {
  const rawMetricName = String(row.metricName || row.location || "").trim();
  const normalizedMetricName = rawMetricName.replace(/\s+/g, " ").toUpperCase();
  if (/^L23G\d+(AFV|AMV)$/i.test(rawMetricName)) return rawMetricName;
  return appConfig.vendorMeasurementIdMap[normalizedMetricName] || rawMetricName;
}

function normalizeOutputMeasurement(value) {
  if (value === null || value === undefined || value === "" || value === "N/A" || value === "null") {
    return "";
  }
  return String(value).trim();
}

function validateRequiredFields(columnMap, isVendorFormat) {
  const missing = [];
  if (columnMap.vin === undefined) missing.push("VIN");
  if (columnMap.date === undefined) missing.push("Date");
  if (columnMap.time === undefined) missing.push("Time");
  if (columnMap.location === undefined) missing.push("Measurement Point");
  if (columnMap.metricName === undefined) missing.push("Measurement Name");
  // Actual values may be blank for NG/not-given records; validate per row instead of rejecting the file.
  return missing;
}

function isProgramLike(value) {
  return /^PRACTC\d*_V\d+/i.test(String(value || "").trim());
}

function isMetricLike(value) {
  return /\b(GAP|FLUSH)\b/i.test(String(value || "").trim());
}

function isResultCodeLike(value) {
  return /^[01]$/.test(String(value || "").trim());
}

function isDateLike(value) {
  return parseDate(value) !== null;
}

function isTimeLike(value) {
  return /^\d{1,2}[: ]\d{2}([: ]\d{2})?$/.test(String(value || "").trim());
}

function isLikelyVin(value) {
  const text = String(value || "").trim();
  return /^(MAT|MH)[A-Z0-9]{5,}$/i.test(text) || /^[A-HJ-NPR-Z0-9]{17}$/i.test(text);
}

function normalizeVendorRowByContent(cols, formatInfo) {
  const values = cols.map((value, index) => ({
    value: String(value || "").trim(),
    index,
  }));
  const used = new Set();
  const take = (predicate) => {
    const item = values.find((candidate) => !used.has(candidate.index) && predicate(candidate.value));
    if (item) used.add(item.index);
    return item ? item.value : "";
  };

  const rawDate = take(isDateLike);
  const rawTime = take(isTimeLike);
  const vin = take((value) => /^MAT/i.test(value) || isLikelyVin(value));
  const program = take(isProgramLike);
  const metric = take(isMetricLike);
  const result = take(isResultCodeLike);
  const point = take((value) => value && !isDateLike(value) && !isTimeLike(value) && !isLikelyVin(value) && !isProgramLike(value) && !isMetricLike(value) && isNaN(Number.parseFloat(value)));

  const numericValues = values
    .filter((candidate) => !used.has(candidate.index))
    .map((candidate) => ({
      ...candidate,
      num: Number.parseFloat(candidate.value),
    }))
    .filter((candidate) => Number.isFinite(candidate.num));
  const thresholds = chooseThresholdFields(numericValues) || {};

  return {
    parserVersion: "2.1",
    sourceFormat: formatInfo.type,
    rawRow: cols,
    date: normalizeDateValue(rawDate),
    rawDate,
    time: normalizeTimeValue(rawTime),
    rawTime,
    vin,
    program,
    point,
    metric,
    side: "",
    direction: (() => {
      const upperMetric = metric.toUpperCase();
      if (upperMetric.includes("GAP")) return "G";
      if (upperMetric.includes("FLUSH")) return "F";
      return "";
    })(),
    lsl: thresholds.lsl === undefined || thresholds.lsl === "" ? null : Number.parseFloat(thresholds.lsl),
    rawLsl: thresholds.lsl || "",
    target: thresholds.target === undefined || thresholds.target === "" ? null : Number.parseFloat(thresholds.target),
    rawTarget: thresholds.target || "",
    usl: thresholds.usl === undefined || thresholds.usl === "" ? null : Number.parseFloat(thresholds.usl),
    rawUsl: thresholds.usl || "",
    actual: thresholds.measured === undefined || thresholds.measured === "" ? null : Number.parseFloat(thresholds.measured),
    rawActual: thresholds.measured || "",
    result: result === "" ? null : Number.parseFloat(result),
    rawResult: result,
    warnings: [],
  };
}
function validateNormalizedData(normalizedRows, isVendorFormat) {
  const missing = new Set();
  
  let hasVin = false;
  let hasDate = false;
  let hasTime = false;
  let hasPoint = false;
  let hasMetric = false;
  let hasActual = false;

  normalizedRows.forEach(row => {
    if (row.vin) hasVin = true;
    if (row.date) hasDate = true;
    if (row.time) hasTime = true;
    if (row.point) hasPoint = true;
    if (row.metric) hasMetric = true;
    if (row.actual !== null) hasActual = true;
  });

  if (!hasVin) missing.add("VIN");
  if (!hasDate) missing.add("Date");
  if (!hasTime) missing.add("Time");
  if (!hasPoint) missing.add("Measurement Point");
  if (!hasMetric) missing.add("Measurement Name");


  return Array.from(missing);
}

function normalizeRow(cols, columnMap, isVendorFormat, formatInfo) {
  if (isVendorFormat) {
    const contentRow = normalizeVendorRowByContent(cols, formatInfo);
    if (contentRow.vin && contentRow.program && contentRow.date && contentRow.time && contentRow.metric) {
      return contentRow;
    }
  }

  const getVal = (key) => {
    const idx = columnMap[key];
    return idx !== undefined && cols[idx] !== undefined ? String(cols[idx]).trim() : "";
  };

  const getNumericVal = (key) => {
    const val = getVal(key);
    return (val === "" || val === "N/A" || val === "null") ? null : parseFloat(val);
  };

  const rawDate = getVal("date");
  const rawTime = getVal("time");

  return {
    parserVersion: "2.0",
    sourceFormat: formatInfo.type,
    rawRow: cols,

    date: normalizeDateValue(rawDate),
    rawDate,
    time: normalizeTimeValue(rawTime),
    rawTime,
    vin: getVal("vin"),
    program: isVendorFormat ? getVal("station") : "",

    point: getVal("location"),
    metric: getVal("metricName"),

    side: !isVendorFormat ? getVal("side") : "",
    direction: !isVendorFormat ? getVal("direction") : (() => {
      // Vendor format has no separate direction column â€” extract it from the
      // tail of the full metric name, e.g. "HOOD TO FENDER LH 1 GAP" â†’ "G"
      const mn = getVal("metricName").toUpperCase().trimEnd();
      if (mn.endsWith("GAP") || mn.endsWith(" GAP")) return "G";
      if (mn.endsWith("FLUSH") || mn.endsWith(" FLUSH")) return "F";
      return "";
    })(),

    lsl: getNumericVal("lsl"),
    rawLsl: getVal("lsl"),
    target: getNumericVal("target"),
    rawTarget: getVal("target"),
    usl: getNumericVal("usl"),
    rawUsl: getVal("usl"),
    actual: getNumericVal("measured"),
    rawActual: getVal("measured"),
    result: getNumericVal("resultCode"),
    rawResult: getVal("resultCode"),

    warnings: []
  };
}

function convertCompactIdentifierFile(formatInfo, outputPath) {
  const headerRow = parseFlexibleFlagsHeader(formatInfo.firstLineCols);
  if (!headerRow) {
    return {
      ok: false,
      msg: "Error: Unknown FLAGS header format. VIN/BSN, station, date, and time could not all be detected.",
    };
  }

  const outputLines = [
    getHeaderOrderForFormat(formatInfo)
      .map((token) => buildOutputValue(token, headerRow))
      .join(","),
  ];
  const missingFields = [];
  const seenMetricKeys = new Map();
  let malformedRows = 0;
  let rowCount = 0;
  let passCount = 0;
  let failCount = 0;
  let noResultCount = 0;
  let duplicateCount = 0;

  formatInfo.dataLines.forEach((line, index) => {
    const cols = parseCsvLine(line, formatInfo.delimiter);
    const lineNumber = index + 2;
    const dc = appConfig.desiredColumns || DEFAULT_CONFIG.desiredColumns;
    const minCols = Math.max(dc.metricKey, dc.passFail, dc.result, dc.measured, dc.lsl, dc.usl) + 1;
    if (cols.length < minCols) {
      malformedRows += 1;
      missingFields.push(`Malformed row on line ${lineNumber}: expected at least ${minCols} fields, found ${cols.length}.`);
      return;
    }
    rowCount += 1;
    const metricKey  = (cols[dc.metricKey]  || "").trim();
    const identifier1 = (cols[dc.passFail]  || "").trim();
    const identifier2 = (cols[dc.result]    || "").trim();
    const measured   = (cols[dc.measured]   || "").trim();
    const lsl        = (cols[dc.lsl]        || "").trim();
    const usl        = (cols[dc.usl]        || "").trim();
    if (!metricKey || !identifier1 || !identifier2) {
      if (!metricKey) missingFields.push(`Measurement ID missing on line ${lineNumber}.`);
      if (!identifier1) missingFields.push(`Status missing on line ${lineNumber}.`);
      if (!identifier2) missingFields.push(`Failure type missing on line ${lineNumber}.`);
      malformedRows += 1;
      return;
    }

    const dupKey = `${headerRow.vin}_${headerRow.date}_${headerRow.time}_${metricKey}`;
    if (seenMetricKeys.has(dupKey)) {
      duplicateCount += 1;
      const duplicateMessage = `Duplicate Metric: ${metricKey}`;
      if (!missingFields.includes(duplicateMessage)) {
        missingFields.push(duplicateMessage);
      }
      return;
    } else {
      seenMetricKeys.set(dupKey, rowCount);
    }

    const passFail = identifier1;
    const result = identifier2;
    if (passFail === "P") passCount += 1;
    else failCount += 1;
    if (result === "NG") noResultCount += 1;

    outputLines.push(
      getLineOrderForFormat(formatInfo)
        .map((token) =>
          buildOutputValue(token, {
            metricKey,
            passFail,
            result,
            measured,
            lsl,
            usl,
          }),
        )
        .join(","),
    );
  });

  if (rowCount === 0) {
    return {
      ok: false,
      msg:
        malformedRows > 0
          ? `Error: FLAGS format detected but all ${malformedRows} measurement rows are malformed.`
          : "Error: FLAGS format detected but no measurement rows found.",
      missing: missingFields,
    };
  }

  fs.writeFileSync(outputPath, outputLines.join("\n"), "utf-8");
  const uniqueWarnings = [...new Set(missingFields)];
  return {
    ok: true,
    msg:
      uniqueWarnings.length > 0
        ? `Conversion completed with ${uniqueWarnings.length} warning${uniqueWarnings.length === 1 ? "" : "s"}.`
        : "Processed perfectly.",
    missing: uniqueWarnings,
    metrics: {
      rows: rowCount,
      pass: passCount,
      fail: failCount,
      noResult: noResultCount,
      duplicates: duplicateCount,
      malformed: malformedRows,
    },
    detectedFormat: formatInfo.detectedFormat,
  };
}

function convertFile(inputPath, outputPath) {
  try {
    const fileContent = fs.readFileSync(inputPath, "utf-8").trim();

    if (!fileContent)
      return { ok: false, msg: "Error: File is completely empty." };

    const lines = fileContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0)
      return { ok: false, msg: "Error: No valid data rows found." };

    const delimiter = detectDelimiter(fileContent);
    const formatInfo = detectInputFormat(lines, delimiter);
    if (formatInfo.type === "compact") {
      return convertCompactIdentifierFile(formatInfo, outputPath);
    }

    const missingRequired = formatInfo.contentBasedRows ? [] : validateRequiredFields(formatInfo.columnMap, formatInfo.isVendorFormat);
    const validationErrors = [];
    if (missingRequired.length > 0) {
      validationErrors.push(`Missing: ${missingRequired.join(", ")}`);
    }

    if (formatInfo.confidence < 0.8) {
      validationErrors.push(
        `Low parser confidence (${Math.round(formatInfo.confidence * 100)}%). ${formatInfo.warnings.join(" ")}`,
      );
    }

    const columnMap = formatInfo.columnMap;
    const isVendorFormat = formatInfo.isVendorFormat;

    const normalizedRows = formatInfo.dataLines.map((line) => {
      const cols = parseCsvLine(line, delimiter);
      return normalizeRow(cols, columnMap, isVendorFormat, formatInfo);
    });

    if (normalizedRows.length === 0) {
      return { ok: false, msg: "Error: No convertible metric rows found." };
    }

    const missingData = validateNormalizedData(normalizedRows, isVendorFormat);
    if (missingData.length > 0) {
      validationErrors.push(`Fields missing in data: ${missingData.join(", ")}`);
    }

    const firstRow = normalizedRows[0];
    const headerRow = {
      vin: firstRow.vin,
      station: isVendorFormat ? firstRow.program : (firstRow.station || ""),
      area: appConfig.defaultArea || "",
      date: firstRow.date,
      time: firstRow.time,
      location: firstRow.point,
      final: "Final",
    };

    const header = getHeaderOrderForFormat(formatInfo)
      .map((token) => buildOutputValue(token, headerRow))
      .join(",");

    let outputLines = [header];
    let warnings = [...validationErrors];
    let rowCount = 0;
    let validCount = 0;
    let passCount = 0;
    let failCount = 0;
    let noResultCount = 0;
    let duplicateCount = 0;
    let skippedCount = 0;

    const seenMetricKeys = new Set();

    normalizedRows.forEach((row) => {
      rowCount += 1;

      const pointName = row.point || "Unknown Joint";
      const measurementMissing = row.actual === null;
      if (measurementMissing) {
        if (!warnings.includes(`Measurement: ${pointName}`))
          warnings.push(`Measurement: ${pointName}`);
      }
      if (row.lsl === null) {
        if (!warnings.includes(`Minimum Limit: ${pointName}`))
          warnings.push(`Minimum Limit: ${pointName}`);
      }
      if (row.usl === null) {
        if (!warnings.includes(`Maximum Limit: ${pointName}`))
          warnings.push(`Maximum Limit: ${pointName}`);
      }
      // Note: "Status Code" warning is handled in the pf/rf block below,
      // only when result cannot be inferred from measurement vs limits.

      if (!row.vin || !row.date) {
        skippedCount += 1;
        return;
      }

      validCount += 1;

      // Determine pass/fail and result label.
      // When result code is absent but measurement and limits are present, infer
      // from the data rather than defaulting to NG (which causes spurious warnings).
      const rfCode = row.result !== null ? String(row.result) : "";
      let pf, rf;

      if (measurementMissing) {
        pf = "F";
        rf = "NG";
      } else if (rfCode !== "") {
        pf = rfCode === "0" ? "P" : "F";
        rf = mapMachineResultCode(rfCode, row.rawActual || "", row.rawLsl || "", row.rawUsl || "", row.direction || "");
      } else {
        // Result code missing â€” infer from measurement vs spec limits
        const actual = row.actual;
        const lslV  = row.lsl;
        const uslV  = row.usl;
        if (lslV !== null && uslV !== null && actual !== null) {
          pf = (actual >= lslV && actual <= uslV) ? "P" : "F";
          if (pf === "P") {
            rf = "NO";
          } else {
            const dir = row.direction || "";
            if (actual < lslV) rf = "UF";
            else rf = dir.toUpperCase() === "G" ? "TG" : "OF";
          }
          // Suppress the "Status Code" warning â€” result was successfully inferred
        } else {
          // No limits either â€” genuinely unknown, mark NG and warn
          pf = "F";
          rf = "NG";
          if (!warnings.includes(`Status Code: ${pointName}`))
            warnings.push(`Status Code: ${pointName}`);
        }
      }
      if (pf === "P") passCount += 1;
      else failCount += 1;

      if (rf === "NG") noResultCount += 1;

      const outputRow = {
        date: row.date,
        time: row.time,
        vin: row.vin,
        location: row.point,
        metricName: row.metric,
        side: row.side || "",
        direction: row.direction || "",
        lsl: row.rawLsl,
        target: row.rawTarget,
        usl: row.rawUsl,
        measured: row.rawActual,
        resultCode: row.rawResult,
        passFail: pf,
        result: rf,
        station: row.program || "",
      };

      const metricKey =
        formatInfo.type === "vendor11"
          ? resolveVendorMeasurementId(outputRow)
          : getMetricKeyForFormat(formatInfo, outputRow) || pointName;
      outputRow.metricKey = metricKey;

      const dupKey = `${row.vin}_${row.date}_${row.time}_${row.point}_${row.metric}_${row.side}_${row.direction}`;
      if (seenMetricKeys.has(dupKey)) {
        duplicateCount += 1;
        const duplicateMessage = `Duplicate Metric: ${metricKey}`;
        if (!warnings.includes(duplicateMessage)) {
          warnings.push(duplicateMessage);
        }
        return;
      } else {
        seenMetricKeys.add(dupKey);
      }

      outputLines.push(
        getLineOrderForFormat(formatInfo)
          .map((token) => buildOutputValue(token, outputRow))
          .join(","),
      );
    });

    // Always write the output file â€” even when validation failed, operators
    // need to be able to open and inspect what was produced.
    fs.writeFileSync(outputPath, outputLines.join("\n"), "utf-8");

    const hasValidationErrors = validationErrors.length > 0;
    const finalMsg = hasValidationErrors
      ? `Parse Error. ${validationErrors[0]}`
      : warnings.length > 0
        ? "Processed with missing data. Operator review required."
        : "Processed perfectly.";

    return {
      // ok:false keeps the FAILED badge in the dashboard; outputPath is still
      // set so the Open button works even for failed conversions.
      ok: !hasValidationErrors,
      outputPath,           // always present so processFile can set output
      msg: finalMsg,
      missing: warnings,
      metrics: {
        rows: rowCount,
        valid: validCount,
        pass: passCount,
        fail: failCount,
        noResult: noResultCount,
        duplicates: duplicateCount,
        skipped: skippedCount,
        warnings: warnings.length,
      },
      detectedFormat: formatInfo.detectedFormat,
    };
  } catch (error) {
    return { ok: false, msg: `Error: ${error.message}` };
  }
}

// --- 4. THE WATCHER ---
function processFile(filePath, force = false) {
  const fileName = path.basename(filePath);

  // Excel Ghost File Protection
  if (fileName.startsWith("~$") || fileName.startsWith(".")) return;

  const ext = path.extname(filePath).toLowerCase();
  if (ext !== ".csv" && ext !== ".txt") return;

  const stats = fs.statSync(filePath);
  const mtime = stats.mtimeMs;

  if (force || !stateDB[fileName] || stateDB[fileName].mtime < mtime) {
    const baseName = path.parse(fileName).name;
    const outputPath = path.join(getDesiredDir(), `${baseName}_converted.txt`);

    const result = convertFile(filePath, outputPath);

    stateDB[fileName] = {
      mtime: mtime,
      status: result.ok
        ? result.missing && result.missing.length > 0
          ? "WARNING"
          : "DONE"
        : "FAILED",
      msg: result.msg,
      missing: result.missing || [],
      metrics: result.metrics || {
        rows: 0,
        pass: 0,
        fail: 0,
        noResult: 0,
        duplicates: 0,
      },
      output: result.outputPath || (result.ok ? outputPath : null),
      area: appConfig.defaultArea || "",
      detected_format: result.detectedFormat || "",
      processed_time: new Date().toLocaleString(),
    };
    saveState();
  }
}

function startWatcher() {
  loadState();
  ensureRuntimeDirs();

  if (watcher) watcher.close();
  watcher = chokidar.watch(getSourceDir(), {
    persistent: true,
    ignored: /(^|[\/\\])\~\$.*/, // Ignore Excel lock files
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
  });

  watcher
    .on("add", (p) => processFile(p, false))
    .on("change", (p) => processFile(p, false));
}

// --- 5. ELECTRON APP ---
let mainWindow;
if (isElectronRuntime) {
  app.whenReady().then(() => {
    STATE_FILE = path.join(app.getPath("userData"), "processed_db.json");
    CONFIG_FILE = path.join(app.getPath("userData"), "conversion_config.json");
    loadConfig();
    startWatcher();

    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      title: "GapFlush Live Dashboard",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    mainWindow.loadFile(path.join(__dirname, "src", "index.html"));
  });

  ipcMain.handle("get-data", () => {
    try {
      ensureRuntimeDirs();
      const sourceDir = getSourceDir();
      const files = fs.readdirSync(sourceDir);
      let dashboardData = [];
      files.forEach((file) => {
        const ext = path.extname(file).toLowerCase();
        if ((ext !== ".csv" && ext !== ".txt") || file.startsWith("~$")) return;
        const stats = fs.statSync(path.join(sourceDir, file));
        const rec = stateDB[file] || {};
        dashboardData.push({
          name: file,
          status: rec.status || "NEW",
          msg: rec.msg || "Waiting in queue...",
          missing: rec.missing || [],
          metrics: rec.metrics || {
            rows: 0,
            pass: 0,
            fail: 0,
            noResult: 0,
            duplicates: 0,
          },
          mtime: new Date(stats.mtimeMs).toLocaleString(),
          ptime: rec.processed_time || "Not processed yet",
          output: rec.output || "",
          area: rec.area || appConfig.defaultArea || "",
          detectedFormat: rec.detected_format || "",
        });
      });
      return dashboardData;
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle("get-config", () => appConfig);

  ipcMain.handle("save-config", (event, config) => {
    const previousSource = getSourceDir();
    const saved = saveConfig(config);
    if (previousSource !== getSourceDir()) startWatcher();
    return saved;
  });

  ipcMain.handle("choose-folder", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return "";
    return result.filePaths[0];
  });

  ipcMain.handle("open-file", (event, filePath) => {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
  });
  ipcMain.handle("retrigger-file", (event, fileName) => {
    const filePath = path.join(getSourceDir(), fileName);
    if (fs.existsSync(filePath)) processFile(filePath, true);
  });
}

module.exports = {
  DEFAULT_CONFIG,
  convertFile,
  detectInputFormat,
  parseCsvLine,
  setRuntimeConfig,
};
