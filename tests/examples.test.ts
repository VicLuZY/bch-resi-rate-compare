import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseConsumptionFiles } from "../src/domain/csv";
import { analyzeUploads } from "../src/domain/validation";
import { referenceRateConfig } from "./referenceData";

const examples = [
  {
    fileName: "bchydro-example-ev-charging-no-electric-heat.csv",
    holder: "Example EV Charging Household",
    meter: "EXAMPLE-EV-001",
  },
  {
    fileName: "bchydro-example-electric-baseboard-no-ev.csv",
    holder: "Example Electric Heat Household",
    meter: "EXAMPLE-HEAT-002",
  },
];

describe("example exports", () => {
  it.each(examples)("$fileName is loadable and identifies the profile", (example) => {
    const text = readFileSync(`public/examples/${example.fileName}`, "utf8");
    expect(text).toContain(example.holder);
    expect(text).toContain(example.meter);

    const parsed = parseConsumptionFiles([{ name: example.fileName, text }]);
    const analysis = analyzeUploads(
      parsed.records,
      parsed.fileSummaries,
      parsed.issues,
      referenceRateConfig.timezone,
    );
    const meter = analysis.meters[0];

    expect(parsed.issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
    expect(meter.issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
    expect(meter.completePeriods).toHaveLength(3);
    expect(meter.customerNames).toEqual([example.holder]);
    expect(meter.meterNumbers).toEqual([example.meter]);
  }, 20_000);
});
