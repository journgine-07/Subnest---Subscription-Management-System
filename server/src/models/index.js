import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const opts = { timestamps: true };

// Money is stored as a Number rounded to 2 decimal places.
const round2 = v => (v === null || v === undefined ? v : Math.round((Number(v) + Number.EPSILON) * 100) / 100);
const money = (extra = {}) => ({ type: Number, min: 0, set: round2, ...extra });
const ref = (to, extra = {}) => ({ type: Schema.Types.ObjectId, ref: to, ...extra });

const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });

const userSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'staff', 'customer'], default: 'customer' },
  resetTokenHash: { type: String, select: false },
  resetTokenExpires: { type: Date, select: false },
  passwordChangedAt: { type: Date, select: false }
}, opts);
userSchema.index({ role: 1, createdAt: -1 });

const productSchema = new Schema({
  name: { type: String, required: true, trim: true }, type: { type: String, required: true, trim: true },
  salesPrice: money({ required: true }), costPrice: money({ default: 0 }), notes: String,
  taxRule: ref('TaxRule'),
  variants: [{ name: { type: String, required: true, trim: true }, additionalPrice: money({ default: 0 }) }],
  active: { type: Boolean, default: true }
}, opts);
productSchema.index({ active: 1, name: 1 });

const planSchema = new Schema({
  name: { type: String, required: true, trim: true }, product: ref('Product', { required: true }),
  price: money({ required: true }),
  billingFrequency: { type: String, enum: ['daily', 'weekly', 'monthly', 'yearly'], required: true },
  minimumQuantity: { type: Number, default: 1, min: 1 }, availableFrom: Date, availableUntil: Date,
  autoClose: { type: Boolean, default: true }, allowEarlyClose: { type: Boolean, default: true },
  allowPause: { type: Boolean, default: true }, allowRenew: { type: Boolean, default: true },
  active: { type: Boolean, default: true }
}, opts);
planSchema.index({ product: 1, active: 1 });

const taxRuleSchema = new Schema({
  name: { type: String, required: true, trim: true }, rate: { type: Number, required: true, min: 0, max: 100 },
  active: { type: Boolean, default: true }
}, opts);

const discountSchema = new Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['fixed', 'percentage'], required: true },
  value: money({ required: true }),
  minimumPurchase: money({ default: 0 }), minimumQuantity: { type: Number, default: 1, min: 1 },
  startDate: Date, endDate: Date, maxUses: { type: Number, min: 1 }, usedCount: { type: Number, default: 0, min: 0 },
  appliesTo: { type: String, enum: ['products', 'subscriptions'], default: 'subscriptions' },
  products: [ref('Product')],
  // true: applied to every eligible subscription. false: only used when attached to a subscription.
  autoApply: { type: Boolean, default: true },
  active: { type: Boolean, default: true }
}, opts);
discountSchema.index({ active: 1, autoApply: 1 });
discountSchema.pre('validate', function (next) {
  if (this.type === 'percentage' && this.value > 100) this.invalidate('value', 'A percentage discount cannot exceed 100%.');
  if (this.startDate && this.endDate && this.startDate > this.endDate) this.invalidate('endDate', 'Discount start date must be before the end date.');
  if (this.appliesTo === 'products' && !this.products?.length) this.invalidate('products', 'Choose at least one product for a product-specific discount.');
  next();
});

// One line of a quotation, subscription or invoice.
const lineSchema = new Schema({
  product: ref('Product'), description: String, variantName: String,
  quantity: { type: Number, min: 1, default: 1 }, unitPrice: money({ required: true }),
  taxRate: { type: Number, min: 0, max: 100, default: 0 },
  discount: money({ default: 0 }), taxAmount: money({ default: 0 }),
  amount: money({ default: 0 })               // quantity x unit price, less any discount (before tax)
}, { _id: false });

const quotationTemplateSchema = new Schema({
  name: { type: String, required: true, trim: true }, validityDays: { type: Number, default: 30, min: 1 },
  items: [{ product: ref('Product'), plan: ref('Plan'), quantity: { type: Number, default: 1, min: 1 } }]
}, opts);

const subscriptionSchema = new Schema({
  number: { type: String, unique: true }, customer: ref('User', { required: true }),
  plan: ref('Plan', { required: true }), template: ref('QuotationTemplate'),
  status: { type: String, enum: ['Draft', 'Quotation', 'Confirmed', 'Active', 'Paused', 'Closed'], default: 'Draft' },
  quotationValidUntil: Date, startDate: Date, expiryDate: Date,
  paymentTerms: { type: String, default: 'Due in 7 days' },
  items: [lineSchema], discount: ref('Discount'), currency: { type: String, default: 'INR' },
  // Billing schedule. Period n starts at anchor + n x frequency, so dates never drift or get skipped.
  billingFrequency: { type: String, enum: ['daily', 'weekly', 'monthly', 'yearly'] },
  billingAnchor: Date, billedCycles: { type: Number, default: 0 }, nextBillingDate: Date,
  closedAt: Date, closedReason: String, pausedAt: Date
}, opts);
subscriptionSchema.index({ status: 1, nextBillingDate: 1 });
subscriptionSchema.index({ customer: 1, createdAt: -1 });
subscriptionSchema.index({ status: 1, createdAt: -1 });
subscriptionSchema.index({ status: 1, quotationValidUntil: 1 });

const invoiceSchema = new Schema({
  number: { type: String, required: true, unique: true },
  // subscription id + period start date. The unique index is what guarantees "never billed twice".
  billingKey: { type: String, required: true, unique: true },
  subscription: ref('Subscription', { required: true }), customer: ref('User', { required: true }),
  periodStart: Date, periodEnd: Date, dueDate: Date,
  status: { type: String, enum: ['Draft', 'Confirmed', 'Paid', 'Cancelled'], default: 'Draft' },
  lines: [lineSchema], subtotal: money(), discountTotal: money(), taxTotal: money(), total: money(),
  discount: ref('Discount'), discountName: String,
  paidAmount: money({ default: 0 }), currency: { type: String, default: 'INR' }, emailSentAt: Date
}, opts);
invoiceSchema.index({ subscription: 1, periodStart: 1 });
invoiceSchema.index({ customer: 1, status: 1, dueDate: 1 });
invoiceSchema.index({ status: 1, dueDate: 1 });
invoiceSchema.index({ createdAt: -1 });

const paymentSchema = new Schema({
  invoice: ref('Invoice', { required: true }), customer: ref('User', { required: true }), recordedBy: ref('User'),
  method: { type: String, enum: ['UPI', 'Card', 'Bank Transfer', 'Cash', 'Other'], required: true },
  amount: money({ required: true, min: 0.01 }), date: { type: Date, default: Date.now }, note: String
}, opts);
paymentSchema.index({ date: -1 });
paymentSchema.index({ invoice: 1, date: -1 });
paymentSchema.index({ customer: 1, date: -1 });

export const Counter = model('Counter', counterSchema);
export const User = model('User', userSchema);
export const Product = model('Product', productSchema);
export const Plan = model('Plan', planSchema);
export const TaxRule = model('TaxRule', taxRuleSchema);
export const Discount = model('Discount', discountSchema);
export const QuotationTemplate = model('QuotationTemplate', quotationTemplateSchema);
export const Subscription = model('Subscription', subscriptionSchema);
export const Invoice = model('Invoice', invoiceSchema);
export const Payment = model('Payment', paymentSchema);
