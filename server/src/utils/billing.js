import { Discount, Invoice, Plan, Subscription } from '../models/index.js';
import { nextNumber } from './counters.js';
import { MS_DAY, periodStart } from './dates.js';
import { computeInvoice, dueDaysFromTerms, evaluateDiscount } from './invoiceMath.js';

const MAX_CATCH_UP = 366; // periods billed per subscription per run; the next run carries on

// Take one use of a discount. The check and the increment happen in one atomic update,
// so two simultaneous invoices can never both take the last remaining use.
async function reserveDiscountUse(id) {
  const updated = await Discount.findOneAndUpdate(
    { _id: id, active: true, $or: [{ maxUses: null }, { $expr: { $lt: ['$usedCount', '$maxUses'] } }] },
    { $inc: { usedCount: 1 } }, { new: true });
  return Boolean(updated);
}
const releaseDiscountUse = id => Discount.updateOne({ _id: id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
export { releaseDiscountUse };

// Creates the invoice for one billing period, or reports that it already exists.
async function makeInvoice({ sub, plan, cycle, autoDiscounts, now }) {
  const start = periodStart(sub.billingAnchor, plan.billingFrequency, cycle);
  const end = periodStart(sub.billingAnchor, plan.billingFrequency, cycle + 1);
  const billingKey = `${sub._id}:${start.toISOString().slice(0, 10)}`;
  if (await Invoice.exists({ billingKey })) return { created: false };

  const lines = sub.items.map(x => ({
    product: x.product, description: x.description, variantName: x.variantName,
    quantity: x.quantity, unitPrice: x.unitPrice, taxRate: x.taxRate || 0
  }));

  // Candidates: the discount attached to this subscription plus every auto-apply rule.
  // The most valuable one that is still eligible (dates, minimums, usage left) is used.
  const candidates = [...autoDiscounts];
  if (sub.discount && !candidates.some(d => String(d._id) === String(sub.discount))) {
    const attached = await Discount.findById(sub.discount).lean();
    if (attached) candidates.push(attached);
  }
  const ranked = candidates.map(d => evaluateDiscount(d, lines, now)).filter(Boolean).sort((a, b) => b.amount - a.amount);
  let chosen = null;
  for (const evaluation of ranked) {
    if (await reserveDiscountUse(evaluation.discount._id)) { chosen = evaluation; break; }
  }

  const calc = computeInvoice(lines, chosen);
  try {
    const invoice = await Invoice.create({
      number: await nextNumber('INV'), billingKey, subscription: sub._id, customer: sub.customer,
      periodStart: start, periodEnd: end,
      dueDate: new Date(start.getTime() + dueDaysFromTerms(sub.paymentTerms) * MS_DAY),
      status: 'Draft', ...calc, currency: sub.currency || 'INR',
      discount: chosen?.discount._id, discountName: chosen?.discount.name
    });
    return { created: true, invoice };
  } catch (e) {
    if (chosen) await releaseDiscountUse(chosen.discount._id);        // invoice not made: give the use back
    if (e.code === 11000 && JSON.stringify(e.keyPattern || {}).includes('billingKey')) return { created: false };
    throw e;
  }
}

// Bills every Active subscription whose next billing date has arrived. Safe to run any number of
// times (scheduler + manual button): the unique billingKey stops duplicates, and every period
// since the last billed one is created in order, so nothing is skipped.
export async function runDueBilling(now = new Date()) {
  const stats = { examined: 0, invoicesCreated: 0, alreadyBilled: 0, subscriptionsClosed: 0, quotationsExpired: 0, errors: 0 };

  const expired = await Subscription.updateMany(
    { status: 'Quotation', quotationValidUntil: { $lt: now } },
    { $set: { status: 'Closed', closedAt: now, closedReason: 'Quotation expired' } });
  stats.quotationsExpired = expired.modifiedCount || 0;

  const plans = new Map((await Plan.find().lean()).map(p => [String(p._id), p]));
  const autoDiscounts = await Discount.find({ active: true, autoApply: true }).lean();
  const cursor = Subscription.find({ status: 'Active', nextBillingDate: { $lte: now } }).lean().cursor();

  for await (const sub of cursor) {
    stats.examined++;
    try {
      const plan = plans.get(String(sub.plan));
      if (!plan) continue;
      if (!sub.billingAnchor) sub.billingAnchor = sub.nextBillingDate;
      const startCycle = sub.billedCycles || 0;
      let cycle = startCycle, closed = false;

      for (let guard = 0; guard < MAX_CATCH_UP; guard++) {
        const start = periodStart(sub.billingAnchor, plan.billingFrequency, cycle);
        if (start > now) break;
        // Plan ended: stop before billing a period that begins on/after the expiry date.
        if (sub.expiryDate && start >= new Date(sub.expiryDate) && plan.autoClose) { closed = true; break; }
        const result = await makeInvoice({ sub, plan, cycle, autoDiscounts, now });
        if (result.created) stats.invoicesCreated++; else stats.alreadyBilled++;
        cycle++;
      }

      const set = { billingAnchor: sub.billingAnchor, billedCycles: cycle, nextBillingDate: periodStart(sub.billingAnchor, plan.billingFrequency, cycle) };
      if (closed) Object.assign(set, { status: 'Closed', closedAt: now, closedReason: 'Plan ended (auto-close)' });
      // Only advance if another run has not already done so.
      const r = await Subscription.updateOne({ _id: sub._id, status: 'Active', billedCycles: startCycle }, { $set: set });
      if (closed && r.modifiedCount) stats.subscriptionsClosed++;
    } catch (e) {
      stats.errors++;
      console.error(`Billing failed for subscription ${sub._id}:`, e.message);
    }
  }
  return stats;
}
