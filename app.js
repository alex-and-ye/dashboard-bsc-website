const fileInput = document.querySelector("#csvFile");
const fileName = document.querySelector("#fileName");
const generateBtn = document.querySelector("#generateBtn");
const clearBtn = document.querySelector("#clearBtn");
const statusText = document.querySelector("#status");
const dashboard = document.querySelector("#dashboard");
const summaryCards = document.querySelector("#summaryCards");
const initiativeRows = document.querySelector("#initiativeRows");
const deltaHeatmap = document.querySelector("#deltaHeatmap");

const chartInstances = new Map();
let selectedFile = null;

const palette = ["#377dff", "#ff9f43", "#8b5cf6", "#31c48d", "#16c8e5", "#ef4444", "#0f766e", "#f59e0b"];

Chart.defaults.font.family = "Inter, system-ui, sans-serif";
Chart.defaults.color = "#657189";
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.plugins.legend.labels.boxHeight = 12;
Chart.defaults.plugins.legend.labels.usePointStyle = true;

fileInput.addEventListener("change", (event) => {
  selectedFile = event.target.files?.[0] ?? null;
  fileName.textContent = selectedFile ? selectedFile.name : "Файл еще не выбран";
  setStatus(selectedFile ? "Файл выбран. Нажмите «Сгенерировать»." : "Готов к загрузке данных.");
});

generateBtn.addEventListener("click", () => {
  if (!selectedFile) {
    setStatus("Выберите CSV-файл перед генерацией.", true);
    return;
  }

  Papa.parse(selectedFile, {
    header: true,
    skipEmptyLines: true,
    encoding: "UTF-8",
    complete: ({ data, errors }) => {
      if (errors.length) {
        setStatus(`Ошибка CSV: ${errors[0].message}`, true);
        return;
      }

      const rows = normalizeRows(data);
      if (!rows.length) {
        setStatus("В файле не найдены строки с KPI.", true);
        return;
      }

      renderDashboard(rows);
      setStatus(`Dashboard создан: ${rows.length} строк, ${unique(rows.map((row) => row.kpi)).length} KPI.`);
    },
    error: (error) => setStatus(`Не удалось прочитать файл: ${error.message}`, true),
  });
});

clearBtn.addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  fileName.textContent = "Файл еще не выбран";
  clearDashboard();
  setStatus("Dashboard очищен. Можно загрузить новый файл.");
});

function normalizeRows(data) {
  return data
    .map((row) => ({
      branch: clean(row["Ветка BSC"]),
      perspective: clean(row["Перспектива"]),
      kpi: clean(row.KPI),
      initiative: clean(row["Инициатива"]),
      date: parseDate(row["Дата"]),
      plan: parseNumber(row["План"]),
      fact: parseNumber(row["Факт"]),
      delta: parseNumber(row["Δ"]),
      domain: clean(row["Домен"]),
    }))
    .filter((row) => row.branch && row.perspective && row.kpi && row.date);
}

function renderDashboard(rows) {
  clearCharts();
  dashboard.classList.remove("is-empty");

  const latestActualByKpi = latestRowsBy(
    rows.filter((row) => Number.isFinite(row.fact)),
    "kpi",
  );
  const snapshots = buildKpiSnapshots(rows);
  const plannedRows = rows.filter((row) => Number.isFinite(row.plan));
  const actualRows = rows.filter((row) => Number.isFinite(row.fact));

  renderSummary({ rows, snapshots, plannedRows, actualRows });
  renderKpiDoughnut(latestActualByKpi);
  renderPerspectiveStacked(rows);
  renderPlanFactBar(snapshots);
  renderYearTrend(rows);
  renderBranchRadar(rows);
  renderDeltaHeatmap(snapshots);
  renderInitiatives(snapshots);
}

function renderSummary({ rows, snapshots, plannedRows, actualRows }) {
  const totalPlan = sum(plannedRows.map((row) => row.plan));
  const totalFact = sum(actualRows.map((row) => row.fact));
  const completionValues = snapshots
    .map((row) => completion(row))
    .filter((value) => Number.isFinite(value));
  const avgCompletion = average(completionValues);
  const risks = snapshots.filter((row) => Number.isFinite(row.delta) && row.delta < 0).length;

  summaryCards.innerHTML = [
    metric("План", formatCompact(totalPlan), "Сумма целевых значений по всем периодам"),
    metric("Факт", formatCompact(totalFact), "Сумма доступных фактических значений"),
    metric("KPI", unique(rows.map((row) => row.kpi)).length, "Показателей в BSC-модели"),
    metric("Выполнение", `${formatPercent(avgCompletion, 0)}`, `${risks} KPI с отрицательным отклонением`),
  ].join("");
}

