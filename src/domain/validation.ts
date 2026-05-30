import {
  addLocalYears,
  calendarDaysBetween,
  classifyLocalTime,
  epochToWallKey,
  hoursBetween,
} from "./datetime";
import type {
  AnalysisPeriod,
  ContinuousRun,
  FileSummary,
  MeterAnalysis,
  NormalizedInterval,
  ParsedConsumptionRecord,
  UploadAnalysis,
  ValidationIssue,
} from "./types";

const EPSILON_MS = 1;

export function analyzeUploads(
  records: ParsedConsumptionRecord[],
  files: FileSummary[],
  parseIssues: ValidationIssue[],
  timeZone: string,
): UploadAnalysis {
  const byMeter = new Map<string, ParsedConsumptionRecord[]>();
  for (const record of records) {
    const list = byMeter.get(record.meterKey) ?? [];
    list.push(record);
    byMeter.set(record.meterKey, list);
  }

  const issues = [...parseIssues];
  if (byMeter.size > 1) {
    issues.push({
      severity: "info",
      code: "multiple_meters",
      message: "Multiple meters were detected. Results are shown per meter.",
    });
  }

  const meters = [...byMeter.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([meterKey, meterRecords]) => analyzeMeter(meterKey, meterRecords, timeZone));

  return { files, meters, issues };
}

export function analyzeMeter(
  meterKey: string,
  records: ParsedConsumptionRecord[],
  timeZone: string,
): MeterAnalysis {
  const issues: ValidationIssue[] = [];
  const meterDisplay = records[0]?.meterDisplay ?? "meter";
  const meterNumbers = compactUnique(records.map((record) => record.meterNumber));
  const customerNames = compactUnique(records.map((record) => record.customerName));
  const accountNumbers = compactUnique(records.map((record) => record.accountNumber));
  const serviceAddresses = compactUnique(records.map((record) => record.serviceAddress));
  const cities = compactUnique(records.map((record) => record.city));
  const fileNames = [...new Set(records.map((record) => record.source.fileName))].sort();
  const accountKeys = compactUnique(records.map((record) => record.accountKey));
  const serviceAddressKeys = compactUnique(
    records.map((record) => record.serviceAddressKey),
  );

  if (accountKeys.length > 1) {
    issues.push({
      severity: "warning",
      code: "meter_account_conflict",
      meterKey,
      message:
        "This meter appears with more than one account identifier. Confirm the files belong together before relying on the result.",
    });
  }

  if (serviceAddressKeys.length > 1) {
    issues.push({
      severity: "warning",
      code: "meter_address_conflict",
      meterKey,
      message:
        "This meter appears with more than one service address. Confirm the files belong together before relying on the result.",
    });
  }

  const estimatedCount = records.filter((record) => record.estimated).length;
  if (estimatedCount) {
    issues.push({
      severity: "warning",
      code: "estimated_intervals",
      meterKey,
      message: `${estimatedCount} estimated interval(s) are present and included in the comparison.`,
    });
  }

  const intervals = normalizeIntervals(meterKey, records, timeZone, issues);
  intervals.sort((left, right) => left.epochMs - right.epochMs);

  const cadenceMs = detectCadence(intervals);
  const cadenceMinutes = cadenceMs ? cadenceMs / 60_000 : undefined;
  const runs = cadenceMs ? findContinuousRuns(intervals, cadenceMs) : [];
  const gaps = cadenceMs ? findGaps(meterKey, intervals, cadenceMs, timeZone) : [];
  issues.push(...gaps);

  const completePeriods = cadenceMs
    ? findCompleteAnnualPeriods(intervals, runs, cadenceMs, timeZone)
    : [];

  if (!cadenceMs && intervals.length > 1) {
    issues.push({
      severity: "error",
      code: "cadence_unresolved",
      meterKey,
      message: "Unable to determine a stable interval cadence.",
    });
  }

  if (!completePeriods.length) {
    issues.push({
      severity: "error",
      code: "less_than_one_complete_year",
      meterKey,
      message:
        "The reconstructed meter data does not contain one complete continuous local year.",
    });
  }

  const dateRange =
    intervals.length > 0
      ? {
          startLocal: epochToWallKey(intervals[0].epochMs, timeZone),
          endLocal: epochToWallKey(intervals.at(-1)!.epochMs, timeZone),
        }
      : undefined;

  return {
    meterKey,
    meterDisplay,
    meterNumbers,
    customerNames,
    accountNumbers,
    serviceAddresses,
    cities,
    fileNames,
    accountKeys,
    serviceAddressKeys,
    intervals,
    cadenceMinutes,
    dateRange,
    issues,
    gaps,
    completePeriods,
    selectedPeriod: completePeriods.at(-1),
  };
}

