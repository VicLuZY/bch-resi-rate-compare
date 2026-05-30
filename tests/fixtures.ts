import { Temporal } from "@js-temporal/polyfill";
import type { RateConfig } from "../src/domain/types";

export const TEST_TIMEZONE = "Canada/Pacific";

export interface SyntheticRow {
  meter: string;
  account: string;
  localStart: string;
  kwh: number;
  outflow?: number;
  estimated?: boolean;
  address?: string;
  city?: string;
}

export const syntheticRateConfig: RateConfig = {
  id: "synthetic-benchmark",
  version: "test",
  label: "Synthetic benchmark rates",
  currency: "CAD",
  timezone: TEST_TIMEZONE,
  sourceNotes: ["Synthetic fixture; not tariff data."],
  rounding: { displayDecimals: 2 },
  schedules: {
    RS1101: {
      id: "RS1101",
      label: "Tiered test",
      type: "tiered",
      basicChargePerDay: 0.25,
      tiers: [
        {
          id: "tier1",
          label: "Tier 1",
          limitKwhPerDay: 10,
          ratePerKwh: 0.1,
        },
        {
          id: "tier2",
          label: "Tier 2",
          ratePerKwh: 0.2,
        },
      ],
      riders: [
        {
          id: "base-rider",
          label: "Base rider",
          rate: 0.1,
          appliesTo: ["basic", "tierEnergy"],
        },
      ],
    },
    RS1151: {
      id: "RS1151",
      label: "Flat test",
      type: "flat",
      basicChargePerDay: 0.2,
      energyRatePerKwh: 0.15,
      riders: [
        {
          id: "base-rider",
          label: "Base rider",
          rate: 0.1,
          appliesTo: ["basic", "baseEnergy"],
        },
      ],
    },
    RS2101: {
      id: "RS2101",
      label: "Time-band test",
      type: "timeOfDay",
      periods: [
        {
          id: "overnight",
          label: "Overnight",
          startTime: "23:00",
          endTime: "07:00",
          adjustmentPerKwh: -0.02,
        },
        {
          id: "off_peak_day",
          label: "Off-peak",
          startTime: "07:00",
          endTime: "16:00",
          adjustmentPerKwh: 0,
        },
        {
          id: "on_peak",
          label: "On-peak",
          startTime: "16:00",
          endTime: "21:00",
          adjustmentPerKwh: 0.05,
        },
        {
          id: "off_peak_late",
          label: "Off-peak",
          startTime: "21:00",
          endTime: "23:00",
          adjustmentPerKwh: 0,
        },
      ],
      riders: [],
    },
  },
  comparisonOptions: [
    {
      id: "RS1101",
      label: "RS 1101",
      baseScheduleId: "RS1101",
    },
    {
      id: "RS1101_RS2101",
      label: "RS 1101 + RS 2101",
      baseScheduleId: "RS1101",
      timeOfDayScheduleId: "RS2101",
    },
    {
      id: "RS1151",
      label: "RS 1151",
      baseScheduleId: "RS1151",
    },
    {
      id: "RS1151_RS2101",
      label: "RS 1151 + RS 2101",
      baseScheduleId: "RS1151",
      timeOfDayScheduleId: "RS2101",
    },
  ],
  levies: [],
  taxes: [],
};

export function generateRows(options: {
  start: string;
  end: string;
  meter?: string;
  account?: string;
  kwh?: number | ((dateTime: Temporal.ZonedDateTime) => number);
  estimatedEvery?: number;
}): SyntheticRow[] {
  const meter = options.meter ?? "MTR0001";
  const account = options.account ?? "SYNTHETIC-ACCOUNT";
  const start = Temporal.ZonedDateTime.from(`${options.start}[${TEST_TIMEZONE}]`);
  const end = Temporal.ZonedDateTime.from(`${options.end}[${TEST_TIMEZONE}]`);
  const rows: SyntheticRow[] = [];
  let epochMs = start.epochMilliseconds;
  let index = 0;
  while (epochMs < end.epochMilliseconds) {
    const instant = Temporal.Instant.fromEpochMilliseconds(epochMs);
    const zoned = instant.toZonedDateTimeISO(TEST_TIMEZONE);
    const localStart = zoned
      .toPlainDateTime()
      .toString({ smallestUnit: "minute" })
      .replace("T", " ");
    rows.push({
      meter,
      account,
      localStart,
      kwh:
        typeof options.kwh === "function"
          ? options.kwh(zoned)
          : (options.kwh ?? 1),
      estimated:
        options.estimatedEvery !== undefined && index % options.estimatedEvery === 0,
      address: "SYNTHETIC SERVICE ADDRESS",
      city: "SAMPLE CITY",
    });
    epochMs += 3_600_000;
    index += 1;
  }
  return rows;
}

export function rowsToCsv(rows: SyntheticRow[]): string {
  return [
    [
      "Account Holder",
      "Account Number",
      "Meter Number",
      "Interval Start Date/Time",
      "Time of Day Period",
      "Inflow (kWh)",
      "Outflow (kWh)",
      "Net Consumption (kWh)",
      "Demand (kW)",
      "Power Factor (%)",
      "Estimated Usage",
      "Service Address",
      "City",
    ].join(","),
    ...rows.map((row) =>
      [
        "Synthetic User",
        `'${row.account}`,
        row.meter,
        row.localStart,
        "N/A",
        row.kwh.toFixed(3),
        (row.outflow ?? 0).toFixed(3),
        (row.kwh - (row.outflow ?? 0)).toFixed(3),
        "N/A",
        "N/A",
        row.estimated ? "Y" : "",
        row.address ?? "SYNTHETIC SERVICE ADDRESS",
        row.city ?? "SAMPLE CITY",
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
}

export function malformedCsv(): string {
  return [
    "Account Holder,Interval Start Date/Time,Net Consumption (kWh)",
    "Synthetic User,2024-01-01 00:00,1.0",
  ].join("\n");
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
