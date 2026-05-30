import { describe, expect, it } from "vitest";
import { parseConsumptionFiles } from "../src/domain/csv";
import { comparisonSummaryCsv } from "../src/domain/export";
import { calculateComparisons } from "../src/domain/rates";
import { analyzeUploads } from "../src/domain/validation";
import { generateRows, rowsToCsv, syntheticRateConfig } from "./fixtures";
import type { RateConfig } from "../src/domain/types";

function benchmarkBundle(config: RateConfig = syntheticRateConfig) {
  const rows = generateRows({
    start: "2024-01-01T00:00",
    end: "2025-01-01T00:00",
    kwh: 10,
  });
  const parsed = parseConsumptionFiles([{ name: "benchmark.csv", text: rowsToCsv(rows) }]);
  const analysis = analyzeUploads(
    parsed.records,
    parsed.fileSummaries,
    parsed.issues,
    config.timezone,
  );
  const meter = analysis.meters[0];
  if (!meter.selectedPeriod) {
    throw new Error("Expected a selected period.");
  }
  return calculateComparisons(meter, meter.selectedPeriod, config);
}

describe("rate calculations", () => {
  it("reconciles all four options to an independently prepared synthetic benchmark", () => {
    const bundle = benchmarkBundle();
    const byOption = Object.fromEntries(
      bundle.results.map((result) => [result.optionId, result]),
    );

    const days = 366;
    const totalKwh = 87_840;
    const tier1Kwh = 3_660;
    const tier2Kwh = totalKwh - tier1Kwh;
    const tieredBase = days * 0.25 + tier1Kwh * 0.1 + tier2Kwh * 0.2;
    const flatBase = days * 0.2 + totalKwh * 0.15;
    const todAdjustment = days * 8 * 10 * -0.02 + days * 5 * 10 * 0.05;

    expect(byOption.RS1101.totalCost).toBeCloseTo(tieredBase * 1.1, 6);
    expect(byOption.RS1101_RS2101.totalCost).toBeCloseTo(
      tieredBase * 1.1 + todAdjustment,
      6,
    );
    expect(byOption.RS1151.totalCost).toBeCloseTo(flatBase * 1.1, 6);
    expect(byOption.RS1151_RS2101.totalCost).toBeCloseTo(
      flatBase * 1.1 + todAdjustment,
      6,
    );

    expect(byOption.RS1101.tierAllocation?.[0].kwh).toBeCloseTo(tier1Kwh, 6);
    expect(byOption.RS1101.tierAllocation?.[1].kwh).toBeCloseTo(tier2Kwh, 6);
    expect(
      byOption.RS1151_RS2101.timeOfDayAllocation?.find(
        (period) => period.periodId === "overnight",
      )?.kwh,
    ).toBeCloseTo(days * 8 * 10, 6);
  });

  it("updates results when the editable rate configuration changes", () => {
    const original = benchmarkBundle();
    const changedConfig: RateConfig = structuredClone(syntheticRateConfig);
    const flat = changedConfig.schedules.RS1151;
    if (flat.type !== "flat") {
      throw new Error("Expected flat schedule.");
    }
    flat.energyRatePerKwh += 0.01;

    const changed = benchmarkBundle(changedConfig);
    const originalFlat = original.results.find((result) => result.optionId === "RS1151")!;
    const changedFlat = changed.results.find((result) => result.optionId === "RS1151")!;

    expect(changedFlat.totalCost - originalFlat.totalCost).toBeCloseTo(87_840 * 0.01 * 1.1);
  });

  it("itemizes enabled taxes from the editable configuration", () => {
    const taxedConfig: RateConfig = structuredClone(syntheticRateConfig);
    taxedConfig.taxes = [
      {
        id: "test-tax",
        label: "Test tax",
        rate: 0.05,
        enabled: true,
        appliesTo: ["subtotalBeforeTaxes"],
      },
    ];

    const bundle = benchmarkBundle(taxedConfig);
    const flat = bundle.results.find((result) => result.optionId === "RS1151")!;
    const taxComponent = flat.components.find((component) => component.id === "test-tax");
    const untaxedFlat = benchmarkBundle().results.find(
      (result) => result.optionId === "RS1151",
    )!;

    expect(taxComponent?.category).toBe("tax");
    expect(taxComponent?.amount).toBeCloseTo(untaxedFlat.totalCost * 0.05);
    expect(flat.totalCost).toBeCloseTo(untaxedFlat.totalCost * 1.05);
  });

  it("exports summary CSV values that match on-screen result totals", () => {
    const bundle = benchmarkBundle();
    const csv = comparisonSummaryCsv(bundle);

    for (const result of bundle.results) {
      expect(csv).toContain(result.totalCost.toFixed(6));
    }
  });
});
