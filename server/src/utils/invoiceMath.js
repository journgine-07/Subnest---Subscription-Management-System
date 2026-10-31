// Pure functions (no database) for money, discounts and invoice totals, so they are easy to test.
export const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Used for the "monthly recurring revenue" figure on the dashboard.
export const MONTHLY_FACTOR = { daily: 365 / 12, weekly: 52 / 12, monthly: 1, yearly: 1 / 12 };

// "Due in 15 days" -> 15, "Immediate" -> 0, anything else -> 7.
export function dueDaysFromTerms(terms) {
  const text = String(terms || '');
  if (/immediate|on receipt/i.test(text)) return 0;
  const n = Number(text.match(/(\d+)/)?.[1]);
  return Number.isFinite(n) ? Math.min(n, 365) : 7;
}

// Checks one discount rule against a list of lines ({product, quantity, unitPrice}).
// Returns null if the rule does not apply, otherwise { discount, amount, perLine[] }.
// A discount is never larger than the amount of the lines it applies to (never below zero).
export function evaluateDiscount(d, lines, now = new Date()) {
  if (!d || !d.active) return null;
  if (d.startDate && new Date(d.startDate) > now) return null;
  if (d.endDate && new Date(d.endDate) < now) return null;
  if (d.maxUses && (d.usedCount || 0) >= d.maxUses) return null;

  const productIds = (d.products || []).map(String);
  const productScoped = d.appliesTo === 'products';
  const eligible = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !productScoped || productIds.includes(String(line.product)));

  const base = money(eligible.reduce((sum, { line }) => sum + line.quantity * line.unitPrice, 0));
  const quantity = eligible.reduce((sum, { line }) => sum + line.quantity, 0);
  if (base <= 0) return null;
  if (base < (d.minimumPurchase || 0)) return null;
  if (quantity < (d.minimumQuantity || 1)) return null;

  let amount = d.type === 'percentage' ? money(base * Math.min(Number(d.value), 100) / 100) : money(d.value);
  amount = Math.max(0, Math.min(amount, base));
  if (amount <= 0) return null;

  // Spread the discount over the eligible lines in proportion to their value.
  const perLine = new Array(lines.length).fill(0);
  let remaining = amount;
  eligible.forEach(({ line, index }, k) => {
    const gross = money(line.quantity * line.unitPrice);
    const share = k === eligible.length - 1 ? remaining : money(amount * gross / base);
    perLine[index] = Math.max(0, Math.min(share, gross, remaining));
    remaining = money(remaining - perLine[index]);
  });
  return { discount: d, amount: money(perLine.reduce((s, x) => s + x, 0)), perLine };
}

// Builds final invoice lines and totals. Tax is charged on the discounted amount of each line.
export function computeInvoice(lines, evaluation = null) {
  let subtotal = 0, discountTotal = 0, taxTotal = 0;
  const out = lines.map((line, i) => {
    const gross = money(line.quantity * line.unitPrice);
    const discount = Math.min(gross, evaluation?.perLine[i] || 0);
    const amount = money(gross - discount);
    const taxAmount = money(amount * (line.taxRate || 0) / 100);
    subtotal += gross; discountTotal += discount; taxTotal += taxAmount;
    return { ...line, discount: money(discount), amount, taxAmount };
  });
  subtotal = money(subtotal); discountTotal = money(discountTotal); taxTotal = money(taxTotal);
  return { lines: out, subtotal, discountTotal, taxTotal, total: money(Math.max(0, subtotal - discountTotal + taxTotal)) };
}
