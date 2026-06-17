import fs from "node:fs";
import path from "node:path";

interface TelemetryStepTiming {
  readonly name?: string;
  readonly label: string;
  readonly durationMs?: number;
}

interface TelemetryProcessTiming {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly startedAt: string;
  readonly durationMs?: number;
  readonly status: string;
}

interface TelemetryCommandRecord {
  readonly schemaVersion: 1;
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly startedAt: string;
  readonly durationMs?: number;
  readonly status: string;
  readonly steps?: ReadonlyArray<TelemetryStepTiming>;
  readonly processes?: ReadonlyArray<TelemetryProcessTiming>;
}

interface StepSummaryInput extends TelemetryStepTiming {
  readonly command: string;
}

interface DurationSummary {
  readonly label: string;
  readonly count: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

interface TimelinePoint {
  readonly label: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly status: string;
  readonly title: string;
}

interface SyncStepPoint {
  readonly label: string;
  readonly runNumber: number;
  readonly startedAt: string;
  readonly durationMs: number;
}

interface ChartDataset {
  readonly label: string;
  readonly data: ReadonlyArray<number | null>;
  readonly borderColor: string;
  readonly backgroundColor: string;
  readonly pointBackgroundColor?: ReadonlyArray<string>;
  readonly tension?: number;
  readonly spanGaps?: boolean;
}

interface ChartReportData {
  readonly commandTimeline: {
    readonly labels: ReadonlyArray<string>;
    readonly datasets: ReadonlyArray<ChartDataset>;
  };
  readonly commandTrends: ReadonlyArray<{
    readonly command: string;
    readonly runs: number;
    readonly lastMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly labels: ReadonlyArray<string>;
    readonly dataset: ChartDataset;
  }>;
  readonly syncSteps: {
    readonly labels: ReadonlyArray<string>;
    readonly datasets: ReadonlyArray<ChartDataset>;
  };
}

const telemetryDirectory = path.join(process.cwd(), ".jjacks", "telemetry");
const inputPath = path.join(telemetryDirectory, "commands.jsonl");
const outputPath = path.join(telemetryDirectory, "report.html");

const isTelemetryCommandRecord = (value: unknown): value is TelemetryCommandRecord =>
  typeof value === "object" &&
  value !== null &&
  "schemaVersion" in value &&
  value.schemaVersion === 1 &&
  "command" in value &&
  typeof value.command === "string" &&
  "steps" in value &&
  Array.isArray(value.steps) &&
  "processes" in value &&
  Array.isArray(value.processes);

const readRecords = (): ReadonlyArray<TelemetryCommandRecord> => {
  if (!fs.existsSync(inputPath)) {
    return [];
  }

  return fs
    .readFileSync(inputPath, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const value: unknown = JSON.parse(line);
        return isTelemetryCommandRecord(value) ? [value] : [];
      } catch {
        return [];
      }
    });
};

const escapeHtml = (value: unknown): string =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const formatMs = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