export function intervalsForPeriod(
  intervals: NormalizedInterval[],
  period: AnalysisPeriod,
): NormalizedInterval[] {
  return intervals.filter(
    (interval) =>
      interval.epochMs >= period.startEpochMs &&
      interval.epochMs < period.endEpochMsExclusive,
  );
}

function normalizeIntervals(
  meterKey: string,
  records: ParsedConsumptionRecord[],
  timeZone: string,
  issues: ValidationIssue[],
): NormalizedInterval[] {
  const byWallKey = new Map<string, ParsedConsumptionRecord[]>();
  for (const record of records) {
    const list = byWallKey.get(record.wallKey) ?? [];
    list.push(record);
    byWallKey.set(record.wallKey, list);
  }

  const normalized: NormalizedInterval[] = [];

  for (const [key, group] of byWallKey.entries()) {
    const status = classifyLocalTime(group[0].localStart, timeZone);
    if (status.kind === "nonexistent") {
      issues.push({
        severity: "error",
        code: "nonexistent_local_time",
        meterKey,
        rowNumbers: group.map((record) => record.source.rowNumber),
        message:
          "A row uses a local timestamp skipped by daylight saving time and cannot be placed on the canonical timeline.",
      });
      continue;
    }

    if (status.kind === "normal") {
      const unique = uniqueByFingerprint(group);
      if (unique.length > 1) {
        issues.push({
          severity: "error",
          code: "conflicting_duplicate_interval",
          meterKey,
          rowNumbers: group.map((record) => record.source.rowNumber),
          message: `Conflicting interval values were found for ${key}.`,
        });
      } else if (group.length > 1) {
        issues.push({
          severity: "info",
          code: "exact_duplicate_deduped",
          meterKey,
          rowNumbers: group.map((record) => record.source.rowNumber),
          message: `Exact duplicate interval rows for ${key} were deduplicated.`,
        });
      }

      if (unique[0]) {
        normalized.push({ ...unique[0], epochMs: status.epochMs });
      }
      continue;
    }

    const ambiguous = reconcileAmbiguousGroup(group);
    if (!ambiguous.ok) {
      issues.push({
        severity: "error",
        code: "unresolved_dst_overlap",
        meterKey,
        rowNumbers: group.map((record) => record.source.rowNumber),
        message: `The repeated daylight-saving hour at ${key} has unresolved overlapping rows.`,
      });
      continue;
    }

    const epochs = [status.earlierEpochMs, status.laterEpochMs];
    ambiguous.records.forEach((record, index) => {
      normalized.push({ ...record, epochMs: epochs[index] });
    });
  }

  return normalized;
}

function reconcileAmbiguousGroup(
  group: ParsedConsumptionRecord[],
): { ok: true; records: ParsedConsumptionRecord[] } | { ok: false } {
  if (group.length <= 2) {
    return { ok: true, records: group };
  }

  const unique = uniqueByFingerprint(group);
  if (unique.length === 2 && group.length > unique.length) {
    return { ok: true, records: unique };
  }

  return { ok: false };
}

function uniqueByFingerprint(
  group: ParsedConsumptionRecord[],
): ParsedConsumptionRecord[] {
  const seen = new Set<string>();
  const result: ParsedConsumptionRecord[] = [];
  for (const record of group) {
    const fingerprint = [
      record.wallKey,
      record.consumptionKwh.toFixed(6),
      record.inflowKwh?.toFixed(6) ?? "",
      record.outflowKwh?.toFixed(6) ?? "",
      record.netKwh?.toFixed(6) ?? "",
      String(record.estimated),
    ].join("|");

    if (!seen.has(fingerprint)) {
      seen.add(fingerprint);
      result.push(record);
    }
  }

  return result;
}

