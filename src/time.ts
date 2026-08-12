/**
 * Converts a wall-clock date/time in an IANA timezone to the corresponding UTC
 * instant. Implemented with Intl so the tool stays dependency-free and stays
 * correct across DST transitions.
 */
export function zonedWallClockToUtc(
  date: string,
  timeOfDay: string,
  timeZone: string,
): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = timeOfDay.split(':').map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new Error(`invalid date/time: ${date} ${timeOfDay}`);
  }

  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  // First pass: offset at the naive instant. Second pass: offset at the
  // corrected instant, which handles slots that sit next to a DST change.
  let guess = naiveUtc - offsetMs(new Date(naiveUtc), timeZone);
  guess = naiveUtc - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const field = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (value === undefined) throw new Error(`missing ${type} for zone ${timeZone}`);
    return Number(value);
  };

  const asUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour') % 24,
    field('minute'),
    field('second'),
  );
  return asUtc - instant.getTime();
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`invalid date: ${date}`);
  }
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}
