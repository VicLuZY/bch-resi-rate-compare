import "./styles.css";
import { calendarDaysBetween, epochToWallKey } from "./domain/datetime";
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

type TextFileInput = {
  name: string;
  text: string;
};

const DEFAULT_RATE_CONFIG_URL = `${import.meta.env.BASE_URL}rates/bchydro-residential-2026-04-01.json`;
const BC_HYDRO_DATA_EXPORT_URL =
  "https://app.bchydro.com/datadownload/web/download-centre.html";
const DEPLOY_CODE = import.meta.env.VITE_DEPLOY_CODE || "qivnaro-local";
const AVERAGE_PERIOD_INDEX = -1;
const LOCAL_DATE_TIME_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\b/g;
const EXAMPLE_EXPORTS = [
  {
    id: "ev",
    label: "EV charging example",
    description: "Overnight charging profile without electric space heating.",
    fileName: "bchydro-example-ev-charging-no-electric-heat.csv",
    url: `${import.meta.env.BASE_URL}examples/bchydro-example-ev-charging-no-electric-heat.csv`,
  },
  {
    id: "baseboard",
    label: "Electric baseboard example",
    description: "Winter heating profile without EV charging.",
    fileName: "bchydro-example-electric-baseboard-no-ev.csv",
    url: `${import.meta.env.BASE_URL}examples/bchydro-example-electric-baseboard-no-ev.csv`,
  },
] as const;

let analyzeUploadsFn: typeof import("./domain/validation").analyzeUploads | undefined;
let intervalsForPeriodFn: typeof import("./domain/validation").intervalsForPeriod | undefined;
let calculateComparisonsFn: typeof import("./domain/rates").calculateComparisons | undefined;
let calculateAverageComparisonsFn:
  | typeof import("./domain/rates").calculateAverageComparisons
  | undefined;
let validateRateConfigFn: typeof import("./domain/rates").validateRateConfig | undefined;

interface AppState {
  rateConfig?: RateConfig;
  rateConfigLoading: boolean;
  rateConfigUserModified: boolean;
  rateAssumptionsExpanded: boolean;
  rateAssumptionsUnlocked: boolean;
  upload?: UploadAnalysis;
  parsedRecords?: ParsedConsumptionRecord[];
  fileSummaries?: FileSummary[];
  parseIssues?: ValidationIssue[];
  selectedMeterKey?: string;
  selectedPeriodIndex: Record<string, number>;
  loadError?: string;
  exampleLoadError?: string;
  comparisonCopyStatus?: "copied" | "error";
}

const state: AppState = {
  rateConfigLoading: true,
  rateConfigUserModified: false,
  rateAssumptionsExpanded: false,
  rateAssumptionsUnlocked: false,
  selectedPeriodIndex: {},
};

const root = document.querySelector<HTMLDivElement>("#app");
if (!root) {
  throw new Error("Missing #app root.");
}
const appRoot = root;

void init();

async function init(): Promise<void> {
  state.rateConfigLoading = true;
  state.loadError = undefined;
  render();

  try {
    const response = await fetch(DEFAULT_RATE_CONFIG_URL);
    const config = (await response.json()) as RateConfig;
    state.rateConfig = config;
  } catch (error) {
    state.loadError = error instanceof Error ? error.message : String(error);
  } finally {
    state.rateConfigLoading = false;
  }
  render();
}

function render(): void {
  const selectedMeter = currentMeter();
  const selectedPeriods = selectedMeter ? currentPeriods(selectedMeter) : [];
  const configErrors = state.rateConfig && validateRateConfigFn
    ? validateRateConfigFn(state.rateConfig)
    : [];
  let comparison: ComparisonBundle | undefined;
  let calculationError: string | undefined;

  if (
    selectedMeter &&
    selectedPeriods.length &&
    state.rateConfig &&
    calculateAverageComparisonsFn &&
    canCalculate(selectedMeter)
  ) {
    if (configErrors.length) {
      calculationError =
        "Rate assumptions need attention before a comparison can be calculated.";
    } else {
      try {
        comparison = calculateAverageComparisonsFn(
          selectedMeter,
          selectedPeriods,
          state.rateConfig,
        );
      } catch (error) {
        calculationError = error instanceof Error ? error.message : String(error);
      }
    }
  }

  appRoot.innerHTML = `
    <a class="skip-link" href="#mainContent">Skip to calculator</a>
    ${renderHero(comparison, selectedMeter, selectedPeriods)}
    <main id="mainContent" class="workspace ${state.upload ? "" : "landing-workspace"}">
      <aside class="sidebar">
        ${renderUploadPanel()}
        ${renderAssumptionsPanel()}
      </aside>
      <section class="main-panel">
        ${state.loadError ? renderNotice("error", state.loadError) : ""}
        ${renderValidationPanel(selectedMeter, selectedPeriods)}
        ${calculationError ? renderNotice("error", calculationError) : ""}
        ${comparison ? renderResultsPanel(comparison, selectedMeter!) : ""}
      </section>
    </main>
    ${renderSiteFooter()}
  `;

  bindEvents();
}

function renderHero(
  comparison?: ComparisonBundle,
  selectedMeter?: MeterAnalysis,
  _selectedPeriods: AnalysisPeriod[] = [],
): string {
  const uploadCount = state.upload?.files.length ?? 0;
  const meterCount = state.upload?.meters.length ?? 0;
  const best = comparison?.results[0];
  const configStatus = state.rateConfigLoading
    ? "Loading rates"
    : state.loadError
      ? "Rates unavailable"
      : "Rates ready";

  return `
    <header class="site-hero">
      <div class="hero-nav" aria-label="Site">
        <div class="brand-lockup" aria-label="BC Hydro residential rate comparator">
          <span class="brand-mark" aria-hidden="true"></span>
          <span>Residential rate comparator</span>
        </div>
        <div class="privacy-note">Local-first analysis. Uploaded files stay in this browser session.</div>
      </div>
      <div class="hero-copy compact-hero">
        <p class="eyebrow">BC residential electricity rate comparison</p>
        <h1>Compare residential rate options from hourly use.</h1>
        <p class="hero-lede">Upload BC Hydro hourly CSVs, validate the meter history, compare annual totals, and export a readable summary.</p>
        <div class="hero-actions">
          <a class="primary-link" href="#fileInput">Upload CSV exports</a>
          <a class="secondary-link" href="${BC_HYDRO_DATA_EXPORT_URL}" target="_blank" rel="noreferrer">Get BC Hydro data</a>
        </div>
        <div class="progress-chips" aria-label="Comparison progress">
          ${renderProgressChip("Rates", configStatus, !state.rateConfigLoading && !state.loadError, state.rateConfigLoading)}
          ${renderProgressChip("Upload", uploadCount ? `${uploadCount} file${uploadCount === 1 ? "" : "s"}` : "Start", uploadCount > 0, !uploadCount)}
          ${renderProgressChip("Validate", meterCount ? `${meterCount} meter${meterCount === 1 ? "" : "s"}` : "Waiting", Boolean(selectedMeter), Boolean(uploadCount && !selectedMeter))}
          ${renderProgressChip("Compare", best ? formatCurrency(best.totalCost) : "Waiting", Boolean(best), Boolean(selectedMeter && !best))}
        </div>
      </div>
    </header>
  `;
}

