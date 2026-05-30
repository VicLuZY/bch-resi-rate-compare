import { Temporal } from "@js-temporal/polyfill";

const LOCAL_DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T])(\d{2}):(\d{2})(?::(\d{2}))?$/;

export type LocalTimeStatus =
  | { kind: "normal"; epochMs: number }
  | { kind: "ambiguous"; earlierEpochMs: number; laterEpochMs: number }
  | { kind: "nonexistent"; earlierEpochMs: number; laterEpochMs: number };

export function parseLocalDateTime(input: string): Temporal.PlainDateTime {
  const value = input.trim().replace(/\//g, "-");
  const match = LOCAL_DATE_TIME_RE.exec(value);
  if (!match) {
    throw new Error(`Unsupported local date/time: ${input}`);
  }

  return new Temporal.PlainDateTime(
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    match[6] ? Number(match[6]) : 0,
  );
}

export function wallKey(dateTime: Temporal.PlainDateTime): string {
  return dateTime.toString({ smallestUnit: "minute" });
}

export function minuteOfDay(dateTime: Temporal.PlainDateTime): number {
  return dateTime.hour * 60 + dateTime.minute;
}

export function classifyLocalTime(
  dateTime: Temporal.PlainDateTime,
  timeZone: string,
): LocalTimeStatus {
  const earlier = toZonedDateTime(dateTime, timeZone, "earlier");
  const later = toZonedDateTime(dateTime, timeZone, "later");
  const earlierMatches = earlier.toPlainDateTime().equals(dateTime);
  const laterMatches = later.toPlainDateTime().equals(dateTime);

  if (earlierMatches && laterMatches) {
    if (earlier.epochMilliseconds === later.epochMilliseconds) {
      return { kind: "normal", epochMs: earlier.epochMilliseconds };
    }

    return {
      kind: "ambiguous",
      earlierEpochMs: earlier.epochMilliseconds,
      laterEpochMs: later.epochMilliseconds,
    };
  }

  return {
    kind: "nonexistent",
    earlierEpochMs: earlier.epochMilliseconds,
    laterEpochMs: later.epochMilliseconds,
  };
}

export function epochToZonedDateTime(
  epochMs: number,
  timeZone: string,
): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(
    timeZone,
  );
}

export function epochToWallKey(epochMs: number, timeZone: string): string {
  return wallKey(epochToZonedDateTime(epochMs, timeZone).toPlainDateTime());
}

export function addLocalYears(
  epochMs: number,
  timeZone: string,
  years: number,
): number {
  return epochToZonedDateTime(epochMs, timeZone).add({ years }).epochMilliseconds;
}

export function calendarDaysBetween(
  startEpochMs: number,
  endEpochMs: number,
  timeZone: string,
): number {
  const start = epochToZonedDateTime(startEpochMs, timeZone).toPlainDate();
  const end = epochToZonedDateTime(endEpochMs, timeZone).toPlainDate();
  return end.since(start).days;
}

export function hoursBetween(startEpochMs: number, endEpochMs: number): number {
  return (endEpochMs - startEpochMs) / 3_600_000;
}

function toZonedDateTime(
  dateTime: Temporal.PlainDateTime,
  timeZone: string,
  disambiguation: "earlier" | "later",
): Temporal.ZonedDateTime {
  return Temporal.ZonedDateTime.from(
    `${dateTime.toString({ smallestUnit: "minute" })}[${timeZone}]`,
    { disambiguation },
  );
}
