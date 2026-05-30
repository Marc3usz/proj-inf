export type WeekRange = { date_from: Date; date_to: Date };

const defaultTimeZone = 'Europe/Warsaw';

function formatter(timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});
}

type DateParts = { year: number; month: number; day: number };
type DateTimeParts = DateParts & { hour: number; minute: number; second: number };

export function previousFullWeekWarsaw(now: Date): WeekRange {
  return previousFullWeek(now, defaultTimeZone);
}

export function previousFullWeek(now: Date, timeZone = defaultTimeZone): WeekRange {
  const localNow = getDateTimeParts(now, timeZone);
  const localDay = getIsoWeekday(localNow);
  const thisMondayDate = addUtcDays(
    Date.UTC(localNow.year, localNow.month - 1, localNow.day),
    -localDay + 1
  );
  const previousMondayDate = addUtcDays(thisMondayDate.getTime(), -7);
  const dateFromParts = getUtcDateParts(previousMondayDate);
  const dateToStartParts = getUtcDateParts(thisMondayDate);

  return {
    date_from: localDateTimeToUtc({ ...dateFromParts, hour: 0, minute: 0, second: 0 }, 0, timeZone),
    date_to: new Date(
      localDateTimeToUtc({ ...dateToStartParts, hour: 0, minute: 0, second: 0 }, 0, timeZone).getTime() - 1
    )
  };
}

function getDateTimeParts(date: Date, timeZone: string): DateTimeParts {
  const entries = formatter(timeZone)
    .formatToParts(date)
    .filter((part) => part.type !== 'literal')
    .map((part) => [part.type, Number(part.value)] as const);
  const parts = Object.fromEntries(entries) as Record<keyof DateTimeParts, number>;

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

function getIsoWeekday(date: DateParts): number {
  const day = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

function addUtcDays(timestamp: number, days: number): Date {
  return new Date(timestamp + days * 24 * 60 * 60 * 1000);
}

function getUtcDateParts(date: Date): DateParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function localDateTimeToUtc(parts: DateTimeParts, millisecond: number, timeZone: string): Date {
  const wallClockUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    millisecond
  );
  const firstGuess = new Date(wallClockUtc - getOffsetMilliseconds(new Date(wallClockUtc), timeZone));
  const offset = getOffsetMilliseconds(firstGuess, timeZone);

  return new Date(wallClockUtc - offset);
}

function getOffsetMilliseconds(date: Date, timeZone: string): number {
  const parts = getDateTimeParts(date, timeZone);
  const wallClockUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    date.getUTCMilliseconds()
  );

  return wallClockUtc - date.getTime();
}