function renderProgressChip(
  label: string,
  value: string,
  complete: boolean,
  current: boolean,
): string {
  return `
    <span class="progress-chip ${complete ? "complete" : ""} ${current ? "current" : ""}">
      <strong>${escapeHtml(label)}</strong>
      <em>${escapeHtml(value)}</em>
    </span>
  `;
}

function renderSiteFooter(): string {
  return `
    <footer class="site-footer">
      <div class="footer-meta">
        <strong>&copy; Victor Lü, 2026.</strong>
        <span>
          Licensed
          <a href="https://github.com/VicLuZY/bch-resi-rate-compare/blob/main/LICENSE" target="_blank" rel="noreferrer">AGPL-3.0-only</a>.
        </span>
        <a href="https://github.com/VicLuZY/bch-resi-rate-compare" target="_blank" rel="noreferrer">Source code</a>
        <span class="deploy-code">Deploy code <code>${escapeHtml(DEPLOY_CODE)}</code></span>
      </div>
      <p class="footer-disclaimer">
        Calculator results are estimates for comparison only, provided without warranty, and are not a BC Hydro bill or official tariff interpretation. Verify uploaded data, effective rates, riders, taxes, credits, charges, and bill-cycle rounding before using results for decisions.
      </p>
    </footer>
  `;
}

function renderUploadPanel(): string {
  const files = state.upload?.files ?? [];
  return `
    <section class="panel intake-panel" aria-labelledby="uploadHeading">
      <div class="panel-heading">
        <p class="section-kicker">Step 1</p>
        <h2 id="uploadHeading">Upload interval exports</h2>
        <p id="uploadHelp">Use one or more BC Hydro hourly CSV exports. Segments for the same meter are merged locally.</p>
      </div>
      <label class="drop-zone" for="fileInput">
        <input id="fileInput" type="file" accept=".csv,text/csv" multiple aria-describedby="uploadHelp" />
        <span class="drop-zone-icon" aria-hidden="true"></span>
        <span class="drop-zone-main">Choose CSV files</span>
        <span class="drop-zone-sub">Keyboard accessible. Multiple files supported.</span>
      </label>
      <div class="example-loader" aria-label="Load example CSVs">
        <div>
          <strong>Try examples</strong>
          <span>Choose an EV charging profile or an electric heating profile.</span>
        </div>
        <div class="example-buttons">
          ${EXAMPLE_EXPORTS.map(
            (example) => `
              <button class="secondary example-button" type="button" data-example-id="${escapeAttribute(example.id)}">
                <strong>${escapeHtml(example.label)}</strong>
                <span>${escapeHtml(example.description)}</span>
              </button>
            `,
          ).join("")}
        </div>
      </div>
      ${state.exampleLoadError ? renderNotice("error", state.exampleLoadError) : ""}
      ${
        files.length
          ? `<div class="file-list">
              ${files
                .map(
                  (file, index) => `
                    <div class="file-row">
                      <span class="file-pill">File ${index + 1}</span>
                      <strong>${file.acceptedRows.toLocaleString()} accepted rows</strong>
                      <span>${formatLocalDateTimeRange(
                        file.firstLocal,
                        file.lastLocal,
                      )}</span>
                    </div>
                  `,
                )
                .join("")}
            </div>`
          : `<p class="empty-copy">No customer data is loaded. Use your own export or load an example profile.</p>`
      }
    </section>
  `;
}

function renderAssumptionsPanel(): string {
  const configErrors = state.rateConfig && validateRateConfigFn
    ? validateRateConfigFn(state.rateConfig)
    : [];
  const config = state.rateConfig;
  const isOpen = state.rateAssumptionsExpanded;
  const isUnlocked = state.rateAssumptionsUnlocked;
  if (!config) {
    return `
      <section class="panel assumptions">
        <div class="assumptions-header">
          <button id="toggleAssumptions" class="assumptions-toggle" type="button" aria-expanded="false">
            <span>
              <strong>Rate assumptions</strong>
              <small>${state.rateConfigLoading ? "Loading bundled tariff assumptions." : "No rate configuration loaded."}</small>
            </span>
          </button>
        </div>
        ${state.rateConfigLoading ? renderNotice("info", "Loading the bundled residential rate assumptions.") : ""}
      </section>
    `;
  }

  return `
    <section class="panel assumptions ${isOpen ? "is-open" : ""}">
      <div class="assumptions-header">
        <button
          id="toggleAssumptions"
          class="assumptions-toggle"
          type="button"
          aria-expanded="${isOpen ? "true" : "false"}"
          aria-controls="rateAssumptionsBody"
        >
          <span>
            <strong>Rate assumptions</strong>
            <small>${escapeHtml(config.label)}</small>
          </span>
          <em>${isOpen ? "Collapse" : "Expand"}</em>
        </button>
        <button id="unlockRateConfig" type="button" class="secondary lock-button ${isUnlocked ? "unlocked" : ""}">
          ${isUnlocked ? "Lock edits" : "Unlock edits"}
        </button>
      </div>
      <p class="assumptions-collapsed-note">
        ${isUnlocked ? "Editing is unlocked for this session." : "Defaults are locked to prevent accidental edits."}
        ${state.rateConfigUserModified ? " Current values include user changes." : " Current values use the bundled tariff file."}
      </p>
      ${
        isOpen
          ? `<div id="rateAssumptionsBody" class="assumptions-body">
              <div class="status-line">
                <span class="status ${configErrors.length ? "bad" : "good"}">
                  ${configErrors.length ? "Needs attention" : "Ready"}
                </span>
                <span>${state.rateConfigUserModified ? "User-modified" : "Tariff file"}</span>
                <span class="status ${isUnlocked ? "good" : "locked"}">${isUnlocked ? "Editable" : "Locked"}</span>
              </div>
              ${isUnlocked ? "" : renderLockNotice()}
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
                <button id="resetRateConfig" type="button" class="secondary" ${isUnlocked ? "" : "disabled"}>Reload default</button>
              </div>
              ${renderSourceNotes()}
            </div>`
          : ""
      }
    </section>
  `;
}

function renderLockNotice(): string {
  return `
    <div class="lock-notice">
      <strong>Locked by default</strong>
      <span>Unlock only if you want to override rates, riders, taxes, or clock-window adjustments. Changes affect every comparison in this browser session.</span>
    </div>
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
                } ${rateControlDisabledAttribute()} />
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
        )}" step="${step}" ${percent ? 'data-scale="percent"' : ""} ${rateControlDisabledAttribute()} />
        <small>${escapeHtml(suffix)}</small>
      </span>
    </label>
  `;
}

function timeControl(label: string, path: string, value: string): string {
  return `
    <label class="field-row compact-field">
      <span>${escapeHtml(label)}</span>
      <input type="time" data-rate-path="${escapeAttribute(path)}" data-kind="string" value="${escapeAttribute(value)}" ${rateControlDisabledAttribute()} />
    </label>
  `;
}

