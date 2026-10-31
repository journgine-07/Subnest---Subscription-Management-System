import test from 'node:test';
import assert from 'node:assert/strict';
import { periodStart } from '../src/utils/dates.js';

// Mirrors the loop in runDueBilling: every period whose start <= now is billed exactly once, in order.
function periodsDue(anchor, freq, billedCycles, now) {
  const out = []; let cycle = billedCycles;
  while (periodStart(anchor, freq, cycle) <= now) { out.push(cycle); cycle++; }
  return { out, next: periodStart(anchor, freq, cycle) };
}
test('catch-up bills every missed monthly period, none skipped, none repeated', () => {
  const anchor = new Date('2026-01-15T00:00:00Z');
  const first = periodsDue(anchor, 'monthly', 0, new Date('2026-04-20T00:00:00Z'));
  assert.deepEqual(first.out, [0, 1, 2, 3]);                           // Jan, Feb, Mar, Apr
  assert.equal(first.next.toISOString().slice(0, 10), '2026-05-15');
  assert.deepEqual(periodsDue(anchor, 'monthly', 4, new Date('2026-04-20T00:00:00Z')).out, []);   // re-run: nothing
});
test('nothing due before the first period starts', () => {
  assert.deepEqual(periodsDue(new Date('2027-01-01T00:00:00Z'), 'weekly', 0, new Date('2026-12-01T00:00:00Z')).out, []);
});
