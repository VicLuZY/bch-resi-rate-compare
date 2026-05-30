import Papa from "papaparse";
import {
  parseLocalDateTime,
  wallKey,
} from "./datetime";
import type {
  FileSummary,
  ParsedConsumptionRecord,
  ValidationIssue,
} from "./types";

type FieldRole =
  | "customerName"
  | "accountNumber"
  | "meterNumber"
  | "intervalStart"
  | "timeOfDayPeriod"
  | "inflowKwh"
  | "outflowKwh"
  | "netKwh"
  | "demandKw"
  | "powerFactor"
  | "estimatedUsage"
  | "serviceAddress"
  | "city";

export interface SourceSchema {
  fields: Record<FieldRole, string[]>;
}

export interface ParseResult {
  records: ParsedConsumptionRecord[];
  fileSummaries: FileSummary[];
  issues: ValidationIssue[];
}

export const DEFAULT_BCHYDRO_SCHEMA: SourceSchema = {
  fields: {
    customerName: ["Account Holder"],
    accountNumber: ["Account Number"],
    meterNumber: ["Meter Number"],
    intervalStart: ["Interval Start Date/Time"],
    timeOfDayPeriod: ["Time of Day Period"],
    inflowKwh: ["Inflow (kWh)"],
    outflowKwh: ["Outflow (kWh)"],
    netKwh: ["Net Consumption (kWh)"],
    demandKw: ["Demand (kW)"],
    powerFactor: ["Power Factor (%)"],
    estimatedUsage: ["Estimated Usage"],
    serviceAddress: ["Service Address"],
    city: ["City"],
  },
};

export interface TextFileInput {
  name: string;
  text: string;
}

export function parseConsumptionFiles(
  files: TextFileInput[],
  schema: SourceSchema = DEFAULT_BCHYDRO_SCHEMA,
): ParseResult {
  const records: ParsedConsumptionRecord[] = [];
  const fileSummaries: FileSummary[] = [];
  const issues: ValidationIssue[] = [];

  for (const file of files) {
    const result = parseConsumptionFile(file, schema);
    records.push(...result.records);
    fileSummaries.push(result.summary);
    issues.push(...result.issues);
  }

  return { records, fileSummaries, issues };
}