function rateControlDisabledAttribute(): string {
  return state.rateAssumptionsUnlocked ? "" : "disabled";
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
          .map((note) => `<li>${linkify(note)}</li>`)
          .join("")}
      </ul>
    </details>
  `;
}

function renderValidationPanel(
  selectedMeter?: MeterAnalysis,
  selectedPeriods: AnalysisPeriod[] = [],
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
          <p class="privacy-callout">Private names, account numbers, and service addresses are read from your uploaded CSV in the browser only; this published page does not include personal account data.</p>
        </div>
      </section>
    `;
  }

  const meters = state.upload.meters;
  const blockingCount =
    state.upload.issues.filter((issue) => issue.severity === "error").length +
    meters.reduce(
      (total, meter) =>
        total + meter.issues.filter((issue) => issue.severity === "error").length,
      0,
    );
  const warningCount =
    state.upload.issues.filter((issue) => issue.severity === "warning").length +
    meters.reduce(
      (total, meter) =>
        total + meter.issues.filter((issue) => issue.severity === "warning").length,
      0,
    );
  const statusClass = blockingCount ? "bad" : warningCount ? "warn" : "good";
  const statusLabel = blockingCount
    ? `${blockingCount} blocking issue${blockingCount === 1 ? "" : "s"}`
    : warningCount
      ? `${warningCount} warning${warningCount === 1 ? "" : "s"}`
      : "Ready to compare";

  return `
    <section class="panel wide validation-panel" aria-labelledby="validationHeading">
      <div class="panel-heading split">
        <div>
          <p class="section-kicker">Step 2</p>
          <h2 id="validationHeading">Validation status</h2>
          <p>${meters.length} meter${meters.length === 1 ? "" : "s"} detected across ${
            state.upload.files.length
          } file${state.upload.files.length === 1 ? "" : "s"}.</p>
        </div>
        <span class="status-badge ${statusClass}">${statusLabel}</span>
        ${
          meters.length
            ? `<select id="meterSelect" aria-label="Select meter">
                ${meters
                  .map(
                    (meter) => `
                      <option value="${escapeAttribute(meter.meterKey)}" ${
                        meter.meterKey === selectedMeter?.meterKey ? "selected" : ""
                      }>${escapeHtml(clipMiddle(meter.meterDisplay, 54))}</option>
                    `,
                  )
                  .join("")}
              </select>`
            : ""
        }
      </div>
      ${renderGlobalIssues(state.upload.issues)}
      ${selectedMeter ? renderMeterValidation(selectedMeter, selectedPeriods) : ""}
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

function formatLocalDateTimeRange(start?: string, end?: string): string {
  const startText = formatLocalDateTime(start);
  const endText = formatLocalDateTime(end);
  if (startText === "Not available" && endText === "Not available") {
    return startText;
  }

  return `${startText} to ${endText}`;
}

function formatDateRangeLabel(start: string, end: string): string {
  return formatDateRangePlain(start, end);
}

function formatDateRangePlain(start: string, end: string): string {
  return `${formatLocalDatePlain(start)} to ${formatLocalDatePlain(end)}`;
}

function formatLocalDateTime(value?: string): string {
  return escapeHtml(formatLocalDateTimePlain(value));
}

function formatLocalDate(value?: string): string {
  return escapeHtml(formatLocalDatePlain(value));
}

function formatLocalDateTimePlain(value?: string): string {
  const date = localDateFromWallKey(value);
  if (!date) {
    return value ? formatGeneratedMessageFallback(value) : "Not available";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatLocalDatePlain(value?: string): string {
  const date = localDateFromWallKey(value);
  if (!date) {
    return value ? formatGeneratedMessageFallback(value) : "Not available";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function localDateFromWallKey(value?: string): Date | undefined {
  if (!value || value === "n/a") {
    return undefined;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return undefined;
  }

  return new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
    ),
  );
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
  selectedPeriods: AnalysisPeriod[],
): string {
  const errorCount = meter.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = meter.issues.filter((issue) => issue.severity === "warning").length;
  const periodOptions = meter.completePeriods;
  const periodIndex = currentPeriodIndex(meter);
  const estimatedCount = meter.intervals.filter((interval) => interval.estimated).length;
  const periodIntervals = intervalsForPeriods(meter.intervals, selectedPeriods);
  const selectedSummary = summarizePeriods(selectedPeriods);

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
          <div><dt>Meter</dt><dd>${renderValueList(meter.meterNumbers)}</dd></div>
          <div><dt>Files</dt><dd>${meter.fileNames.length}</dd></div>
          <div><dt>Date range</dt><dd>${formatLocalDateTimeRange(
            meter.dateRange?.startLocal,
            meter.dateRange?.endLocal,
          )}</dd></div>
          <div><dt>Estimated intervals</dt><dd>${estimatedCount.toLocaleString()}</dd></div>
        </dl>
      </div>
      <div>
        <h3>Analysis period</h3>
        ${
          periodOptions.length
            ? `<select id="periodSelect" aria-label="Select annual period">
                ${
                  periodOptions.length > 1
                    ? `<option value="${AVERAGE_PERIOD_INDEX}" ${periodIndex === AVERAGE_PERIOD_INDEX ? "selected" : ""}>
                        Average of ${periodOptions.length} complete annual periods
                      </option>`
                    : ""
                }
                ${periodOptions
                  .map(
                    (period, index) => `
                      <option value="${index}" ${index === periodIndex ? "selected" : ""}>
                        ${escapeHtml(formatDateRangeLabel(period.startLocal, period.endLocal))}
                      </option>
                    `,
                  )
                  .join("")}
              </select>
              <dl class="facts">
                <div><dt>${selectedPeriods.length > 1 ? "Average annual consumption" : "Consumption"}</dt><dd>${formatKwh(selectedSummary.totalKwh)}</dd></div>
                <div><dt>${selectedPeriods.length > 1 ? "Average service days" : "Service days"}</dt><dd>${formatNumber(selectedSummary.serviceDays)}</dd></div>
                <div><dt>Rows included</dt><dd>${periodIntervals.length.toLocaleString()}</dd></div>
                <div><dt>Source range</dt><dd>${formatLocalDateTimeRange(
                  selectedSummary.startLocal,
                  selectedSummary.endLocal,
                )}</dd></div>
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
        <strong>${renderValueList(meter.customerNames)}</strong>
      </div>
      <div>
        <span>Account number</span>
        <strong>${renderValueList(meter.accountNumbers)}</strong>
      </div>
      <div>
        <span>Meter number</span>
        <strong>${renderValueList(meter.meterNumbers)}</strong>
      </div>
      <div>
        <span>Service address</span>
        <strong>${renderValueList([...meter.serviceAddresses, ...meter.cities], {
          itemLength: 42,
          maxItems: 2,
        })}</strong>
      </div>
    </div>
  `;
}

function renderResultsPanel(bundle: ComparisonBundle, meter: MeterAnalysis): string {
  const periodIntervals = intervalsForPeriods(meter.intervals, bundle.sourcePeriods);
  const periodCount = bundle.sourcePeriods.length;
  const cheapest = Math.min(...bundle.results.map((item) => item.totalCost));
  return `
    <section class="panel wide results report-surface" aria-labelledby="resultsHeading">
      <div class="panel-heading split results-heading">
        <div>
          <p class="section-kicker">Step 3</p>
          <h2 id="resultsHeading">${bundle.isAverage ? "Average annual comparison" : "Annual comparison"}</h2>
          <p>${
            bundle.isAverage
              ? `${periodCount} complete years averaged from ${formatLocalDate(
                  bundle.period.startLocal,
                )} to ${formatLocalDate(bundle.period.endLocal)}; ${formatKwh(
                  bundle.period.totalKwh,
                )} average annual usage.`
              : `${formatLocalDate(bundle.period.startLocal)} to ${formatLocalDate(
                  bundle.period.endLocal,
                )}; ${formatKwh(bundle.period.totalKwh)}.`
          }</p>
        </div>
      </div>
      ${renderInsightSummary(bundle)}
      ${renderCostComparisonDashboard(bundle)}
      ${renderRateCalculationSection(bundle, meter, cheapest)}
      ${renderUsageDashboard(periodIntervals, bundle, meter)}
      <div class="visual-section export-section" aria-labelledby="exportHeading">
        <div class="section-title">
          <div>
            <p class="section-kicker">Step 5</p>
            <h3 id="exportHeading">Export or share</h3>
          </div>
          <span>CSV, print, and copied summaries use the same annual totals shown on this screen.</span>
        </div>
        <div class="export-card">
          <div>
            <strong>${renderTrimmedText(bundle.results[0].label, 42)} is lowest at ${formatCurrency(bundle.results[0].totalCost)}</strong>
            <span>${formatKwh(bundle.period.totalKwh)} ${bundle.isAverage ? "average annual" : "annual"} usage; ${bundle.results.length} rate options compared.</span>
          </div>
          <div class="button-row compact">
            <button id="copyComparison" type="button" class="secondary">Copy summary</button>
            <button id="downloadComparison" type="button">Export summary CSV</button>
            <button id="printReport" type="button" class="secondary">Print report</button>
          </div>
        </div>
        ${
          state.comparisonCopyStatus
            ? renderNotice(
                state.comparisonCopyStatus === "copied" ? "good" : "error",
                state.comparisonCopyStatus === "copied"
                  ? "Summary copied with the same totals shown above."
                  : "Unable to copy the summary. Use export CSV or print instead.",
              )
            : ""
        }
      </div>
      <div class="visual-section table-section" aria-labelledby="tableHeading">
        <div class="section-title">
          <h3 id="tableHeading">Detailed comparison table</h3>
          <span>Mobile screens show the same rows as compact cards below the table.</span>
        </div>
        <div class="table-scroll" tabindex="0" aria-label="Detailed rate comparison table">
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
              ${bundle.results.map((result) => renderResultRow(result, cheapest)).join("")}
            </tbody>
          </table>
        </div>
        <div class="results-table-mobile" aria-label="Detailed comparison rows">
          ${bundle.results.map((result) => renderResultMobileCard(result, cheapest)).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderResultRow(result: RateComparisonResult, cheapest: number): string {
  const difference = result.totalCost - cheapest;
  return `
    <tr>
      <td>${renderTrimmedText(result.label, 34)}</td>
      <td>${formatCurrency(result.totalCost)}</td>
      <td>${formatCurrency(difference)}</td>
      <td>${formatPercent(cheapest ? difference / cheapest : 0)}</td>
      <td>${formatKwh(result.totalKwh)}</td>
      <td>${renderTierSummary(result)}</td>
      <td>${renderTodSummary(result)}</td>
    </tr>
  `;
}

function renderResultMobileCard(result: RateComparisonResult, cheapest: number): string {
  const difference = result.totalCost - cheapest;
  return `
    <article class="mobile-data-card">
      <div>
        <span>Rate option</span>
        <strong>${renderTrimmedText(result.label, 42)}</strong>
      </div>
      <dl>
        <div><dt>Total</dt><dd>${formatCurrency(result.totalCost)}</dd></div>
        <div><dt>Difference</dt><dd>${formatCurrency(difference)}</dd></div>
        <div><dt>Percent above lowest</dt><dd>${formatPercent(cheapest ? difference / cheapest : 0)}</dd></div>
        <div><dt>Annual kWh</dt><dd>${formatKwh(result.totalKwh)}</dd></div>
      </dl>
      ${result.tierAllocation ? `<p>${renderTierSummary(result)}</p>` : ""}
      ${result.timeOfDayAllocation ? `<p>${renderTodSummary(result)}</p>` : ""}
    </article>
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
        <strong>${renderTrimmedText(cheapest.label, 34)}</strong>
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
  const ranking = rankedTotalsForDisplay(bundle.results);
  const maxTotal = Math.max(...bundle.results.map((result) => result.totalCost));
  const cheapest = Math.min(...bundle.results.map((result) => result.totalCost));
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
        <span>Bars show ${bundle.isAverage ? "average annual" : "annual"} cost; stack colors show where each dollar goes.</span>
      </div>
      <div class="ranked-bars enhanced">
        ${ranking
          .map((row) => {
            const width = maxTotal ? (row.total / maxTotal) * 100 : 0;
            return `
              <div class="bar-row">
                <span>${renderTrimmedText(row.option, 34)}</span>
                <div><b style="width:${width}%"></b></div>
                <strong>${formatCurrency(row.total)}</strong>
                <em>${row.total === cheapest ? "Lowest annual total" : `${formatCurrency(row.total - cheapest)} more`}</em>
              </div>
            `;
          })
          .join("")}
      </div>
      ${renderCostStackBars(bundle)}
    </div>
  `;
}

function rankedTotalsForDisplay(
  results: RateComparisonResult[],
): Array<{ option: string; total: number }> {
  return [...results]
    .sort((left, right) => left.totalCost - right.totalCost)
    .map((result) => ({ option: result.label, total: result.totalCost }));
}

function renderRateCalculationSection(
  bundle: ComparisonBundle,
  meter: MeterAnalysis,
  cheapest: number,
): string {
  return `
    <div class="visual-section calculation-section" aria-labelledby="calculationHeading">
      <div class="section-title">
        <div>
          <p class="section-kicker">Step 4</p>
          <h3 id="calculationHeading">Rate-by-rate calculation illustration</h3>
        </div>
        <span>Each card expands to show how the displayed annual total is composed.</span>
      </div>
      <div class="rate-card-grid">
        ${bundle.results
          .map((result, index) => renderRateCalculationCard(result, meter, cheapest, index))
          .join("")}
      </div>
    </div>
  `;
}

function renderRateCalculationCard(
  result: RateComparisonResult,
  meter: MeterAnalysis,
  cheapest: number,
  index: number,
): string {
  const difference = result.totalCost - cheapest;
  const groups = componentGroups(result);
  const positiveTotal = Math.max(
    1,
    groups
      .filter((group) => group.amount > 0)
      .reduce((total, group) => total + group.amount, 0),
  );

  return `
    <article class="rate-card ${difference === 0 ? "best" : ""}">
      <div class="rate-card-top">
        <span class="rank-badge">#${index + 1}</span>
        <div>
          <h4>${renderTrimmedText(result.label, 42)}</h4>
          <p>${result.timeOfDayAllocation ? "Base schedule plus time-band adjustment" : "Base schedule only"}</p>
        </div>
      </div>
      <div class="rate-card-total">
        <span>${difference === 0 ? "Lowest annual total" : "Annual total"}</span>
        <strong>${formatCurrency(result.totalCost)}</strong>
        <em>${difference === 0 ? "Best option for this upload" : `${formatCurrency(difference)} more than the lowest option`}</em>
      </div>
      <div class="mini-stack" role="img" aria-label="Cost component shares for ${escapeAttribute(result.label)}">
        ${groups
          .filter((group) => group.amount > 0)
          .map(
            (group) =>
              `<span class="${escapeAttribute(group.className)}" style="width:${(group.amount / positiveTotal) * 100}%"></span>`,
          )
          .join("")}
      </div>
      <details class="calculation-details" open>
        <summary>
          <span>Calculation illustration</span>
          <strong>${formatKwh(result.totalKwh)}</strong>
        </summary>
        <div class="formula-strip">
          ${result.components
            .map(
              (component) => `
                <div>
                  <span>${renderTrimmedText(component.label, 46)}</span>
                  <strong>${formatCurrency(component.amount)}</strong>
                  <em>${component.quantity === undefined ? "Fixed or derived adjustment" : `${formatQuantity(component.quantity, component.unit)} × ${component.rate === undefined ? "derived rate" : formatRate(component.rate, component.unit)}`}</em>
                </div>
              `,
            )
            .join("")}
        </div>
        <div class="component-table-wrap">
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
                      <td>${renderTrimmedText(component.label, 46)}</td>
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
        </div>
        <div class="component-mobile-list" aria-label="${escapeAttribute(result.label)} calculation rows">
          ${result.components
            .map(
              (component) => `
                <article class="mobile-data-card compact">
                  <div>
                    <span>Component</span>
                    <strong>${renderTrimmedText(component.label, 46)}</strong>
                  </div>
                  <dl>
                    <div><dt>Quantity</dt><dd>${component.quantity === undefined ? "Fixed or derived" : formatQuantity(component.quantity, component.unit)}</dd></div>
                    <div><dt>Rate</dt><dd>${component.rate === undefined ? "Derived" : formatRate(component.rate, component.unit)}</dd></div>
                    <div><dt>Amount</dt><dd>${formatCurrency(component.amount)}</dd></div>
                    <div><dt>Trace</dt><dd>${renderTrace(component.trace) || "Not applicable"}</dd></div>
                  </dl>
                </article>
              `,
            )
            .join("")}
        </div>
        <p class="muted">Trace uses source row numbers from the uploaded files. Private file names, account numbers, and addresses are not shown.</p>
        ${renderMeterScope(meter)}
      </details>
    </article>
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
      <strong>${renderTrimmedText(result.label, 42)}</strong>
      <span>${baseDescription}</span>
      <span>${timeBandDescription}</span>
      <em>${formatCurrency(result.totalCost)} for ${formatKwh(result.totalKwh)} average annual usage.</em>
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
                <strong>${renderTrimmedText(result.label, 34)}</strong>
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

function renderUsageDashboard(
  intervals: NormalizedInterval[],
  bundle: ComparisonBundle,
  meter: MeterAnalysis,
): string {
  const costResult = usageCostResult(bundle);
  return `
    <div class="visual-section usage-section">
      <div class="section-title">
        <h3>Usage over time</h3>
        <span>Usage reads on the left axis; estimated cost for ${renderTrimmedText(
          costResult.label,
          34,
        )} reads on the right.</span>
      </div>
      <div class="chart-grid">
        <div class="chart-panel">
          <h4>Average monthly usage and cost</h4>
          ${renderMonthlyChart(meter, bundle, costResult)}
        </div>
        <div class="chart-panel">
          <h4>Average hourly usage and cost</h4>
          ${renderHourlyChart(intervals, bundle, costResult)}
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
  return findTodPeriodForMinute(schedule, hour * 60);
}

function findTodPeriodForMinute(schedule: TimeOfDaySchedule, minute: number): TimeOfDaySchedule["periods"][number] {
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

interface UsageCostPoint {
  key: string;
  label: string;
  shortLabel: string;
  kwh: number;
  cost: number;
  usageClassName?: string;
  detail?: string;
}

function renderMonthlyChart(
  meter: MeterAnalysis,
  bundle: ComparisonBundle,
  costResult: RateComparisonResult,
): string {
  const monthly = monthlyUsageCostMetrics(meter, bundle, costResult);
  if (!monthly.length) {
    return `<p class="muted">Monthly usage and cost data is not available for this selection.</p>`;
  }

  return `
    ${renderDualAxisBarChart(monthly, "Monthly usage and cost bar chart", "monthly-bars", {
      labelEvery: 1,
      barMaxWidth: 24,
    })}
    ${renderMetricLegend()}
  `;
}

function renderHourlyChart(
  intervals: NormalizedInterval[],
  bundle: ComparisonBundle,
  costResult: RateComparisonResult,
): string {
  const hourly = hourlyUsageCostMetrics(intervals, costResult);
  return `
    ${renderDualAxisBarChart(hourly, "Average hourly usage and cost bar chart", "hourly-bars", {
      labelEvery: 6,
      forceLabels: new Set([23]),
      barMaxWidth: 18,
    })}
    ${renderMetricLegend(true)}
    ${renderTodLegend(bundle)}
  `;
}

function usageCostResult(bundle: ComparisonBundle): RateComparisonResult {
  return timeOfDayResult(bundle) ?? bundle.results[0];
}

function renderDualAxisBarChart(
  points: UsageCostPoint[],
  ariaLabel: string,
  className: string,
  options: {
    labelEvery: number;
    forceLabels?: Set<number>;
    barMaxWidth: number;
  },
): string {
  const width = 760;
  const height = 282;
  const left = 58;
  const right = 76;
  const top = 28;
  const bottom = 44;
  const chartRight = width - right;
  const chartBottom = height - bottom;
  const chartWidth = chartRight - left;
  const chartHeight = chartBottom - top;
  const groupWidth = chartWidth / points.length;
  const barWidth = Math.max(5, Math.min(options.barMaxWidth, groupWidth * 0.58));
  const maxKwh = Math.max(...points.map((point) => point.kwh), 1);
  const maxCost = Math.max(...points.map((point) => point.cost), 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return `
    <svg class="chart-svg dual-axis-chart ${className}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeAttribute(ariaLabel)}">
      <text class="axis-title usage-axis-title" x="${left}" y="16">kWh</text>
      <text class="axis-title cost-axis-title" x="${chartRight}" y="16" text-anchor="end">Cost</text>
      <line class="axis-line" x1="${left}" y1="${top}" x2="${left}" y2="${chartBottom}" />
      <line class="axis-line" x1="${chartRight}" y1="${top}" x2="${chartRight}" y2="${chartBottom}" />
      <line class="axis-line" x1="${left}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" />
      ${ticks
        .map((tick) => {
          const y = chartBottom - tick * chartHeight;
          return `
            <g>
              <line class="gridline" x1="${left}" y1="${y}" x2="${chartRight}" y2="${y}" />
              <text class="axis-value" x="${left - 8}" y="${y + 4}" text-anchor="end">${formatAxisKwh(maxKwh * tick)}</text>
              <text class="axis-value" x="${chartRight + 8}" y="${y + 4}">${formatAxisCurrency(maxCost * tick)}</text>
            </g>
          `;
        })
        .join("")}
      ${points
        .map((point, index) => {
          const center = left + index * groupWidth + groupWidth / 2;
          const usageHeight = (point.kwh / maxKwh) * chartHeight;
          const barX = center - barWidth / 2;
          const usageY = chartBottom - usageHeight;
          const showLabel =
            index % options.labelEvery === 0 || Boolean(options.forceLabels?.has(Number(point.key)));
          return `
            <g>
              <rect
                class="usage-bar ${escapeAttribute(point.usageClassName ?? "")}"
                x="${barX}"
                y="${usageY}"
                width="${barWidth}"
                height="${usageHeight}"
                rx="3"
                style="--bar-index:${index}"
              >
                <title>${escapeHtml(point.label)}: ${formatKwh(point.kwh)}; ${formatCurrency(point.cost)}${
                  point.detail ? `; ${escapeHtml(point.detail)}` : ""
                }</title>
              </rect>
              ${
                showLabel
                  ? `<text class="x-label" x="${center}" y="${height - 12}" text-anchor="middle">${escapeHtml(point.shortLabel)}</text>`
                  : ""
              }
            </g>
          `;
        })
        .join("")}
    </svg>
  `;
}

function renderMetricLegend(timeOfUseUsage = false): string {
  return `
    <div class="chart-legend metric-legend">
      <span><b class="usage ${timeOfUseUsage ? "tou" : ""}"></b>${timeOfUseUsage ? "TOU-colored shared bar" : "Shared usage/cost bar"}</span>
    </div>
  `;
}

function monthlyUsageCostMetrics(
  meter: MeterAnalysis,
  bundle: ComparisonBundle,
  costResult: RateComparisonResult,
): UsageCostPoint[] {
  if (!state.rateConfig || !calculateComparisonsFn || !intervalsForPeriodFn) {
    return fallbackMonthlyUsageCostMetrics(
      intervalsForPeriods(meter.intervals, bundle.sourcePeriods),
      bundle,
      costResult,
    );
  }

  const totals = new Map<string, { kwh: number; cost: number; count: number }>();
  for (const sourcePeriod of bundle.sourcePeriods) {
    const sourceMonthTotals = new Map<string, { kwh: number; cost: number }>();
    const sourceIntervals = intervalsForPeriodFn(meter.intervals, sourcePeriod);
    const monthlyBuckets = groupIntervalsByYearMonth(sourceIntervals);
    for (const [yearMonth, bucketIntervals] of monthlyBuckets) {
      const monthKey = bundle.isAverage ? yearMonth.slice(5) : yearMonth;
      const monthPeriod = analysisPeriodFromIntervals(bucketIntervals, meter.cadenceMinutes ?? 60);
      const monthBundle = calculateComparisonsFn(meter, monthPeriod, state.rateConfig);
      const monthResult =
        monthBundle.results.find((result) => result.optionId === costResult.optionId) ??
        monthBundle.results[0];
      const sourceEntry = sourceMonthTotals.get(monthKey) ?? { kwh: 0, cost: 0 };
      sourceEntry.kwh += monthPeriod.totalKwh;
      sourceEntry.cost += monthResult.totalCost;
      sourceMonthTotals.set(monthKey, sourceEntry);
    }

    for (const [monthKey, sourceEntry] of sourceMonthTotals) {
      const total = totals.get(monthKey) ?? { kwh: 0, cost: 0, count: 0 };
      total.kwh += sourceEntry.kwh;
      total.cost += sourceEntry.cost;
      total.count += 1;
      totals.set(monthKey, total);
    }
  }

  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, total]) => ({
      key: month,
      label: monthLabel(month),
      shortLabel: shortMonthLabel(month),
      kwh: total.count ? total.kwh / total.count : 0,
      cost: total.count ? total.cost / total.count : 0,
    }));
}

