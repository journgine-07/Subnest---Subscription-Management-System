import { Router } from 'express';
import mongoose from 'mongoose';
import { Discount, Plan, Product, QuotationTemplate, Subscription, User } from '../models/index.js';
import { protect, allow } from '../middleware/auth.js';
import { HttpError, bad } from '../utils/errors.js';
import { MS_DAY, parseDate } from '../utils/dates.js';
import { money } from '../utils/invoiceMath.js';
import { nextNumber } from '../utils/counters.js';
import { paginate } from '../utils/paginate.js';
import { escapeRegex } from '../utils/validators.js';

const router = Router();
router.use(protect);
const canManage = allow('admin', 'staff');
const isCustomer = req => req.user.role === 'customer';

// Allowed lifecycle: Draft -> Quotation -> Confirmed -> Active -> Closed (Active <-> Paused when the plan allows it).
const TRANSITIONS = {
  Draft: ['Quotation', 'Closed'], Quotation: ['Confirmed', 'Closed'], Confirmed: ['Active', 'Closed'],
  Active: ['Paused', 'Closed'], Paused: ['Active', 'Closed'], Closed: []
};

async function buildItem(plan, quantity, variantName) {
  const product = await Product.findById(plan.product._id || plan.product).populate('taxRule');
  if (!product || !product.active) throw bad('The plan\'s product is not available.');
  const variant = variantName ? product.variants.find(v => v.name === variantName) : null;
  if (variantName && !variant) throw bad('Selected product variant was not found.');
  const unitPrice = money(plan.price + (variant?.additionalPrice || 0));   // variant price is added to the base price
  const taxRate = product.taxRule?.active ? product.taxRule.rate : 0;
  return { product: product._id, description: product.name + (variant ? ` (${variant.name})` : ''), variantName: variant?.name, quantity, unitPrice, taxRate, amount: money(quantity * unitPrice) };
}
function checkPlanBuyable(plan, quantity) {
  const now = new Date();
  if (!plan || !plan.active) throw bad('Select a valid, active plan.');
  if ((plan.availableFrom && now < plan.availableFrom) || (plan.availableUntil && now > plan.availableUntil)) throw bad('This plan is not currently available.');
  if (!Number.isInteger(quantity) || quantity < 1) throw bad('Quantity must be a whole number greater than zero.');
  if (quantity < plan.minimumQuantity) throw bad(`Minimum quantity for this plan is ${plan.minimumQuantity}.`);
}

// List (paginated). ?status=Active or ?status=Draft,Quotation &q=SUB-0001 &customer=<id> &page= &limit=
router.get('/', async (req, res) => {
  const filter = isCustomer(req) ? { customer: req.user._id } : {};
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',') };
  if (req.query.q) filter.number = new RegExp('^' + escapeRegex(String(req.query.q).trim().toUpperCase()));   // prefix search uses the index
  if (!isCustomer(req) && mongoose.isValidObjectId(req.query.customer)) filter.customer = req.query.customer;
  res.json(await paginate(Subscription, filter, req, { build: q => q.populate('customer', 'name email').populate('plan', 'name billingFrequency') }));
});

router.post('/', async (req, res) => {
  const b = req.body;
  const customerId = isCustomer(req) ? req.user._id : b.customer;
  if (!mongoose.isValidObjectId(customerId)) throw bad('Select a customer for this subscription.');
  const [plan, customer] = await Promise.all([Plan.findById(b.plan), User.findById(customerId)]);
  if (!customer || customer.role !== 'customer') throw bad('Select a valid customer account.');
  const quantity = Number(b.quantity) || 1;
  checkPlanBuyable(plan, quantity);

  const today = new Date();
  const startDate = b.startDate ? parseDate(b.startDate) : today;
  const expiryDate = b.expiryDate ? parseDate(b.expiryDate) : plan.availableUntil || undefined;
  if (!startDate || (b.expiryDate && !expiryDate)) throw bad('Enter valid start and expiry dates.');
  if (expiryDate && expiryDate <= startDate) throw bad('Expiry date must be after the start date.');

  // Only staff/admin may pick payment terms or attach a discount (customers cannot discount themselves).
  let discount;
  if (!isCustomer(req) && b.discount) {
    if (!mongoose.isValidObjectId(b.discount) || !(await Discount.exists({ _id: b.discount, active: true }))) throw bad('Selected discount was not found.');
    discount = b.discount;
  }
  const paymentTerms = !isCustomer(req) && b.paymentTerms ? String(b.paymentTerms).slice(0, 60) : undefined;
  const item = await buildItem(plan, quantity, b.variantName);
  const sub = await Subscription.create({
    number: await nextNumber('SUB'), customer: customerId, plan: plan._id,
    status: isCustomer(req) ? 'Quotation' : 'Draft',
    quotationValidUntil: isCustomer(req) ? new Date(Date.now() + 30 * MS_DAY) : undefined,
    startDate, expiryDate, nextBillingDate: startDate, billingFrequency: plan.billingFrequency,
    paymentTerms, discount, items: [item]
  });
  res.status(201).json(sub);
});

