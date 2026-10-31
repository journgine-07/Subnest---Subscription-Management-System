import test from 'node:test';
import assert from 'node:assert/strict';
import { periodStart, endOfDayUTC } from '../src/utils/dates.js';
import { computeInvoice, dueDaysFromTerms, evaluateDiscount, money } from '../src/utils/invoiceMath.js';
import { passwordOK, emailOK } from '../src/utils/validators.js';

const iso = d => d.toISOString().slice(0, 10);

test('password policy: >8 chars, upper, lower, special', () => {
  assert.equal(passwordOK('Abcdef1!x'), true);     // 9 chars
  assert.equal(passwordOK('Abcdef!x'), false);     // exactly 8
  assert.equal(passwordOK('abcdefgh!x'), false);   // no uppercase
  assert.equal(passwordOK('ABCDEFGH!X'), false);   // no lowercase
  assert.equal(passwordOK('Abcdefghix'), false);   // no special
  assert.equal(passwordOK({ $gt: '' }), false);    // non-string input
  assert.equal(emailOK('a@b.co'), true);
  assert.equal(emailOK('nope'), false);
});

test('monthly periods never drift from a month-end anchor', () => {
  const anchor = new Date('2026-01-31T00:00:00Z');
  assert.deepEqual([1, 2, 3, 4].map(n => iso(periodStart(anchor, 'monthly', n))), ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.equal(iso(periodStart(new Date('2026-01-30T00:00:00Z'), 'monthly', 2)), '2026-03-30');
});
test('yearly, weekly, daily periods; leap day clamps', () => {
  assert.equal(iso(periodStart(new Date('2024-02-29T00:00:00Z'), 'yearly', 1)), '2025-02-28');
  assert.equal(iso(periodStart(new Date('2024-02-29T00:00:00Z'), 'yearly', 4)), '2028-02-29');
  assert.equal(iso(periodStart(new Date('2026-10-01T00:00:00Z'), 'weekly', 2)), '2026-10-15');
  assert.equal(iso(periodStart(new Date('2026-12-30T00:00:00Z'), 'daily', 3)), '2027-01-02');
});
test('endOfDayUTC makes date-only end dates inclusive', () => {
  assert.equal(endOfDayUTC(new Date('2026-11-30T00:00:00Z')).toISOString(), '2026-11-30T23:59:59.999Z');
  assert.equal(endOfDayUTC(new Date('2026-11-30T10:00:00Z')).toISOString(), '2026-11-30T10:00:00.000Z');
});
test('payment terms -> due days', () => {
  assert.equal(dueDaysFromTerms('Due in 15 days'), 15);
  assert.equal(dueDaysFromTerms('Immediate'), 0);
  assert.equal(dueDaysFromTerms(undefined), 7);
});

const lines = [
  { product: 'A', quantity: 2, unitPrice: 1000, taxRate: 18 },
  { product: 'B', quantity: 1, unitPrice: 500, taxRate: 5 }
];
const base = { active: true, type: 'percentage', value: 10, appliesTo: 'subscriptions', usedCount: 0 };

test('invoice totals without discount', () => {
  const r = computeInvoice(lines);
  assert.equal(r.subtotal, 2500); assert.equal(r.discountTotal, 0);
  assert.equal(r.taxTotal, 385); assert.equal(r.total, 2885);   // 360 + 25 tax
});
test('whole-subscription percentage discount; tax is on the discounted amount', () => {
  const r = computeInvoice(lines, evaluateDiscount(base, lines));
  assert.equal(r.discountTotal, 250); assert.equal(r.taxTotal, 346.5); assert.equal(r.total, 2596.5);
});
test('product-specific discount only touches matching lines', () => {
  const ev = evaluateDiscount({ ...base, appliesTo: 'products', products: ['A'] }, lines);
  const r = computeInvoice(lines, ev);
  assert.equal(r.discountTotal, 200);
  assert.equal(r.lines[1].discount, 0);
});
test('fixed discount can never take an invoice below zero', () => {
  const ev = evaluateDiscount({ ...base, type: 'fixed', value: 99999 }, lines);
  const r = computeInvoice(lines, ev);
  assert.equal(r.discountTotal, 2500); assert.equal(r.total, 0);
  const full = computeInvoice(lines, evaluateDiscount({ ...base, value: 150 }, lines));  // % above 100 is capped
  assert.ok(full.total >= 0);
});
test('discount rules: minimums, dates, usage', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  assert.equal(evaluateDiscount({ ...base, minimumPurchase: 5000 }, lines, now), null);
  assert.equal(evaluateDiscount({ ...base, minimumQuantity: 10 }, lines, now), null);
  assert.equal(evaluateDiscount({ ...base, startDate: new Date('2026-07-01') }, lines, now), null);
  assert.equal(evaluateDiscount({ ...base, endDate: new Date('2026-06-01') }, lines, now), null);
  assert.equal(evaluateDiscount({ ...base, maxUses: 3, usedCount: 3 }, lines, now), null);
  assert.ok(evaluateDiscount({ ...base, maxUses: 3, usedCount: 2 }, lines, now));
  assert.equal(evaluateDiscount({ ...base, active: false }, lines, now), null);
  assert.equal(evaluateDiscount({ ...base, appliesTo: 'products', products: ['Z'] }, lines, now), null);
});
test('rounding: discount shares add up exactly', () => {
  const odd = [{ product: 'A', quantity: 1, unitPrice: 33.33, taxRate: 18 }, { product: 'A', quantity: 1, unitPrice: 33.33, taxRate: 18 }, { product: 'A', quantity: 1, unitPrice: 33.34, taxRate: 18 }];
  const ev = evaluateDiscount({ ...base, type: 'fixed', value: 10 }, odd);
  const r = computeInvoice(odd, ev);
  assert.equal(r.discountTotal, 10);
  assert.equal(money(r.lines.reduce((s, l) => s + l.discount, 0)), 10);
});