function fallbackMonthlyUsageCostMetrics(
  intervals: NormalizedInterval[],
  bundle: ComparisonBundle,
  costResult: RateComparisonResult,
): UsageCostPoint[] {
  const annualDivisor = Math.max(1, bundle.sourcePeriods.length);
  const totalKwh = Math.max(costResult.totalKwh, Number.EPSILON);
  return [...groupByMonth(intervals, bundle.isAverage).entries()].map(([month, kwh]) => {
    const usage = kwh / annualDivisor;
    return {
      key: month,
      label: monthLabel(month),
      shortLabel: shortMonthLabel(month),
      kwh: usage,
      cost: costResult.totalCost * (usage / totalKwh),
    };
  });
}

function hourlyUsageCostMetrics(
  intervals: NormalizedInterval[],
  costResult: RateComparisonResult,
): UsageCostPoint[] {
  const schedule = timeOfDaySchedule();
  const todAdjustmentTotal = costResult.timeOfDayAllocation
    ? costResult.timeOfDayAllocation.reduce((total, period) => total + period.amount, 0)
    : 0;
  const nonTodCostPerKwh = costResult.totalKwh
    ? (costResult.totalCost - todAdjustmentTotal) / costResult.totalKwh
    : 0;
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    kwh: 0,
    cost: 0,
    count: 0,
  }));

  for (const interval of intervals) {
    const item = hourly[interval.localStart.hour];
    const todPeriod = schedule
      ? findTodPeriodForMinute(
          schedule,
          interval.localStart.hour * 60 + interval.localStart.minute,
        )
      : undefined;
    const adjustment = costResult.timeOfDayAllocation && todPeriod
      ? todPeriod.adjustmentPerKwh
      : 0;
    item.kwh += interval.consumptionKwh;
    item.cost += interval.consumptionKwh * (nonTodCostPerKwh + adjustment);
    item.count += 1;
  }

  return hourly.map((item) => {
    const todPeriod = schedule ? findTodPeriodForHour(schedule, item.hour) : undefined;
    const adjustment = todPeriod ? roundAdjustment(todPeriod.adjustmentPerKwh) : 0;
    return {
      key: String(item.hour),
      label: formatHourLabel(item.hour),
      shortLabel: String(item.hour),
      kwh: item.count ? item.kwh / item.count : 0,
      cost: item.count ? item.cost / item.count : 0,
      usageClassName: todClassForAdjustment(adjustment),
      detail: todPeriod
        ? `${todPeriod.label} ${formatCentsPerKwh(todPeriod.adjustmentPerKwh)}`
        : undefined,
    };
  });
}

