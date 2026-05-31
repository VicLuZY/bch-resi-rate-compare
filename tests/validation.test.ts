import { describe, expect, it } from "vitest";
import { parseConsumptionFiles } from "../src/domain/csv";
import { analyzeUploads } from "../src/domain/validation";
import {
  rowsForPeriod,
  malformedCsv,
  rowsToCsv,
  referenceRateConfig,
  TEST_TIMEZONE,
} from "./referenceData";

function analyzeCsvs(csvs: string[]) {
  const parsed = parseConsumptionFiles(
    csvs.map((text, index) => ({ name: `reference-${index + 1}.csv`, text })),
  );
  return analyzeUploads(
    parsed.records,
    parsed.fileSummaries,
    parsed.issues,
    referenceRateConfig.timezone,
  );
}

describe("upload validation", () => {
  it("accepts a complete leap-year dataset with daylight-saving transitions", () => {
    const rows = rowsForPeriod({
      start: "2024-01-01T00:00",
      end: "2025-01-01T00:00",
      kwh: 1,
    });

    const springSkipped = rows.filter((row) => row.localStart === "2024-03-10 02:00");
    const fallRepeated = rows.filter((row) => row.localStart === "2024-11-03 01:00");
    const analysis = analyzeCsvs([rowsToCsv(rows)]);
    const meter = analysis.meters[0];

    expect(springSkipped).toHaveLength(0);
    expect(fallRepeated).toHaveLength(2);
    expect(meter.issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
    expect(meter.completePeriods).toHaveLength(1);
    expect(meter.selectedPeriod?.intervalCount).toBe(8784);
    expect(meter.selectedPeriod?.serviceDays).toBe(366);
    expect(meter.customerNames).toEqual(["Reference User"]);
    expect(meter.accountNumbers).toEqual(["REFERENCE-ACCOUNT"]);
    expect(meter.serviceAddresses).toEqual(["REFERENCE SERVICE ADDRESS"]);
  });

  it("merges segmented files for the same meter into one complete annual period", () => {
    const rows = rowsForPeriod({
      start: "2024-01-01T00:00",
      end: "2025-01-01T00:00",
      meter: "MTR-SEGMENTED",
      kwh: 1.25,
    });
    const first = rows.slice(0, 4_400);
    const second = rows.slice(4_400);

    const analysis = analyzeCsvs([rowsToCsv(first), rowsToCsv(second)]);
    const meter = analysis.meters[0];

    expect(meter.fileNames).toHaveLength(2);
    expect(meter.completePeriods).toHaveLength(1);
    expect(meter.selectedPeriod?.totalKwh).toBeCloseTo(10_980);
  });

  it("finds non-overlapping complete years for a three-year export", () => {
    const rows = rowsForPeriod({
      start: "2023-05-30T00:00",
      end: "2026-05-30T00:00",
      kwh: 1,
    });

    const analysis = analyzeCsvs([rowsToCsv(rows)]);
    const meter = analysis.meters[0];

    expect(meter.issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
    expect(meter.completePeriods).toHaveLength(3);
    expect(meter.completePeriods.map((period) => period.startLocal)).toEqual([
      "2023-05-30T00:00",
      "2024-05-30T00:00",
      "2025-05-30T00:00",
    ]);
    expect(meter.completePeriods.at(-1)?.endLocal).toBe("2026-05-30T00:00");
  }, 15_000);

  it("deduplicates exact overlap rows from segmented exports", () => {
    const rows = rowsForPeriod({
      start: "2024-01-01T00:00",
      end: "2025-01-01T00:00",
      kwh: 1,
    });
    const first = rows.slice(0, 5_000);
    const second = rows.slice(4_900);

    const analysis = analyzeCsvs([rowsToCsv(first), rowsToCsv(second)]);
    const meter = analysis.meters[0];

    expect(meter.intervals).toHaveLength(8_784);
    expect(meter.issues.some((issue) => issue.code === "exact_duplicate_deduped")).toBe(true);
    expect(meter.completePeriods).toHaveLength(1);
  });

  it("rejects conflicting overlap rows instead of averaging them", () => {
    const rows = rowsForPeriod({
      start: "2024-01-01T00:00",
      end: "2025-01-01T00:00",
      kwh: 1,
    });
    const overlap = rows.slice(100, 120).map((row, index) => ({
      ...row,
      kwh: index === 0 ? row.kwh + 3 : row.kwh,
    }));

    const analysis = analyzeCsvs([rowsToCsv(rows), rowsToCsv(overlap)]);
    const meter = analysis.meters[0];

    expect(meter.issues.some((issue) => issue.code === "conflicting_duplicate_interval")).toBe(
      true,
    );
    expect(meter.issues.some((issue) => issue.severity === "error")).toBe(true);
  });

  it("reports missing intervals and refuses a dataset with less than one valid year", () => {
    const rows = rowsForPeriod({
      start: "2024-01-01T00:00",
      end: "2025-01-01T00:00",
      kwh: 1,
    });
    rows.splice(2_000, 1);

    const analysis = analyzeCsvs([rowsToCsv(rows)]);
    const meter = analysis.meters[0];

    expect(meter.gaps).toHaveLength(1);
    expect(meter.completePeriods).toHaveLength(0);
    expect(meter.issues.some((issue) => issue.code === "less_than_one_complete_year")).toBe(
      true,
    );
  });

  it("flags malformed exports with missing required fields", () => {
    const analysis = analyzeCsvs([malformedCsv()]);

    expect(analysis.issues.some((issue) => issue.code === "missing_required_column")).toBe(
      true,
    );
    expect(analysis.meters).toHaveLength(0);
  });

  it("warns about generation-like outflow and estimated intervals", () => {
    const rows = rowsForPeriod({
      start: "2024-01-01T00:00",
      end: "2025-01-01T00:00",
      estimatedEvery: 1000,
      kwh: 1,
    });
    rows[10].outflow = 0.5;

    const analysis = analyzeCsvs([rowsToCsv(rows)]);
    const meter = analysis.meters[0];

    expect(analysis.issues.some((issue) => issue.code === "exported_energy_detected")).toBe(
      true,
    );
    expect(meter.issues.some((issue) => issue.code === "estimated_intervals")).toBe(true);
  });

  it("uses the configured Pacific timezone for validation", () => {
    expect(TEST_TIMEZONE).toBe("Canada/Pacific");
  });
});
