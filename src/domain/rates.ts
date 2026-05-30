import { minuteOfDay } from "./datetime";
import { intervalsForPeriod } from "./validation";
import type {
  AnalysisPeriod,
  AppliedPercentage,
  ComparisonBundle,
  CostComponent,
  FlatSchedule,
  MeterAnalysis,
  NormalizedInterval,
  RateComparisonResult,
  RateConfig,
  RateOption,
  RateSchedule,
  SourcePointer,
  TieredSchedule,
  TimeOfDaySchedule,
} from "./types";

export function validateRateConfig(config: RateConfig): string[] {
  const errors: string[] = [];

  if (!config.timezone) {
    errors.push("Rate configuration is missing a timezone.");
  }

  for (const option of config.comparisonOptions) {
    const base = config.schedules[option.baseScheduleId];
    if (!base) {
      errors.push(`Option ${option.id} references missing base schedule.`);
    } else if (base.type !== "tiered" && base.type !== "flat") {
      errors.push(`Option ${option.id} must reference a tiered or flat base schedule.`);
    }

    if (option.timeOfDayScheduleId) {
      const tod = config.schedules[option.timeOfDayScheduleId];
      if (!tod || tod.type !== "timeOfDay") {
        errors.push(`Option ${option.id} references a missing time-band schedule.`);
      }
    }
  }

  for (const schedule of Object.values(config.schedules)) {
    if (schedule.type === "tiered" && !schedule.tiers.length) {
      errors.push(`${schedule.id} has no tiers.`);
    }

    if (schedule.type === "timeOfDay" && !schedule.periods.length) {
      errors.push(`${schedule.id} has no time-band periods.`);
    }
  }

  return errors;
}

export function calculateComparisons(
  meter: MeterAnalysis,
  period: AnalysisPeriod,
  config: RateConfig,
): ComparisonBundle {
  const configErrors = validateRateConfig(config);
  if (configErrors.length) {
    throw new Error(configErrors.join(" "));
  }

  const intervals = intervalsForPeriod(meter.intervals, period);
  const results = config.comparisonOptions
    .map((option) => calculateOption(option, intervals, period, config))
    .sort((left, right) => left.totalCost - right.totalCost);

  return {
    meterKey: meter.meterKey,
    period,
    configId: config.id,
    configVersion: config.version,
    results,
  };
}

function calculateOption(
  option: RateOption,
  intervals: NormalizedInterval[],
  period: AnalysisPeriod,
  config: RateConfig,
): RateComparisonResult {
  const baseSchedule = config.schedules[option.baseScheduleId];
  const components: CostComponent[] = [];
  const totalKwh = sum(intervals.map((interval) => interval.consumptionKwh));
  let tierAllocation: RateComparisonResult["tierAllocation"];
  let timeOfDayAllocation: RateComparisonResult["timeOfDayAllocation"];

  if (baseSchedule.type === "tiered") {
    const calculated = calculateTiered(baseSchedule, totalKwh, period, intervals);
    components.push(...calculated.components);
    tierAllocation = calculated.tierAllocation;
  } else if (baseSchedule.type === "flat") {
    components.push(...calculateFlat(baseSchedule, totalKwh, period, intervals));
  } else {
    throw new Error(`${baseSchedule.id} cannot be used as a base schedule.`);
  }

  appendPercentageComponents(components, baseSchedule.riders ?? [], "rider");

  if (option.timeOfDayScheduleId) {
    const schedule = config.schedules[option.timeOfDayScheduleId];
    if (schedule.type !== "timeOfDay") {
      throw new Error(`${schedule.id} is not a time-band schedule.`);
    }
    const calculated = calculateTimeOfDay(schedule, intervals);
    components.push(...calculated.components);
    timeOfDayAllocation = calculated.allocation;
    appendPercentageComponents(components, schedule.riders ?? [], "rider");
  }

  appendPercentageComponents(components, config.levies ?? [], "levy");
  appendPercentageComponents(components, config.taxes ?? [], "tax");

  return {
    optionId: option.id,
    label: option.label,
    totalCost: sum(components.map((component) => component.amount)),
    totalKwh,
    serviceDays: period.serviceDays,
    components,
    tierAllocation,
    timeOfDayAllocation,
  };
}

function calculateTiered(
  schedule: TieredSchedule,
  totalKwh: number,
  period: AnalysisPeriod,
  intervals: NormalizedInterval[],
): {
  components: CostComponent[];
  tierAllocation: NonNullable<RateComparisonResult["tierAllocation"]>;
} {
  const basicAmount = period.serviceDays * schedule.basicChargePerDay;
  const components: CostComponent[] = [
    {
      id: `${schedule.id}.basic`,
      label: `${schedule.label} basic charge`,
      category: "basic",
      quantity: period.serviceDays,
      unit: "day",
      rate: schedule.basicChargePerDay,
      amount: basicAmount,
    },
  ];

  let remaining = totalKwh;
  const tierAllocation = schedule.tiers.map((tier) => {
    const limit =
      tier.limitKwhPerDay === undefined
        ? remaining
        : tier.limitKwhPerDay * period.serviceDays;
    const kwh = Math.max(0, Math.min(remaining, limit));
    remaining -= kwh;
    const amount = kwh * tier.ratePerKwh;
    return {
      tierId: tier.id,
      label: tier.label,
      kwh,
      rate: tier.ratePerKwh,
      amount,
    };
  });

  for (const tier of tierAllocation) {
    components.push({
      id: `${schedule.id}.${tier.tierId}`,
      label: tier.label,
      category: "tierEnergy",
      quantity: tier.kwh,
      unit: "kWh",
      rate: tier.rate,
      amount: tier.amount,
      trace: traceForIntervals(intervals),
    });
  }

  return { components, tierAllocation };
}

