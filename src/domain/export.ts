import type { ComparisonBundle, MeterAnalysis, RateComparisonResult } from "./types";

export function comparisonSummaryCsv(bundle: ComparisonBundle): string {
  const rows = [
    [
      "meter",
      "basis",
      "source_periods",
      "period_start",
      "period_end",
      "rate_option",
      "total_kwh",
      "service_days",
      "annual_cost",
      "component",
      "component_amount",
    ],
  ];

  for (const result of bundle.results) {
    for (const component of result.components) {
      rows.push([
        bundle.meterKey,
        bundle.periodLabel,
        formatNumber(bundle.sourcePeriods.length),
        bundle.period.startLocal,
        bundle.period.endLocal,
        result.label,
        formatNumber(result.totalKwh),
        formatNumber(result.serviceDays),
        formatNumber(result.totalCost),
        component.label,
        formatNumber(component.amount),
      ]);
    }
  }

  return rows.map(csvRow).join("\n");
}

export function validationReportCsv(meter: MeterAnalysis): string {
  const rows = [["meter", "severity", "code", "message", "range_start", "range_end"]];
  for (const issue of meter.issues) {
    rows.push([
      meter.meterKey,
      issue.severity,
      issue.code,
      issue.message,
      issue.range?.startLocal ?? "",
      issue.range?.endLocal ?? "",
    ]);
  }

  return rows.map(csvRow).join("\n");
}

export function rankedTotals(results: RateComparisonResult[]): Array<{
  option: string;
  total: number;
  differenceFromCheapest: number;
}> {
  const cheapest = Math.min(...results.map((result) => result.totalCost));
  return results.map((result) => ({
    option: result.label,
    total: result.totalCost,
    differenceFromCheapest: result.totalCost - cheapest,
  }));
}

function csvRow(values: Array<string | number>): string {
  return values
    .map((value) => {
      const text = String(value);
      if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
      }

      return text;
    })
    .join(",");
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "";
}