function groupIntervalsByYearMonth(intervals: NormalizedInterval[]): Map<string, NormalizedInterval[]> {
  const groups = new Map<string, NormalizedInterval[]>();
  for (const interval of intervals) {
    const key = `${String(interval.localStart.year).padStart(4, "0")}-${String(
      interval.localStart.month,
    ).padStart(2, "0")}`;
    const group = groups.get(key) ?? [];
    group.push(interval);
    groups.set(key, group);
  }

  return new Map([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function analysisPeriodFromIntervals(
  intervals: NormalizedInterval[],
  cadenceMinutes: number,
): AnalysisPeriod {
  const sorted = [...intervals].sort((left, right) => left.epochMs - right.epochMs);
  const first = sorted[0];
  const last = sorted.at(-1)!;
  const endEpochMsExclusive = last.epochMs + cadenceMinutes * 60_000;
  return {
    startEpochMs: first.epochMs,
    endEpochMsExclusive,
    startLocal: epochToWallKey(first.epochMs, activeTimezone()),
    endLocal: epochToWallKey(endEpochMsExclusive, activeTimezone()),
    serviceDays: calendarDaysBetween(first.epochMs, endEpochMsExclusive, activeTimezone()),
    intervalCount: sorted.length,
    totalKwh: sorted.reduce((total, interval) => total + interval.consumptionKwh, 0),
  };
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
    <div class="heatmap" tabindex="0" role="img" aria-label="Day and hour electricity use intensity heatmap">
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
              return `<i style="opacity:${alpha}"><title>${day} ${formatHourLabel(hour)} average ${formatKwh(value)}</title></i>`;
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
      <div class="tod-clock" role="img" aria-label="24 hour time-band adjustment map">
        ${Array.from({ length: 24 }, (_, hour) => {
          const period = findTodPeriodForHour(schedule, hour);
          const adjustment = roundAdjustment(period.adjustmentPerKwh);
          return `
            <span class="${todClassForAdjustment(adjustment)}">
              <title>${formatHourLabel(hour)} ${period.label} ${formatCentsPerKwh(period.adjustmentPerKwh)}</title>
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
                      ? `${period.label} ${formatClockRange(period.startTime, period.endTime)}`
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
        <span>${renderTrimmedText(result.label, 42)}</span>
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
                  <td>${renderTrimmedText(component.label, 46)}</td>
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
      <span>Meter ${renderTrimmedText(meter.meterDisplay, 36)}</span>
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
    ? ` (${formatLocalDateTimeRange(issue.range.startLocal, issue.range.endLocal)})`
    : "";
  return `
    <div class="issue ${issue.severity}">
      <strong>${escapeHtml(readableSeverity(issue.severity))}</strong>
      <span>${escapeHtml(formatGeneratedMessage(issue.message))}${range}</span>
    </div>
  `;
}

function renderNotice(kind: "good" | "info" | "warning" | "error", message: string): string {
  return `<div class="notice ${kind}">${renderTrimmedText(formatGeneratedMessage(message), 180)}</div>`;
}

function bindEvents(): void {
  document.querySelector<HTMLInputElement>("#fileInput")?.addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    void handleFiles(input.files ? [...input.files] : []);
  });

  document.querySelectorAll<HTMLButtonElement>("[data-example-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void handleExampleLoad(button.dataset.exampleId ?? "");
    });
  });

  document.querySelectorAll<HTMLInputElement>("[data-rate-path]").forEach((input) => {
    input.addEventListener("change", () => {
      applyRateControl(input);
    });
  });

  document.querySelector<HTMLButtonElement>("#toggleAssumptions")?.addEventListener("click", () => {
    state.rateAssumptionsExpanded = !state.rateAssumptionsExpanded;
    render();
  });

  document.querySelector<HTMLButtonElement>("#unlockRateConfig")?.addEventListener("click", () => {
    if (state.rateAssumptionsUnlocked) {
      state.rateAssumptionsUnlocked = false;
      render();
      return;
    }

    const confirmed = window.confirm(
      "Unlock rate assumptions for editing? Changes affect all comparison results in this browser session and should be verified against current BC Hydro tariff information.",
    );
    if (confirmed) {
      state.rateAssumptionsUnlocked = true;
      state.rateAssumptionsExpanded = true;
      render();
    }
  });

  document.querySelector<HTMLButtonElement>("#resetRateConfig")?.addEventListener("click", () => {
    state.rateConfigUserModified = false;
    state.rateAssumptionsUnlocked = false;
    state.rateAssumptionsExpanded = true;
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
    const periods = meter ? currentPeriods(meter) : [];
    if (meter && periods.length && state.rateConfig) {
      void Promise.all([loadRatesModule(), import("./domain/export")]).then(([, { comparisonSummaryCsv }]) => {
        const bundle = calculateAverageComparisonsFn!(meter, periods, state.rateConfig!);
        downloadText("bchydro-rate-comparison.csv", comparisonSummaryCsv(bundle));
      });
    }
  });

  document.querySelector<HTMLButtonElement>("#copyComparison")?.addEventListener("click", () => {
    void copyCurrentComparisonSummary();
  });

  document.querySelector<HTMLButtonElement>("#downloadValidation")?.addEventListener("click", () => {
    const meter = currentMeter();
    if (meter) {
      void import("./domain/export").then(({ validationReportCsv }) => {
        downloadText("bchydro-validation-report.csv", validationReportCsv(meter));
      });
    }
  });

  document.querySelector<HTMLButtonElement>("#printReport")?.addEventListener("click", () => {
    window.print();
  });
}

async function copyCurrentComparisonSummary(): Promise<void> {
  const meter = currentMeter();
  const periods = meter ? currentPeriods(meter) : [];
  if (!meter || !periods.length || !state.rateConfig) {
    state.comparisonCopyStatus = "error";
    render();
    return;
  }

  try {
    await loadRatesModule();
    const bundle = calculateAverageComparisonsFn!(meter, periods, state.rateConfig);
    await navigator.clipboard.writeText(comparisonSummaryText(bundle));
    state.comparisonCopyStatus = "copied";
  } catch {
    state.comparisonCopyStatus = "error";
  }

  render();
  window.setTimeout(() => {
    state.comparisonCopyStatus = undefined;
    render();
  }, 3200);
}

function comparisonSummaryText(bundle: ComparisonBundle): string {
  const lines = [
    "BC Hydro residential rate comparison",
    `${bundle.isAverage ? "Average annual" : "Annual"} period: ${formatDateRangePlain(bundle.period.startLocal, bundle.period.endLocal)}`,
    `Usage: ${formatKwh(bundle.period.totalKwh)}`,
    "",
    "Ranked annual totals:",
  ];

  bundle.results.forEach((result, index) => {
    const cheapest = bundle.results[0].totalCost;
    const delta = result.totalCost - cheapest;
    lines.push(
      `${index + 1}. ${result.label}: ${formatCurrency(result.totalCost)} (${formatCurrency(delta)} from lowest; ${formatKwh(result.totalKwh)})`,
    );
  });

  lines.push("");
  lines.push(
    "Calculator results are estimates for comparison only and are not a BC Hydro bill or official tariff interpretation.",
  );
  return lines.join("\n");
}

function applyRateControl(input: HTMLInputElement): void {
  if (!state.rateConfig || !state.rateAssumptionsUnlocked) {
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
  state.comparisonCopyStatus = undefined;
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
  await handleTextFiles(textFiles);
}

async function handleExampleLoad(exampleId: string): Promise<void> {
  const example = EXAMPLE_EXPORTS.find((item) => item.id === exampleId);
  if (!example) {
    return;
  }

  try {
    const response = await fetch(example.url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await handleTextFiles([{ name: example.fileName, text: await response.text() }]);
  } catch (error) {
    state.exampleLoadError = `Unable to load ${example.label}: ${
      error instanceof Error ? error.message : String(error)
    }`;
    render();
  }
}

async function handleTextFiles(textFiles: TextFileInput[]): Promise<void> {
  const [{ parseConsumptionFiles }, { analyzeUploads }] = await Promise.all([
    import("./domain/csv"),
    loadValidationModule(),
    loadRatesModule(),
  ]);
  const parsed = parseConsumptionFiles(textFiles);
  state.parsedRecords = parsed.records;
  state.fileSummaries = parsed.fileSummaries;
  state.parseIssues = parsed.issues;
  state.exampleLoadError = undefined;
  state.comparisonCopyStatus = undefined;
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
  if (!analyzeUploadsFn) {
    return;
  }

  state.upload = analyzeUploadsFn(
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

function currentPeriods(meter: MeterAnalysis): AnalysisPeriod[] {
  if (!meter.completePeriods.length) {
    return [];
  }

  const index = currentPeriodIndex(meter);
  if (index === AVERAGE_PERIOD_INDEX) {
    return meter.completePeriods;
  }

  return [meter.completePeriods[index] ?? meter.completePeriods.at(-1)!];
}

function currentPeriodIndex(meter: MeterAnalysis): number {
  if (!meter.completePeriods.length) {
    return AVERAGE_PERIOD_INDEX;
  }

  const stored = state.selectedPeriodIndex[meter.meterKey];
  if (stored !== undefined) {
    return stored === AVERAGE_PERIOD_INDEX && meter.completePeriods.length === 1
      ? 0
      : stored;
  }

  return meter.completePeriods.length > 1 ? AVERAGE_PERIOD_INDEX : 0;
}

function intervalsForPeriods(
  intervals: NormalizedInterval[],
  periods: AnalysisPeriod[],
): NormalizedInterval[] {
  if (!intervalsForPeriodFn) {
    return [];
  }

  return periods.flatMap((period) => intervalsForPeriodFn!(intervals, period));
}

async function loadValidationModule(): Promise<typeof import("./domain/validation")> {
  const module = await import("./domain/validation");
  analyzeUploadsFn = module.analyzeUploads;
  intervalsForPeriodFn = module.intervalsForPeriod;
  return module;
}

async function loadRatesModule(): Promise<typeof import("./domain/rates")> {
  const module = await import("./domain/rates");
  calculateComparisonsFn = module.calculateComparisons;
  calculateAverageComparisonsFn = module.calculateAverageComparisons;
  validateRateConfigFn = module.validateRateConfig;
  return module;
}

function summarizePeriods(periods: AnalysisPeriod[]): AnalysisPeriod {
  if (!periods.length) {
    return {
      startEpochMs: 0,
      endEpochMsExclusive: 0,
      startLocal: "n/a",
      endLocal: "n/a",
      serviceDays: 0,
      intervalCount: 0,
      totalKwh: 0,
    };
  }

  const first = periods[0];
  const last = periods.at(-1)!;
  return {
    startEpochMs: first.startEpochMs,
    endEpochMsExclusive: last.endEpochMsExclusive,
    startLocal: first.startLocal,
    endLocal: last.endLocal,
    serviceDays: average(periods.map((period) => period.serviceDays)),
    intervalCount: Math.round(average(periods.map((period) => period.intervalCount))),
    totalKwh: average(periods.map((period) => period.totalKwh)),
  };
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

function formatAxisKwh(value: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 10 ? 0 : 1,
    notation: value >= 10_000 ? "compact" : "standard",
  }).format(value);
}

function formatAxisCurrency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: state.rateConfig?.currency ?? "CAD",
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: value >= 10 ? 0 : 2,
    notation: value >= 10_000 ? "compact" : "standard",
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatGeneratedMessage(message: string): string {
  return formatGeneratedMessageFallback(
    message.replace(LOCAL_DATE_TIME_PATTERN, (value) => formatLocalDateTimePlain(value)),
  );
}

function formatGeneratedMessageFallback(value: string): string {
  return value
    .replace(/\b1 interval\(s\)/g, "1 interval")
    .replace(/\b(\d+) interval\(s\)/g, "$1 intervals")
    .replace(/\bn\/a\b/gi, "Not available")
    .replace(/T(?=\d{2}:\d{2}\b)/g, " ");
}

function formatHourLabel(hour: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, 0, 1, hour)));
}

function formatClockRange(start: string, end: string): string {
  return `${formatClockTime(start)} to ${formatClockTime(end)}`;
}

function formatClockTime(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return value;
  }

  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    timeZone: "UTC",
  };
  if (minute !== 0) {
    options.minute = "2-digit";
  }

  return new Intl.DateTimeFormat(undefined, options).format(
    new Date(Date.UTC(2000, 0, 1, hour, minute)),
  );
}

function readableSeverity(severity: ValidationIssue["severity"]): string {
  if (severity === "error") {
    return "Needs attention";
  }

  return severity.charAt(0).toUpperCase() + severity.slice(1);
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

function renderValueList(
  values: string[],
  options: { itemLength?: number; maxItems?: number } = {},
): string {
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (!cleaned.length) {
    return `<span class="empty-value">Not supplied</span>`;
  }

  const itemLength = options.itemLength ?? 32;
  const maxItems = options.maxItems ?? 2;
  const fullValue = cleaned.join(", ");
  const visible = cleaned
    .slice(0, maxItems)
    .map((value) => renderTrimmedText(value, itemLength))
    .join('<span class="value-separator">, </span>');
  const remaining = cleaned.length - maxItems;

  return `
    <span class="value-list" title="${escapeAttribute(fullValue)}">
      ${visible}
      ${
        remaining > 0
          ? `<em class="value-more" aria-label="${remaining} more value${remaining === 1 ? "" : "s"}">+${remaining} more</em>`
          : ""
      }
    </span>
  `;
}

function renderTrimmedText(value: string, maxLength = 56): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return `<span class="empty-value">Not supplied</span>`;
  }

  const readable = formatGeneratedMessage(normalized);
  const clipped = clipMiddle(readable, maxLength);
  const title = clipped === readable
    ? ""
    : ` title="${escapeAttribute(readable)}" aria-label="${escapeAttribute(readable)}"`;
  return `<span class="text-clip"${title}>${escapeHtml(clipped)}</span>`;
}

function clipMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 8) {
    return value.slice(0, maxLength);
  }

  const tailLength = Math.max(4, Math.floor(maxLength * 0.34));
  const headLength = Math.max(1, maxLength - tailLength - 3);
  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}

function average(values: number[]): number {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function groupByMonth(
  intervals: NormalizedInterval[],
  groupByCalendarMonth = false,
): Map<string, number> {
  const groups = new Map<string, number>();
  for (const interval of intervals) {
    const monthNumber = String(interval.localStart.month).padStart(2, "0");
    const month = groupByCalendarMonth
      ? monthNumber
      : `${String(interval.localStart.year).padStart(4, "0")}-${monthNumber}`;
    groups.set(month, (groups.get(month) ?? 0) + interval.consumptionKwh);
  }

  return new Map([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function monthLabel(month: string): string {
  const parts = month.split("-").map(Number);
  const year = parts.length === 2 ? parts[0] : 2000;
  const monthNumber = parts.length === 2 ? parts[1] : parts[0];
  const date = new Date(Date.UTC(year, monthNumber - 1, 1));
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    ...(parts.length === 2 ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(date);
}

function shortMonthLabel(month: string): string {
  const parts = month.split("-").map(Number);
  const year = parts.length === 2 ? parts[0] : 2000;
  const monthNumber = parts.length === 2 ? parts[1] : parts[0];
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
  const urlPattern = /(https:\/\/[^\s]+)/g;
  let output = "";
  let lastIndex = 0;
  for (const match of text.matchAll(urlPattern)) {
    const url = match[0];
    const index = match.index ?? 0;
    output += escapeHtml(text.slice(lastIndex, index));
    output += `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer" title="${escapeAttribute(
      url,
    )}">${escapeHtml(clipMiddle(url, 64))}</a>`;
    lastIndex = index + url.length;
  }

  output += escapeHtml(text.slice(lastIndex));
  return output;
}