export function parseConsumptionFile(
  file: TextFileInput,
  schema: SourceSchema = DEFAULT_BCHYDRO_SCHEMA,
): {
  records: ParsedConsumptionRecord[];
  summary: FileSummary;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const records: ParsedConsumptionRecord[] = [];

  const parsed = Papa.parse<Record<string, string>>(file.text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
  });

  if (parsed.errors.length) {
    for (const error of parsed.errors) {
      issues.push({
        severity: "error",
        code: "csv_parse_error",
        fileName: file.name,
        message: error.message,
      });
    }
  }

  const headers = parsed.meta.fields ?? [];
  const fieldMap = mapFields(headers, schema);
  const required: FieldRole[] = ["meterNumber", "intervalStart"];
  for (const role of required) {
    if (!fieldMap[role]) {
      issues.push({
        severity: "error",
        code: "missing_required_column",
        fileName: file.name,
        message: `Missing required column for ${role}.`,
      });
    }
  }

  if (!fieldMap.netKwh && !fieldMap.inflowKwh) {
    issues.push({
      severity: "error",
      code: "missing_consumption_column",
      fileName: file.name,
      message: "Missing a usable consumption column.",
    });
  }

  let previousWallKey: string | undefined;
  for (const [index, row] of parsed.data.entries()) {
    const rowNumber = index + 2;
    if (isBlankRow(row)) {
      continue;
    }

    if (!fieldMap.meterNumber || !fieldMap.intervalStart) {
      continue;
    }

    const meterValue = read(row, fieldMap.meterNumber);
    const timestampValue = read(row, fieldMap.intervalStart);
    if (!meterValue || !timestampValue) {
      issues.push({
        severity: "error",
        code: "missing_required_value",
        fileName: file.name,
        rowNumbers: [rowNumber],
        message: "A row is missing meter number or interval start.",
      });
      continue;
    }

    let localStart;
    try {
      localStart = parseLocalDateTime(timestampValue);
    } catch (error) {
      issues.push({
        severity: "error",
        code: "invalid_timestamp",
        fileName: file.name,
        rowNumbers: [rowNumber],
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const currentWallKey = wallKey(localStart);
    if (previousWallKey && currentWallKey < previousWallKey) {
      issues.push({
        severity: "warning",
        code: "out_of_order_row",
        fileName: file.name,
        rowNumbers: [rowNumber],
        message: "Rows are not ordered chronologically in the source file.",
      });
    }
    previousWallKey = currentWallKey;

    const inflow = parseOptionalNumber(read(row, fieldMap.inflowKwh));
    const outflow = parseOptionalNumber(read(row, fieldMap.outflowKwh));
    const net = parseOptionalNumber(read(row, fieldMap.netKwh));
    const basis = chooseConsumptionBasis(net, inflow, outflow);

    if (!basis.ok) {
      issues.push({
        severity: "error",
        code: basis.code,
        fileName: file.name,
        rowNumbers: [rowNumber],
        message: basis.message,
      });
      continue;
    }

    if (basis.consumptionKwh < 0) {
      issues.push({
        severity: "error",
        code: "negative_consumption",
        fileName: file.name,
        rowNumbers: [rowNumber],
        message: "Negative consumption is outside this residential comparison model.",
      });
      continue;
    }

    if (outflow !== undefined && outflow > 0.001) {
      issues.push({
        severity: "warning",
        code: "exported_energy_detected",
        fileName: file.name,
        rowNumbers: [rowNumber],
        message:
          "Exported energy was detected. Net metering and self-generation are outside the comparison scope.",
      });
    }

    if (
      inflow !== undefined &&
      outflow !== undefined &&
      net !== undefined &&
      Math.abs(inflow - outflow - net) > 0.01
    ) {
      issues.push({
        severity: "warning",
        code: "inflow_net_mismatch",
        fileName: file.name,
        rowNumbers: [rowNumber],
        message: "Inflow, outflow, and net consumption do not reconcile.",
      });
    }

    records.push({
      meterKey: normalizeIdentifier(meterValue),
      meterDisplay: cleanDisplayIdentifier(meterValue),
      meterNumber: cleanDisplayIdentifier(meterValue),
      customerName: cleanText(read(row, fieldMap.customerName)),
      accountKey: normalizeOptionalIdentifier(read(row, fieldMap.accountNumber)),
      accountNumber: cleanDisplayIdentifier(read(row, fieldMap.accountNumber)),
      serviceAddressKey: normalizeOptionalAddress(read(row, fieldMap.serviceAddress)),
      serviceAddress: cleanText(read(row, fieldMap.serviceAddress)),
      city: cleanText(read(row, fieldMap.city)),
      localStart,
      wallKey: currentWallKey,
      timeOfDayLabel: cleanText(read(row, fieldMap.timeOfDayPeriod)),
      consumptionKwh: basis.consumptionKwh,
      inflowKwh: inflow,
      outflowKwh: outflow,
      netKwh: net,
      estimated: parseBooleanish(read(row, fieldMap.estimatedUsage)),
      source: {
        fileName: file.name,
        rowNumber,
      },
    });
  }

  const meterKeys = [...new Set(records.map((record) => record.meterKey))].sort();
  const localKeys = records.map((record) => record.wallKey).sort();
  return {
    records,
    issues,
    summary: {
      fileName: file.name,
      rowCount: parsed.data.length,
      acceptedRows: records.length,
      meterKeys,
      firstLocal: localKeys[0],
      lastLocal: localKeys.at(-1),
    },
  };
}

function mapFields(
  headers: string[],
  schema: SourceSchema,
): Partial<Record<FieldRole, string>> {
  const normalizedHeaderSet = new Set(headers);
  const result: Partial<Record<FieldRole, string>> = {};
  for (const [role, labels] of Object.entries(schema.fields) as Array<
    [FieldRole, string[]]
  >) {
    const match = labels.map(normalizeHeader).find((label) => normalizedHeaderSet.has(label));
    if (match) {
      result[role] = match;
    }
  }

  return result;
}

function read(row: Record<string, string>, field?: string): string | undefined {
  if (!field) {
    return undefined;
  }

  return row[field];
}

function normalizeHeader(header: string): string {
  return header.trim().replace(/\s+/g, " ").toLowerCase();
}

function cleanText(value?: string): string | undefined {
  const text = value?.trim();
  if (!text || text.toUpperCase() === "N/A") {
    return undefined;
  }

  return text;
}

function parseOptionalNumber(value?: string): number | undefined {
  const text = cleanText(value);
  if (!text) {
    return undefined;
  }

  const normalized = text.replace(/[$,%\s]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function chooseConsumptionBasis(
  net?: number,
  inflow?: number,
  outflow?: number,
):
  | { ok: true; consumptionKwh: number }
  | { ok: false; code: string; message: string } {
  if (net !== undefined && (outflow === undefined || Math.abs(outflow) <= 0.001)) {
    return { ok: true, consumptionKwh: net };
  }

  if (inflow !== undefined) {
    return { ok: true, consumptionKwh: inflow };
  }

  if (net !== undefined) {
    return { ok: true, consumptionKwh: net };
  }

  return {
    ok: false,
    code: "invalid_consumption",
    message: "No numeric consumption value was available for this interval.",
  };
}

function parseBooleanish(value?: string): boolean {
  const text = value?.trim().toLowerCase();
  if (!text || text === "n/a") {
    return false;
  }

  return !["false", "no", "n", "0"].includes(text);
}

function normalizeIdentifier(value: string): string {
  const cleaned = value.trim().replace(/^'+/, "").replace(/\s+/g, "");
  return cleaned.toUpperCase();
}

function normalizeOptionalIdentifier(value?: string): string | undefined {
  const text = cleanText(value);
  return text ? normalizeIdentifier(text) : undefined;
}

function normalizeOptionalAddress(value?: string): string | undefined {
  const text = cleanText(value);
  return text?.toUpperCase().replace(/\s+/g, " ");
}

function cleanDisplayIdentifier(value?: string): string {
  return value?.trim().replace(/^'+/, "") ?? "";
}

function isBlankRow(row: Record<string, string>): boolean {
  return Object.values(row).every((value) => !value || !value.trim());
}
