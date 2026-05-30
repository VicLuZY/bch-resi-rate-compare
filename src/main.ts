import "./styles.css";
import { parseConsumptionFiles, type TextFileInput } from "./domain/csv";
import { comparisonSummaryCsv, rankedTotals, validationReportCsv } from "./domain/export";
import { calculateComparisons, validateRateConfig } from "./domain/rates";
import { analyzeUploads, intervalsForPeriod } from "./domain/validation";
import type {
  AnalysisPeriod,
  AppliedPercentage,
  ComparisonBundle,
  FileSummary,
  FlatSchedule,
  MeterAnalysis,
  NormalizedInterval,
  ParsedConsumptionRecord,
  RateComparisonResult,
  RateConfig,
  RateSchedule,
  TieredSchedule,
  TimeOfDaySchedule,
  UploadAnalysis,
  ValidationIssue,
} from "./domain/types";

const DEFAULT_RATE_CONFIG_URL = `${import.meta.env.BASE_URL}rates/bchydro-residential-2026-04-01.json`;
const BC_HYDRO_DATA_EXPORT_URL =
  "https://app.bchydro.com/datadownload/web/download-centre.html";

interface AppState {
  rateConfig?: RateConfig;
  rateConfigUserModified: boolean;
  upload?: UploadAnalysis;
  parsedRecords?: ParsedConsumptionRecord[];
  fileSummaries?: FileSummary[];
  parseIssues?: ValidationIssue[];
  selectedMeterKey?: string;
  selectedPeriodIndex: Record<string, number>;
  loadError?: string;
}

const state: AppState = {
  rateConfigUserModified: false,
  selectedPeriodIndex: {},
};

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("Missing #app root.");
}
const appRoot = root;

void init();

async function init(): Promise<void> {
  try {
    const response = await fetch(DEFAULT_RATE_CONFIG_URL);
    const config = (await response.json()) as RateConfig;
    state.rateConfig = config;
  } catch (error) {
    state.loadError = error instanceof Error ? error.message : String(error);
  }
  render();
}

