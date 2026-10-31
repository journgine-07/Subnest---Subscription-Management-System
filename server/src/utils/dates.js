// All billing date maths is done in UTC so results do not depend on the server time zone.
export const MS_DAY = 86400000;

// Add whole months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28/29).
export function addMonthsClamped(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1,
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, lastDay));
  return t;
}

// Start of billing period number `n` (0 = first). Always measured from the anchor date so
// month-end dates never drift (Jan 31 -> Feb 28 -> Mar 31, not Mar 28).
export function periodStart(anchor, frequency, n) {
  const a = new Date(anchor);
  switch (frequency) {
    case 'daily': return new Date(a.getTime() + n * MS_DAY);
    case 'weekly': return new Date(a.getTime() + n * 7 * MS_DAY);
    case 'monthly': return addMonthsClamped(a, n);
    case 'yearly': return addMonthsClamped(a, 12 * n);
    default: throw new Error(`Unknown billing frequency: ${frequency}`);
  }
}

// Returns a valid Date or null. Accepts "YYYY-MM-DD" or any ISO string.
export function parseDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// A date-only value (midnight UTC) becomes the last millisecond of that day, so "end date"
// fields are inclusive.
export function endOfDayUTC(date) {
  const d = new Date(date);
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0) {
    return new Date(d.getTime() + MS_DAY - 1);
  }
  return d;
}