function renderKpiDoughnut(rows) {
  const sorted = [...rows].sort((a, b) => Math.abs(b.fact) - Math.abs(a.fact)).slice(0, 8);
  createChart("kpiDoughnut", {
    type: "doughnut",
    data: {
      labels: sorted.map((row) => row.kpi),
      datasets: [
        {
          data: sorted.map((row) => Math.abs(row.fact)),
          backgroundColor: palette,
          borderColor: "#ffffff",
          borderWidth: 4,
          hoverOffset: 10,
        },
      ],
    },
    options: {
      cutout: "62%",
      plugins: {
        legend: { position: "right" },
        tooltip: tooltipWithRows(sorted, "fact"),
      },
    },
  });
}

function renderPerspectiveStacked(rows) {
  const branches = unique(rows.map((row) => row.branch));
  const perspectives = unique(rows.map((row) => row.perspective));

  createChart("perspectiveStacked", {
    type: "bar",
    data: {
      labels: branches,
      datasets: perspectives.map((perspective, index) => ({
        label: perspective,
        data: branches.map(
          (branch) => unique(rows.filter((row) => row.branch === branch && row.perspective === perspective).map((row) => row.kpi)).length,
        ),
        backgroundColor: palette[index % palette.length],
        borderRadius: 12,
      })),
    },
    options: {
      indexAxis: "y",
      responsive: true,
      scales: {
        x: { stacked: true, grid: { color: "rgba(125, 145, 179, 0.18)" }, ticks: { precision: 0 } },
        y: { stacked: true, grid: { display: false } },
      },
    },
  });
}

function renderPlanFactBar(rows) {
  const sorted = [...rows].sort((a, b) => Math.abs(b.plan || 0) - Math.abs(a.plan || 0));

  createChart("planFactBar", {
    type: "bar",
    data: {
      labels: sorted.map((row) => row.kpi),
      datasets: [
        {
          label: "План",
          data: sorted.map((row) => row.plan || 0),
          backgroundColor: "rgba(55, 125, 255, 0.82)",
          borderRadius: 12,
        },
        {
          label: "Факт",
          data: sorted.map((row) => row.fact || 0),
          backgroundColor: "rgba(49, 196, 141, 0.82)",
          borderRadius: 12,
        },
      ],
    },
    options: {
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: "rgba(125, 145, 179, 0.18)" }, ticks: { callback: formatAxis } },
      },
      plugins: {
        tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${formatNumber(context.parsed.y)}` } },
      },
    },
  });
}

function renderYearTrend(rows) {
  const years = unique(rows.map((row) => row.date.getFullYear())).sort();
  const perspectives = unique(rows.map((row) => row.perspective));

  createChart("yearTrend", {
    type: "line",
    data: {
      labels: years,
      datasets: perspectives.map((perspective, index) => ({
        label: perspective,
        data: years.map((year) => {
          const values = rows
            .filter((row) => row.perspective === perspective && row.date.getFullYear() === year)
            .map((row) => completion(row))
            .filter((value) => Number.isFinite(value));
          return average(values) * 100;
        }),
        borderColor: palette[index % palette.length],
        backgroundColor: palette[index % palette.length],
        tension: 0.38,
        pointRadius: 4,
      })),
    },
    options: {
      scales: {
        y: {
          grid: { color: "rgba(125, 145, 179, 0.18)" },
          ticks: { callback: (value) => `${value}%` },
        },
        x: { grid: { display: false } },
      },
      plugins: {
        tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${formatNumber(context.parsed.y)}%` } },
      },
    },
  });
}

function renderBranchRadar(rows) {
  const branches = unique(rows.map((row) => row.branch));
  const planByBranch = branches.map((branch) => sum(rows.filter((row) => row.branch === branch).map((row) => row.plan)));
  const factByBranch = branches.map((branch) => sum(rows.filter((row) => row.branch === branch).map((row) => row.fact)));

  createChart("branchRadar", {
    type: "radar",
    data: {
      labels: branches,
      datasets: [
        {
          label: "План",
          data: planByBranch,
          borderColor: "#377dff",
          backgroundColor: "rgba(55, 125, 255, 0.18)",
          pointBackgroundColor: "#377dff",
        },
        {
          label: "Факт",
          data: factByBranch,
          borderColor: "#ff9f43",
          backgroundColor: "rgba(255, 159, 67, 0.16)",
          pointBackgroundColor: "#ff9f43",
        },
      ],
    },
    options: {
      scales: {
        r: {
          angleLines: { color: "rgba(125, 145, 179, 0.2)" },
          grid: { color: "rgba(125, 145, 179, 0.2)" },
          pointLabels: { color: "#0d1728", font: { weight: 700 } },
          ticks: { display: false },
        },
      },
    },
  });
}