function render(): void {
  const selectedMeter = currentMeter();
  const selectedPeriod = selectedMeter ? currentPeriod(selectedMeter) : undefined;
  const configErrors = state.rateConfig ? validateRateConfig(state.rateConfig) : [];
  let comparison: ComparisonBundle | undefined;
  let calculationError: string | undefined;

  if (selectedMeter && selectedPeriod && state.rateConfig && canCalculate(selectedMeter)) {
    if (configErrors.length) {
      calculationError =
        "Rate assumptions need attention before a comparison can be calculated.";
    } else {
      try {
        comparison = calculateComparisons(selectedMeter, selectedPeriod, state.rateConfig);
      } catch (error) {
        calculationError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  appRoot.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">Local-first residential analysis</p>
        <h1>BC Hydro rate comparator</h1>
      </div>
      <div class="privacy-note">Files stay in this browser session.</div>
    </header>
    <main class="workspace ${state.upload ? "" : "landing-workspace"}">
      <aside class="sidebar">
        ${renderUploadPanel()}
        ${renderAssumptionsPanel()}
      </aside>
      <section class="main-panel">
        ${state.loadError ? renderNotice("error", state.loadError) : ""}
        ${renderValidationPanel(selectedMeter, selectedPeriod)}
        ${calculationError ? renderNotice("error", calculationError) : ""}
        ${comparison ? renderResultsPanel(comparison, selectedMeter!) : ""}
      </section>
    </main>
  `;

  bindEvents();
}

function renderUploadPanel(): string {
  const files = state.upload?.files ?? [];
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>Upload exports</h2>
        <p>Use one or more interval CSV exports. Segments for the same meter are merged.</p>
      </div>
      <label class="drop-zone" for="fileInput">
        <input id="fileInput" type="file" accept=".csv,text/csv" multiple />
        <span>Choose CSV files</span>
      </label>
      ${
        files.length
          ? `<div class="file-list">
              ${files
                .map(
                  (file, index) => `
                    <div class="file-row">
                      <strong>File ${index + 1}</strong>
                      <span>${file.acceptedRows.toLocaleString()} rows</span>
                      <span>${escapeHtml(file.firstLocal ?? "no start")} to ${escapeHtml(
                        file.lastLocal ?? "no end",
                      )}</span>
                    </div>
                  `,
                )
                .join("")}
            </div>`
          : `<p class="muted">No customer data is loaded.</p>`
      }
    </section>
  `;
}

function renderAssumptionsPanel(): string {
  const configErrors = state.rateConfig ? validateRateConfig(state.rateConfig) : [];
  const config = state.rateConfig;
  if (!config) {
    return `
      <section class="panel assumptions">
        <div class="panel-heading">
          <h2>Rate assumptions</h2>
          <p>No rate configuration loaded.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="panel assumptions">
      <div class="panel-heading">
        <h2>Rate assumptions</h2>
        <p>${escapeHtml(config.label)}</p>
      </div>
      <div class="status-line">
        <span class="status ${configErrors.length ? "bad" : "good"}">
          ${configErrors.length ? "Needs attention" : "Ready"}
        </span>
        <span>${state.rateConfigUserModified ? "User-modified" : "Tariff file"}</span>
      </div>
      ${renderRateGuide(config)}
      ${
        configErrors.length
          ? `<ul class="issue-list">${configErrors
              .map((error) => `<li>${escapeHtml(error)}</li>`)
              .join("")}</ul>`
          : ""
      }
      <div class="assumption-scroll">
        ${renderBaseScheduleEditor(config.schedules.RS1101)}
        ${renderBaseScheduleEditor(config.schedules.RS1151)}
        ${renderTimeOfDayEditor(config.schedules.RS2101)}
        ${renderPercentageEditor("Levies", config.levies ?? [], "levies")}
        ${renderPercentageEditor("Taxes", config.taxes ?? [], "taxes")}
      </div>
      <div class="button-row">
        <button id="resetRateConfig" type="button" class="secondary">Reload default</button>
      </div>
      ${renderSourceNotes()}
    </section>
  `;
}

function renderBaseScheduleEditor(schedule?: RateSchedule): string {
  if (!schedule || (schedule.type !== "tiered" && schedule.type !== "flat")) {
    return "";
  }

  if (schedule.type === "tiered") {
    return renderTieredEditor(schedule);
  }

  return renderFlatEditor(schedule);
}

function renderRateGuide(config: RateConfig): string {
  const tiered = config.schedules.RS1101;
  const flat = config.schedules.RS1151;
  const timeBands = config.schedules.RS2101;

  return `
    <div class="rate-guide">
      <h3>What these rates mean</h3>
      ${tiered?.type === "tiered" ? renderRateGuideItem("RS 1101 tiered", "A fixed daily basic charge plus two energy prices. Tier 1 covers the daily allowance; Tier 2 applies only to energy above that allowance.") : ""}
      ${flat?.type === "flat" ? renderRateGuideItem("RS 1151 flat", "A fixed daily basic charge plus one energy price for every kWh, so usage timing does not change the base energy price.") : ""}
      ${timeBands?.type === "timeOfDay" ? renderRateGuideItem("RS 2101 time bands", "An add-on to either base schedule. Overnight energy receives a per-kWh credit, regular windows stay at the base price, and peak hours add a per-kWh charge.") : ""}
    </div>
  `;
}

function renderRateGuideItem(label: string, description: string): string {
  return `
    <div>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(description)}</span>
    </div>
  `;
}

function renderTieredEditor(schedule: TieredSchedule): string {
  return `
    <div class="assumption-group">
      <h3>${escapeHtml(schedule.label)}</h3>
      <p class="rate-explainer">Fixed daily charge, then Tier 1 energy up to the allowance and Tier 2 energy above it.</p>
      ${numberControl("Basic charge per day", `schedules.${schedule.id}.basicChargePerDay`, schedule.basicChargePerDay, "$/day", 0.0001)}
      ${schedule.tiers
        .map((tier, index) => {
          const limit = tier.limitKwhPerDay;
          return `
            <div class="subgroup">
              <strong>${escapeHtml(tier.label)}</strong>
              ${
                limit === undefined
                  ? ""
                  : numberControl(
                      "Allowance per day",
                      `schedules.${schedule.id}.tiers.${index}.limitKwhPerDay`,
                      limit,
                      "kWh/day",
                      0.0001,
                    )
              }
              ${numberControl(
                "Energy rate",
                `schedules.${schedule.id}.tiers.${index}.ratePerKwh`,
                tier.ratePerKwh,
                "$/kWh",
                0.0001,
              )}
            </div>
          `;
        })
        .join("")}
      ${renderPercentageEditor("Riders", schedule.riders ?? [], `schedules.${schedule.id}.riders`)}
    </div>
  `;
}

function renderFlatEditor(schedule: FlatSchedule): string {
  return `
    <div class="assumption-group">
      <h3>${escapeHtml(schedule.label)}</h3>
      <p class="rate-explainer">Fixed daily charge plus one energy price for all consumption.</p>
      ${numberControl("Basic charge per day", `schedules.${schedule.id}.basicChargePerDay`, schedule.basicChargePerDay, "$/day", 0.0001)}
      ${numberControl("Energy rate", `schedules.${schedule.id}.energyRatePerKwh`, schedule.energyRatePerKwh, "$/kWh", 0.0001)}
      ${renderPercentageEditor("Riders", schedule.riders ?? [], `schedules.${schedule.id}.riders`)}
    </div>
  `;
}

function renderTimeOfDayEditor(schedule?: RateSchedule): string {
  if (!schedule || schedule.type !== "timeOfDay") {
    return "";
  }

  return `
    <div class="assumption-group">
      <h3>${escapeHtml(schedule.label)}</h3>
      <p class="rate-explainer">Adds credits or charges by clock window on top of the selected base schedule.</p>
      ${schedule.periods
        .map(
          (period, index) => `
            <div class="tod-editor-row">
              <strong>${escapeHtml(period.label)}</strong>
              ${timeControl("Start", `schedules.${schedule.id}.periods.${index}.startTime`, period.startTime)}
              ${timeControl("End", `schedules.${schedule.id}.periods.${index}.endTime`, period.endTime)}
              ${numberControl(
                "Adjustment",
                `schedules.${schedule.id}.periods.${index}.adjustmentPerKwh`,
                period.adjustmentPerKwh,
                "$/kWh",
                0.0001,
              )}
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderPercentageEditor(
  title: string,
  percentages: AppliedPercentage[],
  pathPrefix: string,
): string {
  if (!percentages.length) {
    return `
      <div class="subgroup quiet">
        <strong>${escapeHtml(title)}</strong>
        <span>No enabled assumptions.</span>
      </div>
    `;
  }

  return `
    <div class="subgroup">
      <strong>${escapeHtml(title)}</strong>
      ${percentages
        .map((percentage, index) => {
          const path = `${pathPrefix}.${index}`;
          return `
            <div class="rider-row">
              <label class="toggle-row">
                <input type="checkbox" data-rate-path="${escapeAttribute(path)}.enabled" data-kind="boolean" ${
                  percentage.enabled === false ? "" : "checked"
                } />
                <span>${escapeHtml(percentage.label)}</span>
              </label>
              ${numberControl("Rate", `${path}.rate`, percentage.rate, "%", 0.0001, true)}
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function numberControl(
  label: string,
  path: string,
  value: number,
  suffix: string,
  step: number,
  percent = false,
): string {
  return `
    <label class="field-row">
      <span>${escapeHtml(label)}</span>
      <span class="input-with-unit">
        <input type="number" data-rate-path="${escapeAttribute(path)}" data-kind="number" value="${escapeAttribute(
          String(percent ? value * 100 : value),
        )}" step="${step}" ${percent ? 'data-scale="percent"' : ""} />
        <small>${escapeHtml(suffix)}</small>
      </span>
    </label>
  `;
}

function timeControl(label: string, path: string, value: string): string {
  return `
    <label class="field-row compact-field">
      <span>${escapeHtml(label)}</span>
      <input type="time" data-rate-path="${escapeAttribute(path)}" data-kind="string" value="${escapeAttribute(value)}" />
    </label>
  `;
}

function renderSourceNotes(): string {
  if (!state.rateConfig?.sourceNotes?.length) {
    return "";
  }

  return `
    <details class="source-notes">
      <summary>Configuration source notes</summary>
      <ul>
        ${state.rateConfig.sourceNotes
          .map((note) => `<li>${linkify(escapeHtml(note))}</li>`)
          .join("")}
      </ul>
    </details>
  `;
}

function renderValidationPanel(
  selectedMeter?: MeterAnalysis,
  selectedPeriod?: AnalysisPeriod,
): string {
  if (!state.upload) {
    const range = recommendedExportRange();
    return `
      <section class="empty-state landing-state">
        <div class="landing-copy">
          <p class="eyebrow">Start here</p>
          <h2>Download a three-year hourly CSV from BC Hydro</h2>
          <p>Use BC Hydro's Data Export Centre to request consumption history, then upload the ready CSV files here. The app keeps the files in this browser session.</p>
          <a class="primary-link" href="${BC_HYDRO_DATA_EXPORT_URL}" target="_blank" rel="noreferrer">Open BC Hydro Data Export Centre</a>
        </div>
        <div class="download-guide" aria-label="BC Hydro data download instructions">
          <div class="range-callout">
            <span>Recommended date range</span>
            <strong>${escapeHtml(range.start)} to ${escapeHtml(range.end)}</strong>
            <p>Use three full years of hourly data so the comparison can check continuity, seasonality, and annual cost patterns.</p>
          </div>
          <ol>
            <li>
              <strong>Sign in and open Data Export Centre.</strong>
              <span>Open the BC Hydro Data Export Centre link, then sign in with the MyHydro account that owns the residential meter data.</span>
            </li>
            <li>
              <strong>Choose Consumption History.</strong>
              <span>Set export format to CSV, date range to ${escapeHtml(
                range.start,
              )} through ${escapeHtml(
                range.end,
              )}, and interval to Hourly. This app expects metered consumption rows, not billing summaries.</span>
            </li>
            <li>
              <strong>Select the account or accounts to include.</strong>
              <span>Choose the residential accounts you want to compare. The CSV can include meter number, account, address, and account holder metadata; do not type those details into this page.</span>
            </li>
            <li>
              <strong>Download the ready CSV.</strong>
              <span>After submitting the request, return to Data Export Requests or Download Exports in the same BC Hydro area. When the request status is Ready, download the CSV and upload it here.</span>
            </li>
          </ol>
          <p class="privacy-callout">Private names, account numbers, and service addresses are read from your uploaded CSV in the browser only; this published page does not include sample personal account data.</p>
        </div>
      </section>
    `;
  }

  const meters = state.upload.meters;
  return `
    <section class="panel wide">
      <div class="panel-heading split">
        <div>
          <h2>Validation</h2>
          <p>${meters.length} meter${meters.length === 1 ? "" : "s"} detected across ${
            state.upload.files.length
          } file${state.upload.files.length === 1 ? "" : "s"}.</p>
        </div>
        ${
          meters.length
            ? `<select id="meterSelect" aria-label="Select meter">
                ${meters
                  .map(
                    (meter) => `
                      <option value="${escapeAttribute(meter.meterKey)}" ${
                        meter.meterKey === selectedMeter?.meterKey ? "selected" : ""
                      }>${escapeHtml(meter.meterDisplay)}</option>
                    `,
                  )
                  .join("")}
              </select>`
            : ""
        }
      </div>
      ${renderGlobalIssues(state.upload.issues)}
      ${selectedMeter ? renderMeterValidation(selectedMeter, selectedPeriod) : ""}
    </section>
  `;
}

function recommendedExportRange(referenceDate = new Date()): { start: string; end: string } {
  const end = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  const start = new Date(end);
  start.setFullYear(start.getFullYear() - 3);

  return {
    start: formatExportDate(start),
    end: formatExportDate(end),
  };
}

function formatExportDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function renderGlobalIssues(issues: ValidationIssue[]): string {
  if (!issues.length) {
    return "";
  }

  return `
    <div class="issue-block">
      ${issues.map(renderIssue).join("")}
    </div>
  `;
}

function renderMeterValidation(
  meter: MeterAnalysis,
  selectedPeriod?: AnalysisPeriod,
): string {
  const errorCount = meter.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = meter.issues.filter((issue) => issue.severity === "warning").length;
  const periodOptions = meter.completePeriods;
  const periodIndex = selectedPeriod
    ? periodOptions.findIndex((period) => period.startEpochMs === selectedPeriod.startEpochMs)
    : -1;
  const estimatedCount = meter.intervals.filter((interval) => interval.estimated).length;
  const periodIntervals = selectedPeriod
    ? intervalsForPeriod(meter.intervals, selectedPeriod)
    : [];

  return `
    <div class="metric-strip">
      <div><span>${meter.intervals.length.toLocaleString()}</span><small>normalized intervals</small></div>
      <div><span>${meter.cadenceMinutes ? `${meter.cadenceMinutes} min` : "unknown"}</span><small>cadence</small></div>
      <div><span>${meter.completePeriods.length}</span><small>complete annual periods</small></div>
      <div><span>${errorCount}</span><small>blocking errors</small></div>
      <div><span>${warningCount}</span><small>warnings</small></div>
    </div>
    ${renderMeterMetadata(meter)}
    <div class="validation-grid">
      <div>
        <h3>Reconstructed meter</h3>
        <dl class="facts">
          <div><dt>Meter</dt><dd>${escapeHtml(joinValues(meter.meterNumbers))}</dd></div>
          <div><dt>Files</dt><dd>${meter.fileNames.length}</dd></div>
          <div><dt>Date range</dt><dd>${escapeHtml(meter.dateRange?.startLocal ?? "n/a")} to ${escapeHtml(
            meter.dateRange?.endLocal ?? "n/a",
          )}</dd></div>
          <div><dt>Estimated intervals</dt><dd>${estimatedCount.toLocaleString()}</dd></div>
        </dl>
      </div>
      <div>
        <h3>Analysis period</h3>
        ${
          periodOptions.length
            ? `<select id="periodSelect" aria-label="Select annual period">
                ${periodOptions
                  .map(
                    (period, index) => `
                      <option value="${index}" ${index === periodIndex ? "selected" : ""}>
                        ${escapeHtml(period.startLocal)} to ${escapeHtml(period.endLocal)}
                      </option>
                    `,
                  )
                  .join("")}
              </select>
              <dl class="facts">
                <div><dt>Consumption</dt><dd>${formatKwh(selectedPeriod?.totalKwh ?? 0)}</dd></div>
                <div><dt>Service days</dt><dd>${selectedPeriod?.serviceDays ?? 0}</dd></div>
                <div><dt>Rows in period</dt><dd>${periodIntervals.length.toLocaleString()}</dd></div>
              </dl>`
            : `<p class="blocked">No complete continuous local year is available for calculation.</p>`
        }
      </div>
    </div>
    ${
      meter.issues.length
        ? `<div class="issue-block">${meter.issues.map(renderIssue).join("")}</div>`
        : renderNotice("good", "No blocking validation issues were found for this meter.")
    }
    <div class="button-row">
      <button id="downloadValidation" type="button" class="secondary">Export validation CSV</button>
    </div>
  `;
}

function renderMeterMetadata(meter: MeterAnalysis): string {
  return `
    <div class="metadata-band">
      <div>
        <span>Account holder</span>
        <strong>${escapeHtml(joinValues(meter.customerNames))}</strong>
      </div>
      <div>
        <span>Account number</span>
        <strong>${escapeHtml(joinValues(meter.accountNumbers))}</strong>
      </div>
      <div>
        <span>Meter number</span>
        <strong>${escapeHtml(joinValues(meter.meterNumbers))}</strong>
      </div>
      <div>
        <span>Service address</span>
        <strong>${escapeHtml(joinValues([...meter.serviceAddresses, ...meter.cities]))}</strong>
      </div>
    </div>
  `;
}

function renderResultsPanel(bundle: ComparisonBundle, meter: MeterAnalysis): string {
  const periodIntervals = intervalsForPeriod(meter.intervals, bundle.period);
  return `
    <section class="panel wide results report-surface">
      <div class="panel-heading split">
        <div>
          <h2>Annual comparison</h2>
          <p>${escapeHtml(bundle.period.startLocal)} to ${escapeHtml(
            bundle.period.endLocal,
          )}; ${formatKwh(bundle.period.totalKwh)}.</p>
        </div>
        <div class="button-row compact">
          <button id="downloadComparison" type="button">Export summary CSV</button>
          <button id="printReport" type="button" class="secondary">Print report</button>
        </div>
      </div>
      ${renderInsightSummary(bundle)}
      ${renderCostComparisonDashboard(bundle)}
      ${renderUsageDashboard(periodIntervals, bundle)}
      <table class="results-table">
        <thead>
          <tr>
            <th>Option</th>
            <th>Total</th>
            <th>Difference from cheapest</th>
            <th>% above cheapest</th>
            <th>Annual kWh</th>
            <th>Tier allocation</th>
            <th>Time-band adjustments</th>
          </tr>
        </thead>
      <tbody>
          ${bundle.results
            .map((result) =>
              renderResultRow(
                result,
                Math.min(...bundle.results.map((item) => item.totalCost)),
              ),
            )
            .join("")}
        </tbody>
      </table>
      <div class="details-list">
        ${bundle.results.map((result) => renderResultDetails(result, meter)).join("")}
      </div>
    </section>
  `;
}

function renderResultRow(result: RateComparisonResult, cheapest: number): string {
  const difference = result.totalCost - cheapest;
  return `
    <tr>
      <td>${escapeHtml(result.label)}</td>
      <td>${formatCurrency(result.totalCost)}</td>
      <td>${formatCurrency(difference)}</td>
      <td>${formatPercent(cheapest ? difference / cheapest : 0)}</td>
      <td>${formatKwh(result.totalKwh)}</td>
      <td>${renderTierSummary(result)}</td>
      <td>${renderTodSummary(result)}</td>
    </tr>
  `;
}

function renderInsightSummary(bundle: ComparisonBundle): string {
  const cheapest = bundle.results[0];
  const mostExpensive = bundle.results.at(-1)!;
  const baseline = bundle.results.find((result) => result.optionId === "RS1101") ?? mostExpensive;
  const flat = bundle.results.find((result) => result.optionId === "RS1151");
  const tieredTod = bundle.results.find((result) => result.optionId === "RS1101_RS2101");
  const flatTod = bundle.results.find((result) => result.optionId === "RS1151_RS2101");
  const tiered = bundle.results.find((result) => result.optionId === "RS1101");
  const spread = mostExpensive.totalCost - cheapest.totalCost;
  const baselineSavings = baseline.totalCost - cheapest.totalCost;
  const flatVsTiered = flat && tiered ? flat.totalCost - tiered.totalCost : undefined;
  const todSavings = [
    tiered && tieredTod
      ? {
          label: "Tiered time-band effect",
          amount: tiered.totalCost - tieredTod.totalCost,
          basis: tiered.totalCost,
        }
      : undefined,
    flat && flatTod
      ? {
          label: "Flat time-band effect",
          amount: flat.totalCost - flatTod.totalCost,
          basis: flat.totalCost,
        }
      : undefined,
  ].filter((item): item is { label: string; amount: number; basis: number } => Boolean(item));

  return `
    <div class="insight-grid">
      <div class="insight-tile primary">
        <span>Best option</span>
        <strong>${escapeHtml(cheapest.label)}</strong>
        <p>${formatCurrency(baselineSavings)} lower than RS 1101 (${formatPercent(
          baseline.totalCost ? baselineSavings / baseline.totalCost : 0,
        )}).</p>
      </div>
      <div class="insight-tile">
        <span>Annual spread</span>
        <strong>${formatCurrency(spread)}</strong>
        <p>${formatPercent(mostExpensive.totalCost ? spread / mostExpensive.totalCost : 0)} separates the highest and lowest options.</p>
      </div>
      <div class="insight-tile">
        <span>Flat vs tiered</span>
        <strong>${flatVsTiered === undefined ? "n/a" : formatCurrency(Math.abs(flatVsTiered))}</strong>
        <p>${
          flatVsTiered === undefined
            ? "Flat and tiered schedules were not both available."
            : `${flatVsTiered < 0 ? "Flat is lower" : "Tiered is lower"} before clock-window adjustments.`
        }</p>
      </div>
      ${todSavings
        .map(
          (item) => `
            <div class="insight-tile">
              <span>${escapeHtml(item.label)}</span>
              <strong>${formatCurrency(Math.abs(item.amount))}</strong>
              <p>${item.amount >= 0 ? "Net savings" : "Net added cost"} after discount, neutral, and premium windows.</p>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderCostComparisonDashboard(bundle: ComparisonBundle): string {
  const ranking = rankedTotals(bundle.results);
  const maxTotal = Math.max(...bundle.results.map((result) => result.totalCost));
  return `
    <div class="visual-section">
      <div class="section-title">
        <h3>Rate options explained</h3>
        <span>Each option combines one base schedule with optional clock-window credits or charges.</span>
      </div>
      <div class="option-guide">
        ${bundle.results.map((result) => renderOptionGuideItem(result)).join("")}
      </div>
    </div>
    <div class="visual-section">
      <div class="section-title">
        <h3>Cost comparison</h3>
        <span>Bars show annual cost; stack colors show where each dollar goes.</span>
      </div>
      <div class="ranked-bars enhanced">
        ${ranking
          .map((row) => {
            const width = maxTotal ? (row.total / maxTotal) * 100 : 0;
            return `
              <div class="bar-row">
                <span>${escapeHtml(row.option)}</span>
                <div><b style="width:${width}%"></b></div>
                <strong>${formatCurrency(row.total)}</strong>
                <em>${formatPercent(maxTotal ? row.total / maxTotal : 0)} of highest</em>
              </div>
            `;
          })
          .join("")}
      </div>
      ${renderCostStackBars(bundle)}
    </div>
  `;
}

function renderOptionGuideItem(result: RateComparisonResult): string {
  const baseDescription = result.tierAllocation
    ? "Tiered base: daily basic charge, lower Tier 1 energy up to the allowance, then higher Tier 2 energy above it."
    : "Flat base: daily basic charge plus one energy price for every kWh.";
  const timeBandDescription = result.timeOfDayAllocation
    ? "Clock-window add-on: overnight use earns a credit, regular windows stay at base price, and peak hours add a charge."
    : "No clock-window add-on: every kWh keeps the base schedule price.";

  return `
    <div class="option-guide-item">
      <strong>${escapeHtml(result.label)}</strong>
      <span>${baseDescription}</span>
      <span>${timeBandDescription}</span>
      <em>${formatCurrency(result.totalCost)} for ${formatKwh(result.totalKwh)} in the selected year.</em>
    </div>
  `;
}

function renderCostStackBars(bundle: ComparisonBundle): string {
  return `
    <div class="stack-chart">
      ${bundle.results
        .map((result) => {
          const groups = componentGroups(result);
          const positiveTotal = groups
            .filter((group) => group.amount > 0)
            .reduce((total, group) => total + group.amount, 0);
          const credits = groups
            .filter((group) => group.amount < 0)
            .reduce((total, group) => total + group.amount, 0);
          return `
            <div class="stack-row">
              <div class="stack-label">
                <strong>${escapeHtml(result.label)}</strong>
                <span>${credits < 0 ? `${formatCurrency(Math.abs(credits))} credits` : "No credits"}</span>
              </div>
              <div class="stack-track">
                ${groups
                  .filter((group) => group.amount > 0)
                  .map((group) => {
                    const share = positiveTotal ? group.amount / positiveTotal : 0;
                    return `
                      <span
                        class="${escapeAttribute(group.className)}"
                        style="width:${share * 100}%"
                      >
                        <title>${escapeHtml(group.label)} ${formatPercent(share)}</title>
                        ${share >= 0.055 ? formatPercent(share) : ""}
                      </span>
                    `;
                  })
                  .join("")}
              </div>
            </div>
          `;
        })
        .join("")}
      <div class="legend">
        <span><b class="basic"></b>Base</span>
        <span><b class="energy"></b>Energy</span>
        <span><b class="tod"></b>Time-band charges</span>
        <span><b class="rider"></b>Riders/taxes</span>
      </div>
    </div>
  `;
}

function renderUsageDashboard(intervals: NormalizedInterval[], bundle: ComparisonBundle): string {
  return `
    <div class="visual-section usage-section">
      <div class="section-title">
        <h3>Usage over time</h3>
        <span>Discrete hourly bars and time bands show when the bill moves.</span>
      </div>
      <div class="chart-grid">
        <div class="chart-panel">
          <h4>Monthly kWh</h4>
          ${renderMonthlyChart(intervals)}
        </div>
        <div class="chart-panel">
          <h4>Average hourly load by rate band</h4>
          ${renderHourlyChart(intervals, bundle)}
        </div>
        <div class="chart-panel wide-chart">
          <h4>Day and hour intensity</h4>
          ${renderHeatmap(intervals)}
        </div>
        <div class="chart-panel tod-panel">
          <h4>Time-band adjustments</h4>
          ${renderTimeOfDayBands(bundle)}
        </div>
      </div>
    </div>
  `;
}

function componentGroups(result: RateComparisonResult): Array<{
  label: string;
  className: string;
  amount: number;
}> {
  const groups = [
    { label: "Base", className: "basic", amount: 0 },
    { label: "Energy", className: "energy", amount: 0 },
    { label: "Time-band charges", className: "tod", amount: 0 },
    { label: "Riders/taxes", className: "rider", amount: 0 },
    { label: "Credits", className: "credit", amount: 0 },
  ];

  for (const component of result.components) {
    const amount = component.amount;
    if (amount < 0) {
      groups[4].amount += amount;
    } else if (component.category === "basic") {
      groups[0].amount += amount;
    } else if (component.category === "baseEnergy" || component.category === "tierEnergy") {
      groups[1].amount += amount;
    } else if (component.category === "timeOfDayAdjustment") {
      groups[2].amount += amount;
    } else {
      groups[3].amount += amount;
    }
  }

  return groups.filter((group) => Math.abs(group.amount) > 0.000001);
}

interface TodBandSummary {
  adjustment: number;
  className: string;
  label: string;
  kwh: number;
  amount: number;
  intervalCount: number;
  periods: Array<{
    label: string;
    startTime: string;
    endTime: string;
  }>;
}

function timeOfDaySchedule(): TimeOfDaySchedule | undefined {
  return Object.values(state.rateConfig?.schedules ?? {}).find(
    (schedule): schedule is TimeOfDaySchedule => schedule.type === "timeOfDay",
  );
}

function timeOfDayResult(bundle: ComparisonBundle): RateComparisonResult | undefined {
  return bundle.results.find((item) => item.timeOfDayAllocation);
}

function todBandSummaries(bundle: ComparisonBundle): TodBandSummary[] {
  const result = timeOfDayResult(bundle);
  const schedule = timeOfDaySchedule();
  if (!result?.timeOfDayAllocation || !schedule) {
    return [];
  }

  const byAdjustment = new Map<number, TodBandSummary>();
  for (const allocation of result.timeOfDayAllocation) {
    const sourcePeriod = schedule.periods.find((period) => period.id === allocation.periodId);
    const key = roundAdjustment(allocation.adjustmentPerKwh);
    const existing =
      byAdjustment.get(key) ??
      ({
        adjustment: key,
        className: todClassForAdjustment(key),
        label: todBandLabel(key),
        kwh: 0,
        amount: 0,
        intervalCount: 0,
        periods: [],
      } satisfies TodBandSummary);

    existing.kwh += allocation.kwh;
    existing.amount += allocation.amount;
    existing.intervalCount += allocation.intervalCount;
    existing.periods.push({
      label: allocation.label,
      startTime: sourcePeriod?.startTime ?? "",
      endTime: sourcePeriod?.endTime ?? "",
    });
    byAdjustment.set(key, existing);
  }

  return [...byAdjustment.values()].sort((left, right) => left.adjustment - right.adjustment);
}

function roundAdjustment(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function todClassForAdjustment(adjustment: number): string {
  if (adjustment < 0) {
    return "discount";
  }

  if (adjustment > 0) {
    return "premium";
  }

  return "neutral";
}

function todBandLabel(adjustment: number): string {
  if (adjustment < 0) {
    return `Discount ${formatCentsPerKwh(adjustment)}`;
  }

  if (adjustment > 0) {
    return `Premium ${formatCentsPerKwh(adjustment)}`;
  }

  return `Base ${formatCentsPerKwh(adjustment)}`;
}

function formatCentsPerKwh(value: number): string {
  const cents = value * 100;
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(cents);
  return `${formatted}c/kWh`;
}

function findTodPeriodForHour(schedule: TimeOfDaySchedule, hour: number): TimeOfDaySchedule["periods"][number] {
  const minute = hour * 60;
  return (
    schedule.periods.find((period) => {
      const start = clockMinutes(period.startTime);
      const end = clockMinutes(period.endTime);
      if (start === end) {
        return true;
      }

      if (start < end) {
        return minute >= start && minute < end;
      }

      return minute >= start || minute < end;
    }) ?? schedule.periods[0]
  );
}

function clockMinutes(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

function renderMonthlyChart(intervals: NormalizedInterval[]): string {
  const monthly = [...groupByMonth(intervals).entries()].map(([month, kwh]) => ({
    month,
    kwh,
  }));
  const max = Math.max(...monthly.map((item) => item.kwh), 1);
  const width = 720;
  const height = 240;
  const left = 46;
  const bottom = 34;
  const chartWidth = width - left - 18;
  const chartHeight = height - 32 - bottom;
  const gap = 6;
  const barWidth = monthly.length ? Math.max(8, chartWidth / monthly.length - gap) : 0;

  return `
    <svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly consumption chart">
      <line x1="${left}" y1="${height - bottom}" x2="${width - 12}" y2="${height - bottom}" />
      ${monthly
        .map((item, index) => {
          const barHeight = (item.kwh / max) * chartHeight;
          const x = left + index * (barWidth + gap);
          const y = height - bottom - barHeight;
          return `
            <g>
              <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3">
                <title>${escapeHtml(monthLabel(item.month))}: ${formatKwh(item.kwh)}</title>
              </rect>
              <text x="${x + barWidth / 2}" y="${height - 10}" text-anchor="middle">${escapeHtml(
                shortMonthLabel(item.month),
              )}</text>
            </g>
          `;
        })
        .join("")}
      <text x="8" y="20">${formatKwh(max)}</text>
    </svg>
  `;
}

function renderHourlyChart(intervals: NormalizedInterval[], bundle: ComparisonBundle): string {
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    kwh: 0,
    count: 0,
  }));
  for (const interval of intervals) {
    const item = hourly[interval.localStart.hour];
    item.kwh += interval.consumptionKwh;
    item.count += 1;
  }
  const points = hourly.map((item) => ({
    hour: item.hour,
    value: item.count ? item.kwh / item.count : 0,
  }));
  const max = Math.max(...points.map((point) => point.value), 1);
  const width = 720;
  const height = 240;
  const left = 42;
  const bottom = 34;
  const chartWidth = width - left - 18;
  const chartHeight = height - 34 - bottom;
  const gap = 5;
  const barWidth = Math.max(10, chartWidth / 24 - gap);
  const schedule = timeOfDaySchedule();

  return `
    <svg class="chart-svg hourly-bars" viewBox="0 0 ${width} ${height}" role="img" aria-label="Average hourly load bar chart">
      <line x1="${left}" y1="${height - bottom}" x2="${width - 12}" y2="${height - bottom}" />
      ${[0.25, 0.5, 0.75, 1]
        .map((tick) => {
          const y = height - bottom - tick * chartHeight;
          return `<line class="gridline" x1="${left}" y1="${y}" x2="${width - 12}" y2="${y}" />`;
        })
        .join("")}
      ${points
        .map((point) => {
          const barHeight = (point.value / max) * chartHeight;
          const x = left + point.hour * (barWidth + gap);
          const y = height - bottom - barHeight;
          const todPeriod = schedule ? findTodPeriodForHour(schedule, point.hour) : undefined;
          const adjustment = todPeriod ? roundAdjustment(todPeriod.adjustmentPerKwh) : 0;
          return `
            <rect
              class="${todClassForAdjustment(adjustment)}"
              x="${x}"
              y="${y}"
              width="${barWidth}"
              height="${barHeight}"
              rx="3"
            >
              <title>${point.hour}:00 average ${formatKwh(point.value)}${
                todPeriod
                  ? `; ${todPeriod.label} ${formatCentsPerKwh(todPeriod.adjustmentPerKwh)}`
                  : ""
              }</title>
            </rect>
          `;
        })
        .join("")}
      ${[0, 6, 12, 18, 23]
        .map((hour) => {
          const x = left + hour * (barWidth + gap) + barWidth / 2;
          return `<text x="${x}" y="${height - 10}" text-anchor="middle">${hour}</text>`;
        })
        .join("")}
      <text x="8" y="20">${formatKwh(max)}</text>
    </svg>
    ${renderTodLegend(bundle)}
  `;
}

function renderHeatmap(intervals: NormalizedInterval[]): string {
  const cells = new Map<string, { kwh: number; count: number }>();
  for (const interval of intervals) {
    const key = `${interval.localStart.dayOfWeek}-${interval.localStart.hour}`;
    const cell = cells.get(key) ?? { kwh: 0, count: 0 };
    cell.kwh += interval.consumptionKwh;
    cell.count += 1;
    cells.set(key, cell);
  }
  const values = [...cells.values()].map((cell) => (cell.count ? cell.kwh / cell.count : 0));
  const max = Math.max(...values, 1);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return `
    <div class="heatmap">
      <div></div>
      ${Array.from({ length: 24 }, (_, hour) => `<span>${hour}</span>`).join("")}
      ${days
        .map((day, dayIndex) => {
          const dayOfWeek = dayIndex + 1;
          return `
            <strong>${day}</strong>
            ${Array.from({ length: 24 }, (_, hour) => {
              const cell = cells.get(`${dayOfWeek}-${hour}`);
              const value = cell?.count ? cell.kwh / cell.count : 0;
              const alpha = Math.max(0.08, value / max);
              return `<i style="opacity:${alpha}"><title>${day} ${hour}:00 average ${formatKwh(value)}</title></i>`;
            }).join("")}
          `;
        })
        .join("")}
    </div>
  `;
}

function renderTimeOfDayBands(bundle: ComparisonBundle): string {
  const bands = todBandSummaries(bundle);
  const schedule = timeOfDaySchedule();
  if (!bands.length || !schedule) {
    return `<p class="muted">No time-band allocation is available for the selected option.</p>`;
  }

  const totalKwh = bands.reduce((total, band) => total + band.kwh, 0);
  const totalImpact = bands.reduce((total, band) => total + band.amount, 0);
  const premium = bands.find((band) => band.adjustment > 0);
  const discount = bands.find((band) => band.adjustment < 0);

  return `
    <div class="tod-dashboard">
      <div class="tod-kpis">
        <div>
          <span>Net time-band effect</span>
          <strong class="${totalImpact <= 0 ? "good-value" : "bad-value"}">${formatCurrency(totalImpact)}</strong>
          <em>${totalImpact <= 0 ? "Credit after all bands" : "Added cost after all bands"}</em>
        </div>
        <div>
          <span>Discount window</span>
          <strong>${formatPercent(totalKwh && discount ? discount.kwh / totalKwh : 0)}</strong>
          <em>${discount ? formatKwh(discount.kwh) : "0 kWh"} at ${discount ? formatCentsPerKwh(discount.adjustment) : "-5c/kWh"}</em>
        </div>
        <div>
          <span>Premium window</span>
          <strong>${formatPercent(totalKwh && premium ? premium.kwh / totalKwh : 0)}</strong>
          <em>${premium ? formatKwh(premium.kwh) : "0 kWh"} at ${premium ? formatCentsPerKwh(premium.adjustment) : "+5c/kWh"}</em>
        </div>
      </div>
      <div class="tod-clock" aria-label="24 hour time-band adjustment map">
        ${Array.from({ length: 24 }, (_, hour) => {
          const period = findTodPeriodForHour(schedule, hour);
          const adjustment = roundAdjustment(period.adjustmentPerKwh);
          return `
            <span class="${todClassForAdjustment(adjustment)}">
              <title>${hour}:00 ${period.label} ${formatCentsPerKwh(period.adjustmentPerKwh)}</title>
            </span>
          `;
        }).join("")}
      </div>
      <div class="tod-clock-axis">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
      </div>
      <div class="tod-band-list">
        ${bands
          .map(
            (band) => `
              <div class="tod-band-row">
                <span><b class="${band.className}"></b>${escapeHtml(band.label)}</span>
                <strong>${formatPercent(totalKwh ? band.kwh / totalKwh : 0)}</strong>
                <em>${formatKwh(band.kwh)}</em>
                <em>${formatCurrency(band.amount)}</em>
              </div>
              <div class="tod-periods">${escapeHtml(
                band.periods
                  .map((period) =>
                    period.startTime && period.endTime
                      ? `${period.label} ${period.startTime}-${period.endTime}`
                      : period.label,
                  )
                  .join("; "),
              )}</div>
            `,
          )
          .join("")}
      </div>
      ${renderTodLegend(bundle)}
    </div>
  `;
}

function renderTodLegend(bundle: ComparisonBundle): string {
  const bands = todBandSummaries(bundle);
  if (!bands.length) {
    return "";
  }

  return `
    <div class="tod-legend">
      ${bands
        .map(
          (band) => `
            <span><b class="${band.className}"></b>${escapeHtml(band.label)}</span>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderResultDetails(result: RateComparisonResult, meter: MeterAnalysis): string {
  return `
    <details>
      <summary>
        <span>${escapeHtml(result.label)}</span>
        <strong>${formatCurrency(result.totalCost)}</strong>
      </summary>
      <table class="component-table">
        <thead>
          <tr>
            <th>Component</th>
            <th>Quantity</th>
            <th>Rate</th>
            <th>Amount</th>
            <th>Trace</th>
          </tr>
        </thead>
        <tbody>
          ${result.components
            .map(
              (component) => `
                <tr>
                  <td>${escapeHtml(component.label)}</td>
                  <td>${component.quantity === undefined ? "" : formatQuantity(component.quantity, component.unit)}</td>
                  <td>${component.rate === undefined ? "" : formatRate(component.rate, component.unit)}</td>
                  <td>${formatCurrency(component.amount)}</td>
                  <td>${renderTrace(component.trace)}</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
      <p class="muted">Trace uses source row numbers from the uploaded files. Private file names, account numbers, and addresses are not shown.</p>
      ${renderMeterScope(meter)}
    </details>
  `;
}

function renderMeterScope(meter: MeterAnalysis): string {
  return `
    <div class="scope-line">
      <span>Meter ${escapeHtml(meter.meterDisplay)}</span>
      <span>${meter.fileNames.length} uploaded source file${meter.fileNames.length === 1 ? "" : "s"}</span>
      <span>Config ${escapeHtml(state.rateConfig?.version ?? "unknown")}</span>
    </div>
  `;
}

function renderTrace(trace: RateComparisonResult["components"][number]["trace"]): string {
  if (!trace) {
    return "";
  }

  const first = trace.firstRow ? `row ${trace.firstRow.rowNumber}` : "";
  const last = trace.lastRow ? `row ${trace.lastRow.rowNumber}` : "";
  return `${trace.intervalCount?.toLocaleString() ?? ""} intervals; ${first} to ${last}`;
}

function renderTierSummary(result: RateComparisonResult): string {
  if (!result.tierAllocation) {
    return "";
  }

  return result.tierAllocation
    .map((tier) => `${escapeHtml(tier.label)} ${formatKwh(tier.kwh)}`)
    .join("<br />");
}

function renderTodSummary(result: RateComparisonResult): string {
  if (!result.timeOfDayAllocation) {
    return "";
  }

  return aggregateTodAllocation(result.timeOfDayAllocation)
    .map(
      (band) =>
        `${escapeHtml(todBandLabel(band.adjustment))} ${formatKwh(band.kwh)} (${formatCurrency(
          band.amount,
        )})`,
    )
    .join("<br />");
}

function aggregateTodAllocation(
  allocation: NonNullable<RateComparisonResult["timeOfDayAllocation"]>,
): Array<{ adjustment: number; kwh: number; amount: number }> {
  const bands = new Map<number, { adjustment: number; kwh: number; amount: number }>();
  for (const period of allocation) {
    const adjustment = roundAdjustment(period.adjustmentPerKwh);
    const existing = bands.get(adjustment) ?? { adjustment, kwh: 0, amount: 0 };
    existing.kwh += period.kwh;
    existing.amount += period.amount;
    bands.set(adjustment, existing);
  }

  return [...bands.values()].sort((left, right) => left.adjustment - right.adjustment);
}

function renderIssue(issue: ValidationIssue): string {
  const range = issue.range
    ? ` (${escapeHtml(issue.range.startLocal)} to ${escapeHtml(issue.range.endLocal)})`
    : "";
  return `
    <div class="issue ${issue.severity}">
      <strong>${escapeHtml(issue.severity)}</strong>
      <span>${escapeHtml(issue.message)}${range}</span>
    </div>
  `;
}

function renderNotice(kind: "good" | "error", message: string): string {
  return `<div class="notice ${kind}">${escapeHtml(message)}</div>`;
}

function bindEvents(): void {
  document.querySelector<HTMLInputElement>("#fileInput")?.addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    void handleFiles(input.files ? [...input.files] : []);
  });

  document.querySelectorAll<HTMLInputElement>("[data-rate-path]").forEach((input) => {
    input.addEventListener("change", () => {
      applyRateControl(input);
    });
  });

  document.querySelector<HTMLButtonElement>("#resetRateConfig")?.addEventListener("click", () => {
    state.rateConfigUserModified = false;
    void init();
  });

  document.querySelector<HTMLSelectElement>("#meterSelect")?.addEventListener("change", (event) => {
    state.selectedMeterKey = (event.currentTarget as HTMLSelectElement).value;
    render();
  });

  document.querySelector<HTMLSelectElement>("#periodSelect")?.addEventListener("change", (event) => {
    const meter = currentMeter();
    if (meter) {
      state.selectedPeriodIndex[meter.meterKey] = Number(
        (event.currentTarget as HTMLSelectElement).value,
      );
    }
    render();
  });

  document.querySelector<HTMLButtonElement>("#downloadComparison")?.addEventListener("click", () => {
    const meter = currentMeter();
    const period = meter ? currentPeriod(meter) : undefined;
    if (meter && period && state.rateConfig) {
      const bundle = calculateComparisons(meter, period, state.rateConfig);
      downloadText("bchydro-rate-comparison.csv", comparisonSummaryCsv(bundle));
    }
  });

  document.querySelector<HTMLButtonElement>("#downloadValidation")?.addEventListener("click", () => {
    const meter = currentMeter();
    if (meter) {
      downloadText("bchydro-validation-report.csv", validationReportCsv(meter));
    }
  });

  document.querySelector<HTMLButtonElement>("#printReport")?.addEventListener("click", () => {
    window.print();
  });
}

function applyRateControl(input: HTMLInputElement): void {
  if (!state.rateConfig) {
    return;
  }

  const path = input.dataset.ratePath;
  if (!path) {
    return;
  }

  let value: string | number | boolean = input.value;
  if (input.dataset.kind === "boolean") {
    value = input.checked;
  } else if (input.dataset.kind === "number") {
    const parsed = Number(input.value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    value = input.dataset.scale === "percent" ? parsed / 100 : parsed;
  }

  setPathValue(state.rateConfig, path, value);
  state.rateConfigUserModified = true;
  if (state.upload) {
    rebuildAnalysis();
  }
  render();
}

function setPathValue(target: unknown, path: string, value: string | number | boolean): void {
  const parts = path.split(".");
  let cursor = target as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = value;
}

async function handleFiles(files: File[]): Promise<void> {
  const textFiles: TextFileInput[] = await Promise.all(
    files.map(async (file) => ({ name: file.name, text: await file.text() })),
  );
  const parsed = parseConsumptionFiles(textFiles);
  state.parsedRecords = parsed.records;
  state.fileSummaries = parsed.fileSummaries;
  state.parseIssues = parsed.issues;
  state.upload = analyzeUploads(
    parsed.records,
    parsed.fileSummaries,
    parsed.issues,
    activeTimezone(),
  );
  state.selectedMeterKey = state.upload.meters[0]?.meterKey;
  state.selectedPeriodIndex = {};
  render();
}

function rebuildAnalysis(): void {
  if (!state.parsedRecords || !state.fileSummaries || !state.parseIssues) {
    return;
  }

  state.upload = analyzeUploads(
    state.parsedRecords,
    state.fileSummaries,
    state.parseIssues,
    activeTimezone(),
  );
}

function activeTimezone(): string {
  return state.rateConfig?.timezone ?? "UTC";
}

function currentMeter(): MeterAnalysis | undefined {
  if (!state.upload?.meters.length) {
    return undefined;
  }

  return (
    state.upload.meters.find((meter) => meter.meterKey === state.selectedMeterKey) ??
    state.upload.meters[0]
  );
}

function currentPeriod(meter: MeterAnalysis): AnalysisPeriod | undefined {
  if (!meter.completePeriods.length) {
    return undefined;
  }

  const index =
    state.selectedPeriodIndex[meter.meterKey] ?? Math.max(0, meter.completePeriods.length - 1);
  return meter.completePeriods[index] ?? meter.completePeriods.at(-1);
}

function canCalculate(meter: MeterAnalysis): boolean {
  const globalBlocking = state.upload?.issues.some((issue) => issue.severity === "error");
  const meterBlocking = meter.issues.some((issue) => issue.severity === "error");
  return !globalBlocking && !meterBlocking && meter.completePeriods.length > 0;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: state.rateConfig?.currency ?? "CAD",
    currencyDisplay: "narrowSymbol",
  }).format(value);
}

function formatKwh(value: number): string {
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} kWh`;
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatQuantity(value: number, unit?: string): string {
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
  return unit && unit !== "currency" ? `${formatted} ${unit}` : formatted;
}

function formatRate(value: number, unit?: string): string {
  if (unit === "kWh") {
    return `${formatCurrency(value)}/kWh`;
  }

  if (unit === "day") {
    return `${formatCurrency(value)}/day`;
  }

  return new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 4 }).format(
    value,
  );
}

function joinValues(values: string[]): string {
  return values.length ? values.join(", ") : "Not supplied";
}

function groupByMonth(intervals: NormalizedInterval[]): Map<string, number> {
  const groups = new Map<string, number>();
  for (const interval of intervals) {
    const month = `${String(interval.localStart.year).padStart(4, "0")}-${String(
      interval.localStart.month,
    ).padStart(2, "0")}`;
    groups.set(month, (groups.get(month) ?? 0) + interval.consumptionKwh);
  }

  return new Map([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function shortMonthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    timeZone: "UTC",
  }).format(date);
}

function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function linkify(text: string): string {
  return text.replace(
    /(https:\/\/[^\s]+)/g,
    '<a href="$1" target="_blank" rel="noreferrer">$1</a>',
  );
}