function detectCadence(intervals: NormalizedInterval[]): number | undefined {
  if (intervals.length < 2) {
    return undefined;
  }

  const counts = new Map<number, number>();
  for (let index = 1; index < intervals.length; index += 1) {
    const diff = intervals[index].epochMs - intervals[index - 1].epochMs;
    if (diff <= 0) {
      continue;
    }
    counts.set(diff, (counts.get(diff) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}

function findContinuousRuns(
  intervals: NormalizedInterval[],
  cadenceMs: number,
): ContinuousRun[] {
  if (!intervals.length) {
    return [];
  }

  const runs: ContinuousRun[] = [];
  let runStart = intervals[0].epochMs;
  let previous = intervals[0].epochMs;
  let count = 1;

  for (let index = 1; index < intervals.length; index += 1) {
    const current = intervals[index].epochMs;
    if (Math.abs(current - previous - cadenceMs) <= EPSILON_MS) {
      previous = current;
      count += 1;
      continue;
    }

    runs.push({
      startEpochMs: runStart,
      endEpochMsExclusive: previous + cadenceMs,
      intervalCount: count,
    });
    runStart = current;
    previous = current;
    count = 1;
  }

  runs.push({
    startEpochMs: runStart,
    endEpochMsExclusive: previous + cadenceMs,
    intervalCount: count,
  });

  return runs;
}

function findGaps(
  meterKey: string,
  intervals: NormalizedInterval[],
  cadenceMs: number,
  timeZone: string,
): ValidationIssue[] {
  const gaps: ValidationIssue[] = [];
  for (let index = 1; index < intervals.length; index += 1) {
    const previous = intervals[index - 1].epochMs;
    const current = intervals[index].epochMs;
    const diff = current - previous;
    if (diff > cadenceMs + EPSILON_MS) {
      gaps.push({
        severity: "error",
        code: "missing_intervals",
        meterKey,
        message: `${Math.round(diff / cadenceMs) - 1} interval(s) are missing.`,
        range: {
          startLocal: epochToWallKey(previous + cadenceMs, timeZone),
          endLocal: epochToWallKey(current - cadenceMs, timeZone),
        },
      });
    }
  }

  return gaps;
}

function findCompleteAnnualPeriods(
  intervals: NormalizedInterval[],
  runs: ContinuousRun[],
  cadenceMs: number,
  timeZone: string,
): AnalysisPeriod[] {
  const periods: AnalysisPeriod[] = [];

  for (const run of runs) {
    const runIntervals = intervals.filter(
      (interval) =>
        interval.epochMs >= run.startEpochMs &&
        interval.epochMs < run.endEpochMsExclusive,
    );
    const prefixKwh = [0];
    for (const interval of runIntervals) {
      prefixKwh.push(prefixKwh.at(-1)! + interval.consumptionKwh);
    }

    let index = runIntervals.findIndex(
      (interval) => interval.localStart.hour === 0 && interval.localStart.minute === 0,
    );
    if (index < 0) {
      index = 0;
    }

    while (index < runIntervals.length) {
      const interval = runIntervals[index];
      const endEpochMs = addLocalYears(interval.epochMs, timeZone, 1);
      if (endEpochMs > run.endEpochMsExclusive + EPSILON_MS) {
        break;
      }

      const periodIntervalCount = Math.round((endEpochMs - interval.epochMs) / cadenceMs);
      const endIndex = index + periodIntervalCount;
      periods.push({
        startEpochMs: interval.epochMs,
        endEpochMsExclusive: endEpochMs,
        startLocal: epochToWallKey(interval.epochMs, timeZone),
        endLocal: epochToWallKey(endEpochMs, timeZone),
        serviceDays: calendarDaysBetween(interval.epochMs, endEpochMs, timeZone),
        intervalCount: periodIntervalCount,
        totalKwh: prefixKwh[endIndex] - prefixKwh[index],
      });
      index = endIndex;
    }
  }

  return periods.filter((period) => hoursBetween(period.startEpochMs, period.endEpochMsExclusive) > 0);
}

function compactUnique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}