const percentile = (values: ReadonlyArray<number>, point: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((point / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
};

const groupBy = <A>(
  values: ReadonlyArray<A>,
  key: (value: A) => string,
): ReadonlyMap<string, ReadonlyArray<A>> =>
  values.reduce<Map<string, Array<A>>>((groups, value) => {
    const groupKey = key(value);
    const group = groups.get(groupKey) ?? [];
    group.push(value);
    groups.set(groupKey, group);
    return groups;
  }, new Map());

const summarizeDurations = <A extends { readonly durationMs?: number }>(
  items: ReadonlyArray<A>,
  labelFor: (item: A) => string,
): ReadonlyArray<DurationSummary> =>
  [...groupBy(items, labelFor).entries()]
    .map(([label, group]) => {
      const durations = group.map((item) => item.durationMs ?? 0);
      return {
        label,
        count: group.length,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        max: Math.max(0, ...durations),
      };
    })
    .sort((left, right) => right.p95 - left.p95);

const commandColors = [
  "#2f80ed",
  "#27ae60",
  "#f2994a",
  "#9b51e0",
  "#eb5757",
  "#00a8a8",
  "#d66ba0",
  "#8f9b2f",
] as const;

const colorForLabel = (label: string): string => {
  const hash = [...label].reduce((value, character) => value + character.charCodeAt(0), 0);
  return commandColors[hash % commandColors.length] ?? commandColors[0];
};

const commandTimelinePoints = (
  records: ReadonlyArray<TelemetryCommandRecord>,
): ReadonlyArray<TimelinePoint> =>
  records.map((record) => {
    const args = record.args ?? [];
    return {
      label: record.command,
      startedAt: record.startedAt,
      durationMs: record.durationMs ?? 0,
      status: record.status,
      title: `${args.length > 0 ? args.join(" ") : record.command} ${formatMs(
        record.durationMs ?? 0,
      )} ${record.status} ${record.startedAt}`,
    };
  });

const buildChartReportData = (records: ReadonlyArray<TelemetryCommandRecord>): ChartReportData => {
  const commandPoints = commandTimelinePoints(records);
  const commandLabels = commandPoints.map((point) => `${point.startedAt} ${point.label}`);
  const groupedCommandPoints = [...groupBy(commandPoints, (point) => point.label).entries()];
  const commandTimelineDatasets: ReadonlyArray<ChartDataset> = groupedCommandPoints.map(
    ([command]) => {
      const color = colorForLabel(command);
      return {
        label: command,
        data: commandPoints.map((point) => (point.label === command ? point.durationMs : null)),
        borderColor: color,
        backgroundColor: color,
        pointBackgroundColor: commandPoints.map((point) =>
          point.label === command && point.status !== "success" ? "#bd3f32" : color,
        ),
        tension: 0.25,
        spanGaps: true,
      };
    },
  );
  const commandTrendData = groupedCommandPoints
    .map(([command, commandPoints]) => ({
      command,
      runs: commandPoints.length,
      lastMs: commandPoints[commandPoints.length - 1]?.durationMs ?? 0,
      p50Ms: percentile(
        commandPoints.map((point) => point.durationMs),
        50,
      ),
      p95Ms: percentile(
        commandPoints.map((point) => point.durationMs),
        95,
      ),
      labels: commandPoints.map((point) => point.startedAt),
      dataset: {
        label: command,
        data: commandPoints.map((point) => point.durationMs),
        borderColor: colorForLabel(command),
        backgroundColor: colorForLabel(command),
        pointBackgroundColor: commandPoints.map((point) =>
          point.status === "success" ? colorForLabel(command) : "#bd3f32",
        ),
        tension: 0.25,
        spanGaps: true,
      },
    }))
    .sort((left, right) => right.runs - left.runs || right.p95Ms - left.p95Ms);
  const syncRuns = records.filter(
    (record) => record.command === "sync" && (record.steps ?? []).length > 0,
  );
  const syncStepPoints: ReadonlyArray<SyncStepPoint> = syncRuns.flatMap((record, index) =>
    (record.steps ?? []).map((step) => ({
      label: step.label,
      runNumber: index + 1,
      startedAt: record.startedAt,
      durationMs: step.durationMs ?? 0,
    })),
  );
  const syncLabels = syncRuns.map((_record, index) => `sync #${index + 1}`);
  const syncStepDatasets = [...groupBy(syncStepPoints, (point) => point.label).entries()].map(
    ([label, stepPoints]) => {
      const color = colorForLabel(label);
      return {
        label,
        data: syncRuns.map((_record, index) => {
          const runNumber = index + 1;
          return stepPoints.find((point) => point.runNumber === runNumber)?.durationMs ?? null;
        }),
        borderColor: color,
        backgroundColor: color,
        tension: 0.25,
        spanGaps: true,
      };
    },
  );

  return {
    commandTimeline: {
      labels: commandLabels,
      datasets: commandTimelineDatasets,
    },
    commandTrends: commandTrendData,
    syncSteps: {
      labels: syncLabels,
      datasets: syncStepDatasets,
    },
  };
};

const chartCard = (id: string, emptyText: string): string =>
  `<div class="chart-card" data-empty-text="${escapeHtml(emptyText)}"><canvas id="${escapeHtml(
    id,
  )}"></canvas></div>`;

const jsonForScript = (value: unknown): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");

const summaryBars = (rows: ReadonlyArray<DurationSummary>): string => {
  const max = Math.max(1, ...rows.map((row) => row.p95));
  return `<div class="summary-bars">${rows
    .slice(0, 12)
    .map((row) => {
      const width = Math.max(2, (row.p95 / max) * 100);
      return `<div class="summary-row">
        <div class="summary-label">${escapeHtml(row.label)}</div>
        <div class="summary-track"><div class="summary-fill" style="width:${width}%"></div></div>
        <div class="summary-value">${formatMs(row.p95)}</div>
      </div>`;
    })
    .join("")}</div>`;
};

const table = (
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
) => `<table>
  <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
  <tbody>${rows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody>
</table>`;

const renderReport = (records: ReadonlyArray<TelemetryCommandRecord>): string => {
  const chronologicalRecords = [...records].sort((left, right) =>
    String(left.startedAt).localeCompare(String(right.startedAt)),
  );
  const steps: ReadonlyArray<StepSummaryInput> = chronologicalRecords.flatMap((record) =>
    (record.steps ?? []).map((step) => ({
      ...step,
      command: record.command,
    })),
  );
  const processes: ReadonlyArray<TelemetryProcessTiming> = chronologicalRecords.flatMap(
    (record) => record.processes ?? [],
  );
  const commandSummary = summarizeDurations(chronologicalRecords, (record) => record.command);
  const stepSummary = summarizeDurations(steps, (step) => `${step.command}: ${step.label}`);
  const slowestProcesses = [...processes]
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
    .slice(0, 25);
  const recentRuns = [...chronologicalRecords]
    .sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)))
    .slice(0, 25);
  const firstRun = chronologicalRecords[0]?.startedAt ?? "";
  const lastRun = chronologicalRecords[chronologicalRecords.length - 1]?.startedAt ?? "";
  const generatedAt = new Date().toISOString();
  const chartData = buildChartReportData(chronologicalRecords);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>jjacks telemetry</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f7f7f4;
      color: #242424;
    }
    body {
      margin: 0;
      padding: 32px;
    }
    main {
      max-width: 1180px;
      margin: 0 auto;
    }
    h1, h2 {
      margin: 0;
      letter-spacing: 0;
    }
    h1 {
      font-size: 32px;
      line-height: 1.1;
    }
    h2 {
      font-size: 18px;
      margin-top: 34px;
      margin-bottom: 14px;
    }
    .meta {
      margin-top: 8px;
      color: #666;
      font-size: 14px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      margin-top: 22px;
    }
    .stat {
      border: 1px solid #d9d9d0;
      border-radius: 8px;
      padding: 14px;
      background: #fff;
    }
    .stat strong {
      display: block;
      font-size: 26px;
    }
    .stat span {
      color: #666;
      font-size: 13px;
    }
    .chart-card,
    .summary-bars {
      display: grid;
      gap: 10px;
      border: 1px solid #d9d9d0;
      border-radius: 8px;
      padding: 14px;
      background: #fff;
    }
    .chart-card {
      display: block;
      overflow-x: auto;
      height: 360px;
    }
    .chart-card canvas {
      display: block;
      width: 100%;
      height: 100%;
    }
    .empty-chart {
      border: 1px solid #d9d9d0;
      border-radius: 8px;
      padding: 18px;
      background: #fff;
      color: #666;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-top: 12px;
      font-size: 13px;
      color: #666;
    }
    .legend span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .legend i {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      display: inline-block;
    }
    .trend-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 12px;
    }
    .trend-card {
      border: 1px solid #d9d9d0;
      border-radius: 8px;
      padding: 14px;
      background: #fff;
      display: grid;
      gap: 10px;
    }
    .trend-card strong {
      display: block;
      font-size: 16px;
    }
    .trend-card span {
      color: #666;
      font-size: 13px;
    }
    .trend-chart {
      position: relative;
      width: 100%;
      height: 86px;
      max-height: 86px;
      background: #f3f3ee;
      border-radius: 6px;
      overflow: hidden;
    }
    .trend-chart canvas {
      position: absolute;
      inset: 0;
      width: 100% !important;
      height: 86px !important;
      max-height: 86px !important;
    }
    .trend-metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
    }
    .summary-row {
      display: grid;
      grid-template-columns: minmax(160px, 260px) 1fr 70px;
      gap: 12px;
      align-items: center;
      font-size: 13px;
    }
    .summary-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .summary-track {
      height: 12px;
      background: #ecece5;
      border-radius: 999px;
      overflow: hidden;
    }
    .summary-fill {
      height: 100%;
      background: #4279b3;
      border-radius: 999px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #d9d9d0;
      background: #fff;
      border-radius: 8px;
      overflow: hidden;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 9px 10px;
      border-bottom: 1px solid #e5e5de;
      vertical-align: top;
    }
    th {
      color: #555;
      background: #eeeeea;
      font-weight: 650;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    @media (max-width: 720px) {
      body {
        padding: 18px;
      }
      .summary-row {
        grid-template-columns: 1fr;
        gap: 6px;
      }
      table {
        display: block;
        overflow-x: auto;
      }
    }
    @media (prefers-color-scheme: dark) {
      :root {
        background: #181917;
        color: #ededeb;
      }
      .meta, .legend, .trend-card span, .stat span, th {
        color: #adada8;
      }
      .stat, .chart-card, .empty-chart, .trend-card, .summary-bars, table {
        background: #22231f;
        border-color: #3a3b34;
      }
      .trend-chart {
        background: #2d2e28;
      }
      th {
        background: #2d2e28;
      }
      th, td {
        border-bottom-color: #35362f;
      }
      .summary-track {
        background: #35362f;
      }
    }
  </style>
</head>
<body>
  <main>
    <h1>jjacks telemetry</h1>
    <div class="meta">${escapeHtml(chronologicalRecords.length)} command runs from ${escapeHtml(
      inputPath,
    )}. Generated ${escapeHtml(generatedAt)}.</div>

    <section class="stats">
      <div class="stat"><strong>${chronologicalRecords.length}</strong><span>command runs</span></div>
      <div class="stat"><strong>${formatMs(
        percentile(
          chronologicalRecords.map((record) => record.durationMs ?? 0),
          50,
        ),
      )}</strong><span>command p50</span></div>
      <div class="stat"><strong>${formatMs(
        percentile(
          chronologicalRecords.map((record) => record.durationMs ?? 0),
          95,
        ),
      )}</strong><span>command p95</span></div>
      <div class="stat"><strong>${processes.length}</strong><span>subprocess calls</span></div>
      <div class="stat"><strong>${escapeHtml(firstRun === "" ? "n/a" : firstRun.slice(0, 10))}</strong><span>first run</span></div>
      <div class="stat"><strong>${escapeHtml(lastRun === "" ? "n/a" : lastRun.slice(0, 10))}</strong><span>latest run</span></div>
    </section>

    <h2>Command Timeline</h2>
    ${chartCard("command-timeline", "No telemetry data found yet.")}

    <h2>Command Trends</h2>
    ${
      chartData.commandTrends.length === 0
        ? "<p>No command data found.</p>"
        : `<div class="trend-grid">${chartData.commandTrends
            .map(
              (trend, index) => `<div class="trend-card">
        <div>
          <strong>${escapeHtml(trend.command)}</strong>
          <span>${trend.runs} run${trend.runs === 1 ? "" : "s"}</span>
        </div>
        <div class="trend-chart"><canvas id="trend-${index}"></canvas></div>
        <div class="trend-metrics">
          <span>last ${formatMs(trend.lastMs)}</span>
          <span>p50 ${formatMs(trend.p50Ms)}</span>
          <span>p95 ${formatMs(trend.p95Ms)}</span>
        </div>
      </div>`,
            )
            .join("")}</div>`
    }

    <h2>Sync Step Timeline</h2>
    ${chartCard(
      "sync-step-timeline",
      "No sync step data found yet. Run jjacks sync --execute to collect step timings.",
    )}

    <h2>Command P95</h2>
    ${commandSummary.length === 0 ? "<p>No command data found.</p>" : summaryBars(commandSummary)}

    <h2>Step P95</h2>
    ${stepSummary.length === 0 ? "<p>No step data found.</p>" : summaryBars(stepSummary)}

    <h2>Recent Commands</h2>
    ${table(
      ["Started", "Command", "Status", "Duration", "Slowest step"],
      recentRuns.map((record) => {
        const slowestStep = [...(record.steps ?? [])].sort(
          (left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0),
        )[0];
        const args = record.args ?? [];
        return [
          record.startedAt,
          args.length > 0 ? args.join(" ") : record.command,
          record.status,
          formatMs(record.durationMs ?? 0),
          slowestStep === undefined
            ? ""
            : `${slowestStep.label} (${formatMs(slowestStep.durationMs ?? 0)})`,
        ];
      }),
    )}

    <h2>Slowest Subprocesses</h2>
    ${table(
      ["Command", "Status", "Duration", "Started"],
      slowestProcesses.map((processRecord) => [
        [processRecord.command, ...(processRecord.args ?? [])].join(" "),
        processRecord.status,
        formatMs(processRecord.durationMs ?? 0),
        processRecord.startedAt,
      ]),
    )}
  </main>
  <script type="application/json" id="telemetry-chart-data">${jsonForScript(chartData)}</script>
  <script type="module">
    import Chart from "https://esm.sh/chart.js@4.4.7/auto";

    const chartData = JSON.parse(document.getElementById("telemetry-chart-data").textContent);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const textColor = prefersDark ? "#adada8" : "#666";
    const gridColor = prefersDark ? "#35362f" : "#e3e3dc";
    const formatMs = (ms) => ms < 1000 ? Math.round(ms) + "ms" : (ms / 1000).toFixed(1) + "s";
    const showEmpty = (id) => {
      const canvas = document.getElementById(id);
      const card = canvas?.closest(".chart-card");
      if (card) {
        card.innerHTML = '<div class="empty-chart">' + card.dataset.emptyText + '</div>';
      }
    };
    const normalizeDatasets = (datasets, overrides = {}) =>
      datasets.map((dataset) => ({
        ...dataset,
        ...overrides,
        borderWidth: overrides.borderWidth ?? 2.5,
        pointRadius: overrides.pointRadius ?? 3,
        pointHoverRadius: 5,
        fill: false,
      }));
    const baseOptions = (options = {}) => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: {
          display: options.legend !== false,
          labels: {
            color: textColor,
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
          },
        },
        tooltip: {
          callbacks: {
            label: (context) => context.dataset.label + ": " + formatMs(context.parsed.y),
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: textColor,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: options.maxXTicks ?? 8,
          },
          grid: { color: gridColor },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: textColor,
            callback: (value) => formatMs(Number(value)),
          },
          grid: { color: gridColor },
        },
      },
    });
    const renderLineChart = (id, labels, datasets, options = {}) => {
      if (labels.length === 0 || datasets.length === 0) {
        showEmpty(id);
        return;
      }

      new Chart(document.getElementById(id), {
        type: "line",
        data: {
          labels,
          datasets: normalizeDatasets(datasets, options.dataset ?? {}),
        },
        options: baseOptions(options),
      });
    };

    renderLineChart(
      "command-timeline",
      chartData.commandTimeline.labels,
      chartData.commandTimeline.datasets,
    );
    renderLineChart(
      "sync-step-timeline",
      chartData.syncSteps.labels,
      chartData.syncSteps.datasets,
      { maxXTicks: 10 },
    );
    chartData.commandTrends.forEach((trend, index) => {
      renderLineChart("trend-" + index, trend.labels, [trend.dataset], {
        legend: false,
        maxXTicks: 3,
        dataset: { borderWidth: 2, pointRadius: 0 },
      });
    });
  </script>
</body>
</html>`;
};

const records = readRecords();
fs.mkdirSync(telemetryDirectory, { recursive: true });
fs.writeFileSync(outputPath, renderReport(records), "utf8");
console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
