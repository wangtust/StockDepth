const state = {
  runs: [],
  selectedRun: null,
  reports: [],
  activeKey: null,
  timer: null,
  renderedReportId: null,
  renderedReportVersion: null,
  scrollPositions: new Map(),
  options: null,
};

const $ = (selector) => document.querySelector(selector);

function formatTime(ts) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString();
}

function setToday() {
  const input = document.querySelector('input[name="date"]');
  input.value = new Date().toISOString().slice(0, 10);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || response.statusText);
  return payload;
}

function fillDatalist(id, options) {
  const list = $(`#${id}`);
  list.innerHTML = "";
  for (const option of options) {
    if (!option.value) continue;
    const item = document.createElement("option");
    item.value = option.value;
    item.label = option.label;
    list.appendChild(item);
  }
}

function fillSelect(select, options, selectedValue) {
  select.innerHTML = "";
  for (const option of options) {
    const item = document.createElement("option");
    item.value = option.value;
    item.textContent = option.label;
    if (String(option.value) === String(selectedValue)) item.selected = true;
    select.appendChild(item);
  }
}

function selectedProvider() {
  const value = $("#providerSelect").value;
  return state.options?.providers.find((provider) => provider.value === value);
}

function setModelInputs(provider) {
  if (!provider) return;
  $("#baseUrl").value = provider.base_url || "";
  fillDatalist("quickModelOptions", provider.quick_models || []);
  fillDatalist("deepModelOptions", provider.deep_models || []);
  const quick = (provider.quick_models || []).find((model) => model.value);
  const deep = (provider.deep_models || []).find((model) => model.value);
  $("#quickModel").value = quick?.value || "";
  $("#deepModel").value = deep?.value || "";
}

async function loadOptions() {
  state.options = await fetchJson("/api/options");
  fillDatalist("languageOptions", state.options.languages || []);
  fillSelect($("#depthSelect"), state.options.depths || [], 1);
  fillSelect($("#providerSelect"), state.options.providers || [], "qwen");
  setModelInputs(selectedProvider());
}

async function loadRuns() {
  const payload = await fetchJson("/api/runs");
  state.runs = payload.runs;
  renderRuns();
  if (!state.selectedRun && state.runs.length) {
    selectRun(state.runs[0].ticker, state.runs[0].date);
  }
}

function renderRuns() {
  const box = $("#runs");
  box.innerHTML = "";
  for (const run of state.runs) {
    const item = document.createElement("div");
    item.className = "run-item";
    if (state.selectedRun?.ticker === run.ticker && state.selectedRun?.date === run.date) {
      item.classList.add("active");
    }
    item.innerHTML = `
      <div class="run-row">
        <span class="ticker">${run.ticker}</span>
        <span class="badge ${run.status}">${run.status}</span>
      </div>
      <div class="muted">${run.date} · ${run.report_count} reports</div>
      <div class="muted">${formatTime(run.updated_at)}</div>
    `;
    item.addEventListener("click", () => selectRun(run.ticker, run.date));
    box.appendChild(item);
  }
}

function selectRun(ticker, date) {
  saveCurrentScroll();
  state.selectedRun = { ticker, date };
  state.activeKey = null;
  state.renderedReportId = null;
  state.renderedReportVersion = null;
  renderRuns();
  loadRun();
  clearInterval(state.timer);
  state.timer = setInterval(loadRun, 2000);
}

async function loadRun() {
  if (!state.selectedRun) return;
  const { ticker, date } = state.selectedRun;
  const payload = await fetchJson(`/api/run?ticker=${encodeURIComponent(ticker)}&date=${encodeURIComponent(date)}`);
  state.reports = payload.reports;
  if (!state.activeKey && state.reports.length) {
    state.activeKey = state.reports[state.reports.length - 1].key;
  }
  $("#runTitle").textContent = `${ticker} · ${date}`;
  $("#runMeta").textContent = `${state.reports.length} reports · ${payload.status}`;
  $("#runStatus").textContent = payload.status;
  $("#updatedAt").textContent = formatTime(payload.updated_at);
  $("#liveLog").textContent = payload.runner_log || payload.message_log || "No live log yet.";
  renderTabs();
  renderActiveReport();
}

