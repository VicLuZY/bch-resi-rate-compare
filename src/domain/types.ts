import type { Temporal } from "@js-temporal/polyfill";

export type Severity = "info" | "warning" | "error";

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  fileName?: string;
  meterKey?: string;
  rowNumbers?: number[];
  range?: {
    startLocal: string;
    endLocal: string;
  };
}

export interface SourcePointer {
  fileName: string;
  rowNumber: number;
}

export interface ParsedConsumptionRecord {
  meterKey: string;
  meterDisplay: string;
  meterNumber: string;
  customerName?: string;
  accountKey?: string;
  accountNumber?: string;
  serviceAddressKey?: string;
  serviceAddress?: string;
  city?: string;
  localStart: Temporal.PlainDateTime;
  wallKey: string;
  timeOfDayLabel?: string;
  consumptionKwh: number;
  inflowKwh?: number;
  outflowKwh?: number;
  netKwh?: number;
  estimated: boolean;
  source: SourcePointer;
}

export interface FileSummary {
  fileName: string;
  rowCount: number;
  acceptedRows: number;
  meterKeys: string[];
  firstLocal?: string;
  lastLocal?: string;
}

export interface NormalizedInterval extends ParsedConsumptionRecord {
  epochMs: number;
  duplicateOf?: SourcePointer;
}

export interface ContinuousRun {
  startEpochMs: number;
  endEpochMsExclusive: number;
  intervalCount: number;
}

export interface AnalysisPeriod {
  startEpochMs: number;
  endEpochMsExclusive: number;
  startLocal: string;
  endLocal: string;
  serviceDays: number;
  intervalCount: number;
  totalKwh: number;
}

export interface MeterAnalysis {
  meterKey: string;
  meterDisplay: string;
  meterNumbers: string[];
  customerNames: string[];
  accountNumbers: string[];
  serviceAddresses: string[];
  cities: string[];
  fileNames: string[];
  accountKeys: string[];
  serviceAddressKeys: string[];
  intervals: NormalizedInterval[];
  cadenceMinutes?: number;
  dateRange?: {
    startLocal: string;
    endLocal: string;
  };
  issues: ValidationIssue[];
  gaps: ValidationIssue[];
  completePeriods: AnalysisPeriod[];
  selectedPeriod?: AnalysisPeriod;
}

export interface UploadAnalysis {
  files: FileSummary[];
  meters: MeterAnalysis[];
  issues: ValidationIssue[];
}

export interface RateConfig {
  id: string;
  version: string;
  label: string;
  currency: string;
  timezone: string;
  sourceNotes: string[];
  rounding: {
    displayDecimals: number;
    calculationDecimals?: number;
  };
  schedules: Record<string, RateSchedule>;
  comparisonOptions: RateOption[];
  levies?: AppliedPercentage[];
  taxes?: AppliedPercentage[];
}

export type RateSchedule = TieredSchedule | FlatSchedule | TimeOfDaySchedule;

export interface BaseScheduleCommon {
  id: string;
  label: string;
  type: "tiered" | "flat" | "timeOfDay";
  riders?: AppliedPercentage[];
}

export interface TieredSchedule extends BaseScheduleCommon {
  type: "tiered";
  basicChargePerDay: number;
  tiers: Array<{
    id: string;
    label: string;
    limitKwhPerDay?: number;
    ratePerKwh: number;
  }>;
}

export interface FlatSchedule extends BaseScheduleCommon {
  type: "flat";
  basicChargePerDay: number;
  energyRatePerKwh: number;
}

export interface TimeOfDaySchedule extends BaseScheduleCommon {
  type: "timeOfDay";
  periods: TimeOfDayPeriod[];
}

export interface TimeOfDayPeriod {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  adjustmentPerKwh: number;
}

export interface AppliedPercentage {
  id: string;
  label: string;
  rate: number;
  enabled?: boolean;
  appliesTo: string[];
}

export interface RateOption {
  id: string;
  label: string;
  baseScheduleId: string;
  timeOfDayScheduleId?: string;
}

export interface CostComponent {
  id: string;
  label: string;
  category: string;
  quantity?: number;
  unit?: string;
  rate?: number;
  amount: number;
  sourceComponentIds?: string[];
  trace?: {
    intervalCount?: number;
    sourceFiles?: string[];
    firstRow?: SourcePointer;
    lastRow?: SourcePointer;
  };
}

export interface RateComparisonResult {
  optionId: string;
  label: string;
  totalCost: number;
  totalKwh: number;
  serviceDays: number;
  components: CostComponent[];
  tierAllocation?: Array<{
    tierId: string;
    label: string;
    kwh: number;
    rate: number;
    amount: number;
  }>;
  timeOfDayAllocation?: Array<{
    periodId: string;
    label: string;
    kwh: number;
    intervalCount: number;
    adjustmentPerKwh: number;
    amount: number;
  }>;
}

export interface ComparisonBundle {
  meterKey: string;
  period: AnalysisPeriod;
  configId: string;
  configVersion: string;
  results: RateComparisonResult[];
}