function calculateFlat(
  schedule: FlatSchedule,
  totalKwh: number,
  period: AnalysisPeriod,
  intervals: NormalizedInterval[],
): CostComponent[] {
  return [
    {
      id: `${schedule.id}.basic`,
      label: `${schedule.label} basic charge`,
      category: "basic",
      quantity: period.serviceDays,
      unit: "day",
      rate: schedule.basicChargePerDay,
      amount: period.serviceDays * schedule.basicChargePerDay,
    },
    {
      id: `${schedule.id}.energy`,
      label: `${schedule.label} energy charge`,
      category: "baseEnergy",
      quantity: totalKwh,
      unit: "kWh",
      rate: schedule.energyRatePerKwh,
      amount: totalKwh * schedule.energyRatePerKwh,
      trace: traceForIntervals(intervals),
    },
  ];
}

function calculateTimeOfDay(
  schedule: TimeOfDaySchedule,
  intervals: NormalizedInterval[],
): {
  components: CostComponent[];
  allocation: NonNullable<RateComparisonResult["timeOfDayAllocation"]>;
} {
  const periodState = new Map<
    string,
    {
      label: string;
      kwh: number;
      intervalCount: number;
      adjustmentPerKwh: number;
      intervals: NormalizedInterval[];
    }
  >();

  for (const period of schedule.periods) {
    periodState.set(period.id, {
      label: period.label,
      kwh: 0,
      intervalCount: 0,
      adjustmentPerKwh: period.adjustmentPerKwh,
      intervals: [],
    });
  }

  for (const interval of intervals) {
    const period = findTimeOfDayPeriod(schedule, minuteOfDay(interval.localStart));
    if (!period) {
      throw new Error(
        `${schedule.id} has no period covering ${interval.wallKey.slice(11)}.`,
      );
    }

    const state = periodState.get(period.id)!;
    state.kwh += interval.consumptionKwh;
    state.intervalCount += 1;
    state.intervals.push(interval);
  }

  const allocation = [...periodState.entries()].map(([periodId, state]) => ({
    periodId,
    label: state.label,
    kwh: state.kwh,
    intervalCount: state.intervalCount,
    adjustmentPerKwh: state.adjustmentPerKwh,
    amount: state.kwh * state.adjustmentPerKwh,
  }));

  const components = allocation
    .filter((period) => Math.abs(period.amount) > 0)
    .map((period) => ({
      id: `${schedule.id}.${period.periodId}`,
      label: `${schedule.label} ${period.label}`,
      category: "timeOfDayAdjustment",
      quantity: period.kwh,
      unit: "kWh",
      rate: period.adjustmentPerKwh,
      amount: period.amount,
      trace: traceForIntervals(periodState.get(period.periodId)!.intervals),
    }));

  return { components, allocation };
}

function findTimeOfDayPeriod(
  schedule: TimeOfDaySchedule,
  minute: number,
): TimeOfDaySchedule["periods"][number] | undefined {
  return schedule.periods.find((period) => {
    const start = parseClockMinutes(period.startTime);
    const end = parseClockMinutes(period.endTime);
    if (start === end) {
      return true;
    }

    if (start < end) {
      return minute >= start && minute < end;
    }

    return minute >= start || minute < end;
  });
}

function appendPercentageComponents(
  components: CostComponent[],
  percentages: AppliedPercentage[],
  category: "rider" | "levy" | "tax",
): void {
  for (const percentage of percentages) {
    if (percentage.enabled === false) {
      continue;
    }

    const basis = basisForPercentage(components, percentage);
    if (Math.abs(basis.amount) <= Number.EPSILON && percentage.rate === 0) {
      continue;
    }

    components.push({
      id: percentage.id,
      label: percentage.label,
      category,
      quantity: basis.amount,
      unit: "currency",
      rate: percentage.rate,
      amount: basis.amount * percentage.rate,
      sourceComponentIds: basis.componentIds,
    });
  }
}

function basisForPercentage(
  components: CostComponent[],
  percentage: AppliedPercentage,
): { amount: number; componentIds: string[] } {
  const componentIds: string[] = [];
  let amount = 0;

  for (const component of components) {
    const selected =
      percentage.appliesTo.includes(component.id) ||
      percentage.appliesTo.includes(component.category) ||
      (percentage.appliesTo.includes("subtotalBeforeRiders") &&
        !["rider", "levy", "tax"].includes(component.category)) ||
      (percentage.appliesTo.includes("subtotalBeforeTaxes") &&
        component.category !== "tax");

    if (selected) {
      amount += component.amount;
      componentIds.push(component.id);
    }
  }

  return { amount, componentIds };
}

function traceForIntervals(intervals: NormalizedInterval[]): CostComponent["trace"] {
  if (!intervals.length) {
    return undefined;
  }

  const sorted = [...intervals].sort((left, right) => left.epochMs - right.epochMs);
  return {
    intervalCount: intervals.length,
    sourceFiles: [...new Set(intervals.map((interval) => interval.source.fileName))].sort(),
    firstRow: sourcePointer(sorted[0]),
    lastRow: sourcePointer(sorted.at(-1)!),
  };
}

function sourcePointer(interval: NormalizedInterval): SourcePointer {
  return {
    fileName: interval.source.fileName,
    rowNumber: interval.source.rowNumber,
  };
}

function parseClockMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`Invalid clock time: ${value}`);
  }

  return hour * 60 + minute;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

export function scheduleById(config: RateConfig, id: string): RateSchedule | undefined {
  return config.schedules[id];
}
