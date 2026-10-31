import { Router } from 'express';
import { Product, Plan, TaxRule, Discount, QuotationTemplate } from '../models/index.js';
import { protect, allow } from '../middleware/auth.js';
import { bad, HttpError } from '../utils/errors.js';
import { endOfDayUTC, parseDate } from '../utils/dates.js';
import { pick } from '../utils/validators.js';

const router = Router();
router.use(protect);
const admin = allow('admin');
const ops = allow('admin', 'staff');

// Generic "update only the whitelisted fields" handler. Using doc.save() runs the model validators.
const update = (Model, fields, prepare = b => b) => async (req, res) => {
  const doc = await Model.findById(req.params.id);
  if (!doc) throw new HttpError(404, `${Model.modelName} not found.`);
  doc.set(prepare(pick(req.body, fields)));
  await doc.save();
  res.json(doc);
};
const create = (Model, fields, prepare = b => b) => async (req, res) => res.status(201).json(await Model.create(prepare(pick(req.body, fields))));
const archive = Model => async (req, res) => {
  const doc = await Model.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  if (!doc) throw new HttpError(404, `${Model.modelName} not found.`);
  res.json({ message: `${Model.modelName} archived` });
};

// ---- Products ------------------------------------------------------------------------------
const productFields = ['name', 'type', 'salesPrice', 'costPrice', 'notes', 'taxRule', 'variants'];
const cleanProduct = b => {
  if (b.taxRule === '') b.taxRule = undefined;
  if (b.variants) {
    const names = b.variants.map(v => String(v.name || '').trim().toLowerCase());
    if (new Set(names).size !== names.length) throw bad('Variant names must be unique.');
  }
  return b;
};
router.get('/products', async (req, res) => {
  // Cost price is internal: admin only. Notes are hidden from customers.
  const hide = req.user.role === 'admin' ? '' : req.user.role === 'staff' ? '-costPrice' : '-costPrice -notes';
  res.json(await Product.find({ active: true }).select(hide).sort({ name: 1 }).limit(500).lean());
});
router.post('/products', admin, create(Product, productFields, cleanProduct));
router.put('/products/:id', admin, update(Product, productFields, cleanProduct));
router.delete('/products/:id', admin, archive(Product));

// ---- Plans ---------------------------------------------------------------------------------
const planFields = ['name', 'product', 'price', 'billingFrequency', 'minimumQuantity', 'availableFrom', 'availableUntil', 'autoClose', 'allowEarlyClose', 'allowPause', 'allowRenew'];
const cleanPlan = b => {
  for (const k of ['availableFrom', 'availableUntil']) {
    if (b[k] === '' || b[k] === null) b[k] = undefined;
    else if (b[k] !== undefined && !parseDate(b[k])) throw bad('Enter valid availability dates.');
  }
  if (b.availableUntil) b.availableUntil = endOfDayUTC(b.availableUntil);
  if (b.availableFrom && b.availableUntil && parseDate(b.availableFrom) > parseDate(b.availableUntil)) throw bad('Plan "available from" must be before "available until".');
  return b;
};
router.get('/plans', async (req, res) => {
  const filter = { active: true };
  if (req.user.role === 'customer') {            // customers only see plans that can be bought today
    const now = new Date();
    filter.$and = [{ $or: [{ availableFrom: null }, { availableFrom: { $lte: now } }] }, { $or: [{ availableUntil: null }, { availableUntil: { $gte: now } }] }];
  }
  res.json(await Plan.find(filter).populate('product', 'name salesPrice variants').sort({ name: 1 }).limit(500).lean());
});
router.post('/plans', admin, create(Plan, planFields, cleanPlan));
router.put('/plans/:id', admin, update(Plan, planFields, cleanPlan));
router.delete('/plans/:id', admin, archive(Plan));

// ---- Tax rules (admin-defined) --------------------------------------------------------------
router.get('/tax-rules', ops, async (req, res) => res.json(await TaxRule.find({ active: true }).sort({ name: 1 }).limit(500).lean()));
router.post('/tax-rules', admin, create(TaxRule, ['name', 'rate']));
router.put('/tax-rules/:id', admin, update(TaxRule, ['name', 'rate', 'active']));

// ---- Discounts (admin only) -----------------------------------------------------------------
const discountFields = ['name', 'type', 'value', 'minimumPurchase', 'minimumQuantity', 'startDate', 'endDate', 'maxUses', 'appliesTo', 'products', 'autoApply', 'active'];
const cleanDiscount = b => {
  for (const k of ['startDate', 'endDate', 'maxUses']) if (b[k] === '' || b[k] === null) b[k] = undefined;
  for (const k of ['startDate', 'endDate']) if (b[k] !== undefined && !parseDate(b[k])) throw bad('Enter valid discount dates.');
  if (b.endDate) b.endDate = endOfDayUTC(b.endDate);       // end date is inclusive
  if (b.appliesTo === 'subscriptions') b.products = [];
  return b;
};
router.get('/discounts', ops, async (req, res) => res.json(await Discount.find({ active: true }).populate('products', 'name').sort({ createdAt: -1 }).limit(500).lean()));
router.post('/discounts', admin, create(Discount, discountFields, cleanDiscount));
router.put('/discounts/:id', admin, update(Discount, discountFields, cleanDiscount));
router.delete('/discounts/:id', admin, archive(Discount));

// ---- Quotation templates --------------------------------------------------------------------
router.get('/templates', ops, async (req, res) => res.json(await QuotationTemplate.find().populate('items.product', 'name').populate('items.plan', 'name price billingFrequency').sort({ name: 1 }).limit(500).lean()));
router.post('/templates', admin, async (req, res) => {
  const { name, validityDays, items } = req.body;
  if (!name || !Array.isArray(items) || !items.length) throw bad('A template needs a name and at least one plan line.');
  const plans = await Plan.find({ _id: { $in: items.map(i => i.plan) }, active: true }).lean();
  const lines = items.map(i => {
    const plan = plans.find(p => String(p._id) === String(i.plan));
    const quantity = Number(i.quantity);
    if (!plan) throw bad('Every template line needs an active plan.');
    if (!Number.isInteger(quantity) || quantity < plan.minimumQuantity) throw bad(`Quantity for "${plan.name}" must be a whole number of at least ${plan.minimumQuantity}.`);
    return { plan: plan._id, product: plan.product, quantity };   // product always comes from the plan
  });
  // One subscription is billed on one schedule, so all lines must share a billing frequency.
  if (new Set(lines.map(l => plans.find(p => String(p._id) === String(l.plan)).billingFrequency)).size > 1) {
    throw bad('All plans in one quotation template must have the same billing frequency.');
  }
  res.status(201).json(await QuotationTemplate.create({ name, validityDays: Number(validityDays) || 30, items: lines }));
});

export default router;