router.patch('/:id/status', async (req, res) => {
  const filter = { _id: req.params.id, ...(isCustomer(req) ? { customer: req.user._id } : {}) };
  const sub = await Subscription.findOne(filter);
  if (!sub) throw new HttpError(404, 'Subscription not found.');
  const plan = await Plan.findById(sub.plan);
  const next = req.body.status;
  const now = new Date();

  if (isCustomer(req) && next !== 'Closed') throw new HttpError(403, 'Customers can close their own subscription; staff confirm and activate it.');
  if (!TRANSITIONS[sub.status]?.includes(next)) throw bad(`Cannot change status from ${sub.status} to ${next}.`);
  if (next === 'Paused' && !plan?.allowPause) throw bad('Pausing is disabled for this plan.');
  if (next === 'Closed' && ['Active', 'Paused'].includes(sub.status) && plan && !plan.allowEarlyClose && !(sub.expiryDate && sub.expiryDate <= now)) throw bad('Early closure is disabled for this plan.');
  if (next === 'Confirmed' && sub.quotationValidUntil && sub.quotationValidUntil < now) throw bad('This quotation has expired. Create a new quotation.');
  if (next === 'Active' && sub.expiryDate && sub.expiryDate <= now) throw bad('The expiry date has already passed.');

  if (next === 'Quotation' && !sub.quotationValidUntil) sub.quotationValidUntil = new Date(Date.now() + 30 * MS_DAY);
  if (next === 'Active' && sub.status === 'Confirmed') {
    // Billing starts on the start date (or today if it is already past) — no back-billing.
    const first = sub.startDate && sub.startDate > now ? sub.startDate : now;
    Object.assign(sub, { billingFrequency: plan.billingFrequency, billingAnchor: first, billedCycles: 0, nextBillingDate: first });
  }
  if (next === 'Active' && sub.status === 'Paused' && sub.nextBillingDate < now) {
    // No billing happens while paused: restart the schedule from today instead of catching up.
    Object.assign(sub, { billingAnchor: now, billedCycles: 0, nextBillingDate: now });
  }
  if (next === 'Paused') sub.pausedAt = now;
  if (next === 'Closed') { sub.closedAt = now; sub.closedReason = isCustomer(req) ? 'Closed by customer' : 'Closed by staff'; }
  sub.status = next;
  await sub.save();
  res.json(sub);
});

router.post('/:id/renew', canManage, async (req, res) => {
  const sub = await Subscription.findById(req.params.id);
  if (!sub) throw new HttpError(404, 'Subscription not found.');
  if (sub.status !== 'Closed') throw bad('Only closed subscriptions can be renewed.');
  const plan = await Plan.findById(sub.plan);
  if (!plan?.allowRenew) throw bad('Renewal is disabled for this plan.');
  const now = new Date();
  const expiryDate = req.body.expiryDate ? parseDate(req.body.expiryDate) : undefined;
  if (req.body.expiryDate && (!expiryDate || expiryDate <= now)) throw bad('Enter a future expiry date.');
  Object.assign(sub, { status: 'Active', expiryDate, billingFrequency: plan.billingFrequency, billingAnchor: now, billedCycles: 0, nextBillingDate: now, closedAt: undefined, closedReason: undefined });
  await sub.save();
  res.json(sub);
});

router.post('/from-template/:templateId', canManage, async (req, res) => {
  const tpl = await QuotationTemplate.findById(req.params.templateId).populate('items.plan');
  if (!tpl) throw new HttpError(404, 'Template not found.');
  if (!mongoose.isValidObjectId(req.body.customer)) throw bad('Select a valid customer account.');
  const customer = await User.findById(req.body.customer);
  if (!customer || customer.role !== 'customer') throw bad('Select a valid customer account.');
  if (!tpl.items.length) throw bad('Template needs at least one product and plan line.');
  const items = [];
  for (const line of tpl.items) {
    checkPlanBuyable(line.plan, line.quantity);
    items.push(await buildItem(line.plan, line.quantity));
  }
  const start = req.body.startDate ? parseDate(req.body.startDate) : new Date();
  if (!start) throw bad('Enter a valid start date.');
  const first = tpl.items[0].plan;
  const sub = await Subscription.create({
    number: await nextNumber('SUB'), customer: customer._id, plan: first._id, template: tpl._id, status: 'Quotation',
    startDate: start, nextBillingDate: start, billingFrequency: first.billingFrequency,
    quotationValidUntil: new Date(Date.now() + tpl.validityDays * MS_DAY), items
  });
  res.status(201).json(sub);
});

export default router;