function renderDeltaHeatmap(rows) {
  const sorted = [...rows]
    .filter((row) => Number.isFinite(row.delta))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10);
  const maxDelta = Math.max(...sorted.map((row) => Math.abs(row.delta)), 1);

  deltaHeatmap.innerHTML = sorted
    .map((row) => {
      const isGood = row.delta >= 0;
      const width = Math.max(18, (Math.abs(row.delta) / maxDelta) * 100);
      return `
        <div class="heatmap__row" title="${escapeHtml(row.initiative)}">
          <div class="heatmap__name">${escapeHtml(row.kpi)}</div>
          <div class="heatmap__bar">
            <div class="heatmap__fill ${isGood ? "is-good" : "is-risk"}" style="width: ${width}%">
              ${formatSigned(row.delta)}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderInitiatives(rows) {
  const sorted = [...rows].sort((a, b) => Math.abs(b.fact || 0) - Math.abs(a.fact || 0));

  initiativeRows.innerHTML = sorted
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.initiative)}</td>
        <td>${escapeHtml(row.kpi)}</td>
        <td>${escapeHtml(row.perspective)}</td>
        <td>${formatNumber(row.plan)}</td>
        <td>${formatNumber(row.fact)}</td>
        <td class="${row.delta >= 0 ? "delta-positive" : "delta-negative"}">${formatSigned(row.delta)}</td>
      </tr>
    `)
    .join("");
}

function createChart(id, config) {
  const canvas = document.querySelector(`#${id}`);
  const options = config.options ?? {};
  const chart = new Chart(canvas, {
    ...config,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      ...options,
      plugins: {
        legend: { position: "top" },
        ...options.plugins,
      },
    },
  });
  chartInstances.set(id, chart);
}

function clearDashboard() {
  clearCharts();
  summaryCards.innerHTML = "";
  initiativeRows.innerHTML = "";
  deltaHeatmap.innerHTML = "";
  dashboard.classList.add("is-empty");
}

function clearCharts() {
  chartInstances.forEach((chart) => chart.destroy());
  chartInstances.clear();
}

function latestRowsBy(rows, key) {
  return Object.values(
    rows.reduce((acc, row) => {
      const current = acc[row[key]];
      if (!current || row.date > current.date) acc[row[key]] = row;
      return acc;
    }, {}),
  );
}

function buildKpiSnapshots(rows) {
  const kpis = unique(rows.map((row) => row.kpi));

  return kpis.map((kpi) => {
    const kpiRows = rows.filter((row) => row.kpi === kpi);
    const latest = latestRowsBy(kpiRows, "kpi")[0];
    const latestPlan = latestRowsBy(
      kpiRows.filter((row) => Number.isFinite(row.plan)),
      "kpi",
    )[0];
    const latestFact = latestRowsBy(
      kpiRows.filter((row) => Number.isFinite(row.fact)),
      "kpi",
    )[0];
    const latestDelta = latestRowsBy(
      kpiRows.filter((row) => Number.isFinite(row.delta)),
      "kpi",
    )[0];

    return {
      ...latest,
      plan: latestPlan?.plan ?? null,
      fact: latestFact?.fact ?? null,
      delta: latestDelta?.delta ?? null,
      factDate: latestFact?.date ?? null,
      planDate: latestPlan?.date ?? null,
    };
  });
}

function clean(value) {
  return String(value ?? "").trim();
}

function parseDate(value) {
  const [day, month, year] = clean(value).split(".");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function parseNumber(value) {
  const cleaned = clean(value)
    .replace(/\u00a0/g, "")
    .replace(/\s/g, "")
    .replace(",", ".");

  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

function completion(row) {
  if (!Number.isFinite(row.plan) || !Number.isFinite(row.fact) || row.plan === 0) return null;

  const lowerIsBetter = ["dio", "время подготовки", "reporting speed"].some((term) =>
    row.kpi.toLowerCase().includes(term),
  );
  return lowerIsBetter ? row.plan / row.fact : row.fact / row.plan;
}

function metric(label, value, hint) {
  return `
    <article class="metric">
      <p class="metric__label">${label}</p>
      <p class="metric__value">${value}</p>
      <p class="metric__hint">${hint}</p>
    </article>
  `;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (!valid.length) return 0;
  return sum(valid) / valid.length;
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("is-error", isError);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "н/д";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: value < 10 ? 2 : 0 }).format(value);
}

function formatCompact(value) {
  if (!Number.isFinite(value)) return "н/д";
  return new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return "н/д";
  return new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatAxis(value) {
  return new Intl.NumberFormat("ru-RU", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatSigned(value) {
  if (!Number.isFinite(value)) return "н/д";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}`;
}

function tooltipWithRows(rows, field) {
  return {
    callbacks: {
      label: (context) => {
        const row = rows[context.dataIndex];
        return `${row.kpi}: ${formatNumber(row[field])}`;
      },
    },
  };
}

function escapeHtml(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
