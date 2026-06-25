let currentData = [];
let sortColumn = "ptime";
let sortAsc = false;

let mainSearchTerm = "";
let modalSearchTerm = "";
let mainNavIndex = -1;
let modalNavIndex = -1;
let conversionConfig = null;

const DEFAULT_CONVERSION_CONFIG = {
  paths: {
    sourceDir: "D:\\Source",
    desiredDir: "D:\\Desired",
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
  headerOrder: ["vin", "station", "date", "time"],
  metricKeyOrder: ["metricName", "side", "direction"],
  lineOrder: ["metricKey", "passFail", "result", "measured", "lsl", "usl"],
};

const CONFIG_TOKENS = [
  "vin",
  "area",
  "station",
  "date",
  "time",
  "location",
  "metricName",
  "side",
  "direction",
  "lsl",
  "target",
  "usl",
  "measured",
  "resultCode",
  "metricKey",
  "passFail",
  "result",
  "final",
];

// --- DATE FORMATTER ---
function formatExactDate(dateStr) {
  if (!dateStr || dateStr.includes("Not processed")) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const pad = (n) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

window.setSort = function (column) {
  if (sortColumn === column) sortAsc = !sortAsc;
  else {
    sortColumn = column;
    sortAsc = true;
  }
  renderTable();
};

window.showToast = function (message, type = "success") {
  const container = document.getElementById("toastContainer");
  const toast = document.createElement("div");
  toast.className = "toast-pill";
  if (type === "error") toast.style.backgroundColor = "#ef4444";
  else if (type === "warning") toast.style.backgroundColor = "#f59e0b";
  else if (type === "info") toast.style.backgroundColor = "#3b82f6";
  else toast.style.backgroundColor = "#10b981";

  toast.innerHTML = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
};

// --- DATA ENGINE ---
async function fetchData() {
  try {
    if (!window.api) {
      currentData = [];
      updateStats();
      updateIssueLogButton();
      renderTable();
      renderModalTable();
      return;
    }
    currentData = await window.api.getData();
    updateStats();
    updateIssueLogButton();
    updateProcessView();
    renderTable();
    renderModalTable();
  } catch (error) {
    console.error("Data sync error:", error);
  }
}

async function fetchConfig() {
  try {
    conversionConfig = window.api
      ? await window.api.getConfig()
      : { ...DEFAULT_CONVERSION_CONFIG };
    updateProcessView();
  } catch (error) {
    conversionConfig = { ...DEFAULT_CONVERSION_CONFIG };
    updateProcessView();
    console.error("Config load error:", error);
  }
}

function toCsvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAreas(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function renderAreaOptions(areas, selectedArea) {
  const areaSelect = document.getElementById("configArea");
  if (!areaSelect) return;
  areaSelect.innerHTML = "";
  areas.forEach((area) => {
    const option = document.createElement("option");
    option.value = area;
    option.textContent = area;
    option.selected = area === selectedArea;
    areaSelect.appendChild(option);
  });
}

function renderQuickAreaOptions(areas, selectedArea) {
  const areaSelect = document.getElementById("quickAreaSelect");
  if (!areaSelect) return;

  const currentValue = areaSelect.value;
  const desiredValue = areas.includes(currentValue) ? currentValue : selectedArea;

  areaSelect.innerHTML = "";
  areas.forEach((area) => {
    const option = document.createElement("option");
    option.value = area;
    option.textContent = area;
    option.selected = area === desiredValue;
    areaSelect.appendChild(option);
  });
}

function getProcessGroup(area) {
  const normalized = String(area || "").toUpperCase();
  if (normalized.includes("STAMPING")) return "STAMPING";
  if (normalized.includes("BIW")) return "BIW";
  if (normalized.includes("PAINT")) return "PAINT";
  if (normalized.includes("TCF")) return "TCF";
  return "";
}

function updateProcessView() {
  const config = conversionConfig || DEFAULT_CONVERSION_CONFIG;
  const activeArea = config.defaultArea || DEFAULT_CONVERSION_CONFIG.defaultArea;
  const badge = document.getElementById("activeAreaBadge");
  if (badge) badge.textContent = `AREA: ${activeArea}`;

  renderQuickAreaOptions(config.areas || [], activeArea);

  renderIssueTimeline();
}

function getTimelineStats() {
  const stats = {
    STAMPING: { total: 0, warning: 0, failed: 0 },
    BIW: { total: 0, warning: 0, failed: 0 },
    PAINT: { total: 0, warning: 0, failed: 0 },
    TCF: { total: 0, warning: 0, failed: 0 },
  };

  currentData.forEach((file) => {
    const group =
      getProcessGroup(file.area) ||
      getProcessGroup(
        conversionConfig
          ? conversionConfig.defaultArea
          : DEFAULT_CONVERSION_CONFIG.defaultArea,
      );
    if (!stats[group]) return;
    stats[group].total += 1;
    if (file.status === "WARNING") stats[group].warning += 1;
    if (file.status === "FAILED") stats[group].failed += 1;
  });

  return stats;
}

function renderIssueTimeline() {
  const container = document.getElementById("issueTimeline");
  if (!container) return;
  const stats = getTimelineStats();
  const stages = [
    ["STAMPING", "Stamping"],
    ["BIW", "BIW"],
    ["PAINT", "Paint"],
    ["TCF", "TCF"],
  ];
  const maxIssues = Math.max(
    1,
    ...Object.values(stats).map((item) => item.warning + item.failed),
  );

  container.innerHTML = stages
    .map(([key, label]) => {
      const item = stats[key];
      const issueCount = item.warning + item.failed;
      const width = Math.max(8, Math.round((issueCount / maxIssues) * 100));
      const className =
        item.failed > 0 ? "failed" : item.warning > 0 ? "warning" : "";
      const countText =
        issueCount > 0
          ? `${issueCount} issue${issueCount === 1 ? "" : "s"}`
          : "Clear";
      return `
        <div class="timeline-item ${className}">
          <div class="timeline-stage">${label}</div>
          <div class="timeline-bar"><div class="timeline-fill" style="width:${issueCount ? width : 0}%"></div></div>
          <div class="timeline-count">${countText}</div>
        </div>
      `;
    })
    .join("");
}

function renderColumnConfig(config) {
  const grid = document.getElementById("columnConfigGrid");
  if (!grid) return;
  grid.innerHTML = "";

  Object.entries(DEFAULT_CONVERSION_CONFIG.inputColumns).forEach(
    ([key, defaultValue]) => {
      const wrapper = document.createElement("div");
      wrapper.className = "settings-field";
      const currentValue =
        config.inputColumns && config.inputColumns[key] !== undefined
          ? config.inputColumns[key]
          : defaultValue;
      wrapper.innerHTML = `
        <label for="column-${key}">${key}</label>
        <input id="column-${key}" class="form-control column-config-input" type="number" min="0" step="1" value="${currentValue}" data-column-key="${key}" />
      `;
      grid.appendChild(wrapper);
    },
  );
}

function renderAliasConfig(columnAliases) {
  const container = document.getElementById("aliasConfigRows");
  if (!container) return;
  container.innerHTML = "";

  Object.entries(DEFAULT_CONVERSION_CONFIG.columnAliases).forEach(([key]) => {
    const aliases = Array.isArray(columnAliases[key]) ? columnAliases[key] : [];
    const row = document.createElement("div");
    row.className = "settings-table-row mb-2 alias-config-row";
    row.dataset.aliasKey = key;

    const keyInput = document.createElement("input");
    keyInput.className = "form-control form-control-sm";
    keyInput.value = key;
    keyInput.disabled = true;

    const aliasInput = document.createElement("input");
    aliasInput.className = "form-control form-control-sm alias-values-input";
    aliasInput.value = aliases.join(", ");
    aliasInput.placeholder = "header1, header2, header3";

    const modeLabel = document.createElement("span");
    modeLabel.className = "text-muted small";
    modeLabel.textContent = "Auto";

    row.appendChild(keyInput);
    row.appendChild(aliasInput);
    row.appendChild(modeLabel);
    container.appendChild(row);
  });
}

function renderResultMapConfig(resultMap) {
  const container = document.getElementById("resultMapRows");
  if (!container) return;
  container.innerHTML = "";

  Object.entries(resultMap || {}).forEach(([code, value]) => {
    appendResultMapRow(code, value);
  });
}

function appendResultMapRow(code = "", value = "") {
  const container = document.getElementById("resultMapRows");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "settings-table-row result-map-row mb-2 result-map-config-row";

  const codeInput = document.createElement("input");
  codeInput.className = "form-control form-control-sm result-code-input";
  codeInput.value = code;
  codeInput.placeholder = "0";

  const valueInput = document.createElement("input");
  valueInput.className = "form-control form-control-sm result-value-input";
  valueInput.value = value;
  valueInput.placeholder = "NO";

  const removeButton = document.createElement("button");
  removeButton.className = "btn btn-sm btn-outline-danger";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => row.remove());

  row.appendChild(codeInput);
  row.appendChild(valueInput);
  row.appendChild(removeButton);
  container.appendChild(row);
}

function collectAliasConfig() {
  const aliases = {};
  document.querySelectorAll(".alias-config-row").forEach((row) => {
    const key = row.dataset.aliasKey;
    const input = row.querySelector(".alias-values-input");
    aliases[key] = toCsvList(input ? input.value : "");
  });
  return aliases;
}

function collectResultMapConfig() {
  const resultMap = {};
  document.querySelectorAll(".result-map-config-row").forEach((row) => {
    const codeInput = row.querySelector(".result-code-input");
    const valueInput = row.querySelector(".result-value-input");
    const code = codeInput ? codeInput.value.trim() : "";
    const value = valueInput ? valueInput.value.trim() : "";
    if (code && value) resultMap[code] = value;
  });
  return resultMap;
}

function renderSettingsTokens() {
  const tokenBox = document.getElementById("settingsTokens");
  if (!tokenBox) return;
  tokenBox.innerHTML = CONFIG_TOKENS.map(
    (token) => `<span class="settings-token">${token}</span>`,
  ).join("");
}

function populateSettingsForm(config) {
  const merged = {
    ...DEFAULT_CONVERSION_CONFIG,
    ...config,
    inputColumns: {
      ...DEFAULT_CONVERSION_CONFIG.inputColumns,
      ...(config && config.inputColumns ? config.inputColumns : {}),
    },
    columnAliases: {
      ...DEFAULT_CONVERSION_CONFIG.columnAliases,
      ...(config && config.columnAliases ? config.columnAliases : {}),
    },
    resultMap: {
      ...DEFAULT_CONVERSION_CONFIG.resultMap,
      ...(config && config.resultMap ? config.resultMap : {}),
    },
  };
  conversionConfig = merged;
  renderAreaOptions(merged.areas, merged.defaultArea);
  setInputValue("configAreas", merged.areas.join("\n"));
  setInputValue("configDateFormat", merged.dateFormat);
  setInputValue("configTimeSeparator", merged.timeSeparator || ":");
  setInputValue("configHeaderOrder", merged.headerOrder.join(","));
  setInputValue("configLineOrder", merged.lineOrder.join(","));
  setInputValue("configMetricKeyOrder", merged.metricKeyOrder.join(","));
  renderAliasConfig(merged.columnAliases);
  renderResultMapConfig(merged.resultMap);
  renderColumnConfig(merged);
  renderSettingsTokens();
}

function collectSettingsForm() {
  const columnInputs = document.querySelectorAll(".column-config-input");
  const inputColumns = {};
  columnInputs.forEach((input) => {
    inputColumns[input.dataset.columnKey] = Number(input.value);
  });

  const areas = parseAreas(document.getElementById("configAreas").value);
  const columnAliases = collectAliasConfig();
  const resultMap = collectResultMapConfig();
  const selectedArea = document.getElementById("configArea").value;
  const defaultArea = areas.includes(selectedArea)
    ? selectedArea
    : areas[0] || DEFAULT_CONVERSION_CONFIG.defaultArea;

  return {
    defaultArea,
    areas,
    dateFormat: document.getElementById("configDateFormat").value,
    timeSeparator:
      document.getElementById("configTimeSeparator").value.trim() || ":",
    inputColumns,
    columnAliases,
    resultMap,
    headerOrder: toCsvList(document.getElementById("configHeaderOrder").value),
    metricKeyOrder: toCsvList(
      document.getElementById("configMetricKeyOrder").value,
    ),
    lineOrder: toCsvList(document.getElementById("configLineOrder").value),
  };
}

window.openSettingsModal = async function () {
  if (!conversionConfig) await fetchConfig();
  populateSettingsForm(conversionConfig);
  document.getElementById("settingsModal").style.display = "flex";
};

window.closeSettingsModal = function () {
  document.getElementById("settingsModal").style.display = "none";
};

window.resetSettingsForm = function () {
  populateSettingsForm(DEFAULT_CONVERSION_CONFIG);
};

window.addResultMapRow = function () {
  appendResultMapRow("", "");
};

window.saveSettingsForm = async function () {
  try {
    const config = collectSettingsForm();
    conversionConfig = window.api ? await window.api.saveConfig(config) : config;
    populateSettingsForm(conversionConfig);
    updateProcessView();
    showToast("Settings saved. Use Retry to reprocess older files.", "success");
  } catch (error) {
    console.error("Config save error:", error);
    showToast("Settings could not be saved.", "error");
  }
};

fetchData();
fetchConfig();
setInterval(fetchData, 2000);
setInterval(
  () =>
    (document.getElementById("clock").innerText = new Date().toLocaleString()),
  1000,
);

// --- STATS UPDATER ---
function updateStats() {
  let done = 0,
    warn = 0,
    fail = 0;
  currentData.forEach((f) => {
    if (f.status === "DONE") done++;
    else if (f.status === "WARNING") warn++;
    else if (f.status === "FAILED") fail++;
  });

  const dEl = document.getElementById("stat-done");
  const wEl = document.getElementById("stat-warn");
  const fEl = document.getElementById("stat-fail");

  if (dEl) dEl.innerText = done;
  if (wEl) wEl.innerText = warn;
  if (fEl) fEl.innerText = fail;
}

window.triggerRetry = function (fileName, btnElement) {
  if (btnElement) {
    btnElement.innerHTML = "Retrying...";
    btnElement.disabled = true;
    btnElement.classList.add("btn-secondary");
    btnElement.classList.remove("btn-outline-primary", "btn-primary");
  }
  window.api.retrigger(fileName);
  showToast(`Retry queued for ${fileName}`, "info");
};

// --- MAIN GRID RENDERER (SOFT UI) ---
function renderTable() {
  const tbody = document.getElementById("tableBody");
  tbody.innerHTML = "";

  let filteredData = currentData.filter((f) =>
    f.name.toLowerCase().includes(mainSearchTerm),
  );

  filteredData.sort((a, b) => {
    let valA = a[sortColumn] || "";
    let valB = b[sortColumn] || "";
    if (sortColumn === "mtime" || sortColumn === "ptime") {
      valA = isNaN(Date.parse(valA)) ? 0 : new Date(valA).getTime();
      valB = isNaN(Date.parse(valB)) ? 0 : new Date(valB).getTime();
    } else {
      valA = valA.toLowerCase();
      valB = valB.toLowerCase();
    }
    if (valA < valB) return sortAsc ? -1 : 1;
    if (valA > valB) return sortAsc ? 1 : -1;
    return 0;
  });

  document.querySelectorAll("thead th .sort-icon").forEach((icon) => {
    icon.innerHTML = "";
    icon.parentElement.classList.remove("active");
  });
  const activeIcon = document.getElementById(`icon-${sortColumn}`);
  if (activeIcon) {
    activeIcon.innerHTML = sortAsc ? "↑" : "↓";
    activeIcon.parentElement.classList.add("active");
  }

  if (filteredData.length === 0) {
    // Updated colspan to 7
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">
            <div class="empty-state-icon">TPEM</div>
            <h5 class="fw-bold">No Data Found</h5>
            <p>Waiting for inspection files in D:\\Source.</p>
        </td></tr>`;
    return;
  }

  filteredData.forEach((f) => {
    const tr = document.createElement("tr");
    tr.className = `row-${f.status}`;

    let badgeHtml = "";
    let elegantMsg = "";

    if (f.status === "DONE") {
      badgeHtml = `<span class="badge-soft-success">SUCCESS</span>`;
      elegantMsg = `<span class="fw-bold" style="color:#10b981;">Valid Scan</span>`;
    } else if (f.status === "WARNING") {
      badgeHtml = `<span class="badge-soft-warning">WARNING</span>`;
      elegantMsg = `<span class="fw-bold" style="color:#f59e0b;">Missing Data</span>`;
    } else if (f.status === "FAILED") {
      badgeHtml = `<span class="badge-soft-danger">FAILED</span>`;
      elegantMsg = `<span class="fw-bold" style="color:#ef4444;">Parse Error</span>`;
    }

    // Restore the Folder Button Action
    let actionBtn = f.output
      ? `<button class="btn btn-outline-secondary btn-sm btn-folder px-3" onclick="window.api.openFile('${f.output.replace(/\\/g, "\\\\")}')">Open</button>`
      : `<span class="text-muted">-</span>`;

    let retryBtn = `<button class="btn btn-outline-primary btn-sm btn-retry px-3" onclick="triggerRetry('${f.name}', this)">Retry</button>`;

    tr.innerHTML = `
            <td class="fw-bold" style="color:#0f172a;">${f.name}</td>
            <td>${badgeHtml}</td>
            <td>${elegantMsg}</td>
            <td class="tabular-data">${formatExactDate(f.mtime)}</td>
            <td class="tabular-data">${formatExactDate(f.ptime)}</td>
            <td class="text-center">${actionBtn}</td>
            <td class="text-center">${retryBtn}</td>
        `;
    tbody.appendChild(tr);
  });
}

function updateIssueLogButton() {
  const issueBtn = document.getElementById("issueLogBtn");
  if (!issueBtn) return;
  const anomalies = currentData.filter(
    (f) => f.status === "WARNING" || f.status === "FAILED",
  );
  if (anomalies.length > 0) {
    issueBtn.className = "btn btn-danger w-100 fw-bold animate-pulse";
    issueBtn.innerHTML = `Issue Log Dashboard (${anomalies.length} Faults)`;
  } else {
    issueBtn.className = "btn btn-secondary w-100 fw-bold";
    issueBtn.innerHTML = `No Issues Detected`;
  }
}

window.openIssueModal = function () {
  document.getElementById("issueModal").style.display = "flex";
  document.getElementById("modalSearchInput").value = "";
  modalSearchTerm = "";
  renderModalTable();
  setTimeout(() => document.getElementById("modalSearchInput").focus(), 100);
};

window.closeIssueModal = function () {
  document.getElementById("issueModal").style.display = "none";
};

function renderModalTable() {
  const modalBody = document.getElementById("modalTableBody");
  if (!modalBody) return;

  modalBody.innerHTML = "";
  let issues = currentData.filter(
    (f) => f.status === "WARNING" || f.status === "FAILED",
  );
  if (modalSearchTerm) {
    issues = issues.filter((f) =>
      f.name.toLowerCase().includes(modalSearchTerm),
    );
  }

  if (issues.length === 0) {
    modalBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 fw-bold text-success">All shop floor systems clear. No faults detected.</td></tr>`;
    return;
  }

  issues.forEach((f) => {
    const tr = document.createElement("tr");
    let typeBadge =
      f.status === "WARNING"
        ? `<span class="badge-warning">WARNING</span>`
        : `<span class="badge-danger">FAILED</span>`;
    let diagnosticCell =
      f.status === "WARNING"
        ? f.missing
            .map(
              (issue) =>
                `<div class="mb-1"><span class="badge text-dark" style="background-color: #fcd34d; border: 1px solid #d97706;">${issue}</span></div>`,
            )
            .join("")
        : `<span class="text-danger fw-bold">${f.msg}</span>`;
    let retryBtn = `<button class="btn btn-primary btn-sm w-100 btn-retry" onclick="triggerRetry('${f.name}', this)">Retry</button>`;

    tr.innerHTML = `
            <td><strong>${f.name}</strong></td>
            <td>${typeBadge}</td>
            <td>${diagnosticCell}</td>
            <td class="tabular-data">${formatExactDate(f.ptime)}</td>
            <td>${retryBtn}</td>
        `;
    modalBody.appendChild(tr);
  });
}

// --- SEARCH & KEYBOARD LOGIC ---
document.addEventListener("DOMContentLoaded", () => {
  const mainInput = document.getElementById("mainSearchInput");
  const mainBox = document.getElementById("mainSuggestionBox");
  if (mainInput) {
    mainInput.addEventListener("input", (e) => {
      mainSearchTerm = e.target.value.toLowerCase().trim();
      mainNavIndex = -1;
      const matches = currentData.filter((f) =>
        f.name.toLowerCase().includes(mainSearchTerm),
      );
      if (!mainSearchTerm || matches.length === 0) {
        mainBox.style.display = "none";
      } else {
        mainBox.innerHTML = "";
        mainBox.style.display = "block";
        matches.slice(0, 8).forEach((match) => {
          const div = document.createElement("div");
          div.className = "suggestion-item";
          div.innerHTML = `<strong>${match.name}</strong>`;
          div.addEventListener("click", () => {
            mainInput.value = match.name;
            mainSearchTerm = match.name.toLowerCase();
            mainBox.style.display = "none";
            renderTable();
          });
          mainBox.appendChild(div);
        });
      }
      renderTable();
    });

    mainInput.addEventListener("keydown", (e) => {
      const items = mainBox.querySelectorAll(".suggestion-item");
      if (items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        mainNavIndex = (mainNavIndex + 1) % items.length;
        items.forEach((it, i) =>
          it.classList.toggle("active-nav", i === mainNavIndex),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        mainNavIndex = (mainNavIndex - 1 + items.length) % items.length;
        items.forEach((it, i) =>
          it.classList.toggle("active-nav", i === mainNavIndex),
        );
      } else if (e.key === "Enter" && mainNavIndex >= 0) {
        e.preventDefault();
        items[mainNavIndex].click();
      }
    });
  }

  const modalInput = document.getElementById("modalSearchInput");
  const modalBox = document.getElementById("modalSuggestionBox");
  if (modalInput) {
    modalInput.addEventListener("input", (e) => {
      modalSearchTerm = e.target.value.toLowerCase().trim();
      modalNavIndex = -1;
      const issues = currentData.filter(
        (f) => f.status === "WARNING" || f.status === "FAILED",
      );
      const matches = issues.filter((f) =>
        f.name.toLowerCase().includes(modalSearchTerm),
      );
      if (!modalSearchTerm || matches.length === 0) {
        modalBox.style.display = "none";
      } else {
        modalBox.innerHTML = "";
        modalBox.style.display = "block";
        matches.slice(0, 8).forEach((match) => {
          const div = document.createElement("div");
          div.className = "suggestion-item";
          div.innerHTML = `<strong>${match.name}</strong>`;
          div.addEventListener("click", () => {
            modalInput.value = match.name;
            modalSearchTerm = match.name.toLowerCase();
            modalBox.style.display = "none";
            renderModalTable();
          });
          modalBox.appendChild(div);
        });
      }
      renderModalTable();
    });

    modalInput.addEventListener("keydown", (e) => {
      const items = modalBox.querySelectorAll(".suggestion-item");
      if (items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        modalNavIndex = (modalNavIndex + 1) % items.length;
        items.forEach((it, i) =>
          it.classList.toggle("active-nav", i === modalNavIndex),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        modalNavIndex = (modalNavIndex - 1 + items.length) % items.length;
        items.forEach((it, i) =>
          it.classList.toggle("active-nav", i === modalNavIndex),
        );
      } else if (e.key === "Enter" && modalNavIndex >= 0) {
        e.preventDefault();
        items[modalNavIndex].click();
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (
      mainInput &&
      !mainInput.contains(e.target) &&
      !mainBox.contains(e.target)
    )
      mainBox.style.display = "none";
    if (
      modalInput &&
      !modalInput.contains(e.target) &&
      !modalBox.contains(e.target)
    )
      modalBox.style.display = "none";
  });

  const areaListInput = document.getElementById("configAreas");
  if (areaListInput) {
    areaListInput.addEventListener("input", () => {
      const areas = parseAreas(areaListInput.value);
      const selectedArea = document.getElementById("configArea").value;
      renderAreaOptions(areas, selectedArea);
    });
  }
  updateProcessView();
});

window.exportShiftReport = function () {
  const issues = currentData.filter(
    (f) => f.status === "WARNING" || f.status === "FAILED",
  );
  if (issues.length === 0) {
    showToast("No errors to export.", "warning");
    return;
  }
  let csvContent =
    "File Name,Status Type,Diagnostic Error Message,Missing Data Points,Last Processed Time\n";
  issues.forEach((f) => {
    let missingString =
      f.missing && f.missing.length > 0 ? f.missing.join(" | ") : "N/A";
    let cleanMsg = f.msg.replace(/"/g, '""');
    csvContent += `"${f.name}","${f.status}","${cleanMsg}","${missingString}","${formatExactDate(f.ptime)}"\n`;
  });
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().slice(0, 10);
  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", `Shift_Error_Report_${timestamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Exported Shift_Error_Report_${timestamp}.csv successfully!`);
};