function renderTabs() {
  const tabs = $("#tabs");
  tabs.innerHTML = "";
  for (const report of state.reports) {
    const button = document.createElement("button");
    button.className = "tab";
    if (report.key === state.activeKey) button.classList.add("active");
    button.textContent = report.title;
    button.title = report.relative_path;
    button.addEventListener("click", () => {
      saveCurrentScroll();
      state.activeKey = report.key;
      state.renderedReportId = null;
      state.renderedReportVersion = null;
      renderTabs();
      renderActiveReport();
    });
    tabs.appendChild(button);
  }
}

function reportId(report) {
  if (!state.selectedRun || !report) return "";
  return `${state.selectedRun.ticker}:${state.selectedRun.date}:${report.key}`;
}

function reportVersion(report) {
  if (!report) return "";
  return `${report.mtime}:${report.size}`;
}

function saveCurrentScroll() {
  const content = $("#content");
  if (!state.renderedReportId || !content) return;
  state.scrollPositions.set(state.renderedReportId, content.scrollTop);
}

function renderActiveReport() {
  const content = $("#content");
  const report = state.reports.find((item) => item.key === state.activeKey) || state.reports.at(-1);
  if (!report) {
    content.className = "markdown empty";
    content.innerHTML = "<h2>等待报告生成</h2><p>分析已经开始后，报告会自动出现在这里。</p>";
    state.renderedReportId = null;
    state.renderedReportVersion = null;
    return;
  }

  state.activeKey = report.key;
  const nextReportId = reportId(report);
  const nextVersion = reportVersion(report);
  if (state.renderedReportId === nextReportId && state.renderedReportVersion === nextVersion) {
    return;
  }

  saveCurrentScroll();
  const previousTop =
    state.renderedReportId === nextReportId
      ? content.scrollTop
      : state.scrollPositions.get(nextReportId) || 0;

  content.className = "markdown";
  const html = marked.parse(report.content || "");
  content.innerHTML = DOMPurify.sanitize(html);
  state.renderedReportId = nextReportId;
  state.renderedReportVersion = nextVersion;
  requestAnimationFrame(() => {
    content.scrollTop = Math.min(previousTop, Math.max(0, content.scrollHeight - content.clientHeight));
  });
}

async function startAnalysis(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const analysts = Array.from(form.querySelectorAll('input[name="analysts"]:checked')).map((item) => item.value);
  const payload = {
    ticker: data.get("ticker"),
    date: data.get("date"),
    language: data.get("language"),
    depth: Number(data.get("depth")),
    provider: data.get("provider"),
    base_url: data.get("base_url"),
    quick_model: data.get("quick_model"),
    deep_model: data.get("deep_model"),
    analysts,
  };
  $("#startStatus").textContent = "Starting...";
  try {
    const result = await fetchJson("/api/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    $("#startStatus").textContent = `${result.status}: ${result.ticker} ${result.date}`;
    await loadRuns();
    selectRun(result.ticker, result.date);
  } catch (error) {
    $("#startStatus").textContent = error.message;
  }
}

function setupLogToggle() {
  $("#toggleLog").addEventListener("click", () => {
    const panel = document.querySelector(".log-panel");
    const wrap = document.querySelector(".content-wrap");
    panel.classList.toggle("hidden");
    wrap.classList.toggle("log-hidden");
  });
}

function setupProviderSelect() {
  $("#providerSelect").addEventListener("change", (event) => {
    const provider = state.options?.providers.find((item) => item.value === event.target.value);
    setModelInputs(provider);
  });
}

async function init() {
  setToday();
  await loadOptions();
  $("#refreshRuns").addEventListener("click", loadRuns);
  $("#startForm").addEventListener("submit", startAnalysis);
  $("#content").addEventListener("scroll", saveCurrentScroll, { passive: true });
  setupProviderSelect();
  setupLogToggle();
  loadRuns();
  setInterval(loadRuns, 5000);
}

init().catch((error) => {
  $("#startStatus").textContent = error.message;
});
