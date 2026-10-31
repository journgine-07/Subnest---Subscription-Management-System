// Demo data. Run:  npm run seed            (adds demo data if missing)
//                  npm run seed -- --reset (wipes the database first)
import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Discount, Invoice, Plan, Product, QuotationTemplate, Subscription, TaxRule, User } from './models/index.js';
import { nextNumber } from './utils/counters.js';
import { MS_DAY } from './utils/dates.js';
import { runDueBilling } from './utils/billing.js';
import { recordPayment } from './utils/payments.js';

await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/subscription_management');
if (process.argv.includes('--reset')) { await mongoose.connection.dropDatabase(); console.log('Database cleared.'); }
await mongoose.syncIndexes();

const upsertUser = async (name, email, password, role) =>
  (await User.findOne({ email })) || User.create({ name, email, role, passwordHash: await bcrypt.hash(password, 12) });
const admin = await upsertUser('Brightloop Admin', 'admin@brightloop.local', 'Admin@12345', 'admin');
await upsertUser('Sana Staff', 'staff@brightloop.local', 'Staff@12345', 'staff');

if (await Subscription.exists({ number: /^SUB-/ })) {
  console.log('Demo data already present (use --reset to rebuild).');
} else {
  const customers = [];
  for (const [name, email] of [['Asha Traders', 'asha@example.com'], ['Ravi Tech Pvt Ltd', 'ravi@example.com'], ['Meera Studio', 'meera@example.com']])
    customers.push(await upsertUser(name, email, 'Customer@12345', 'customer'));

  const gst18 = (await TaxRule.findOne({ name: 'GST 18%' })) || await TaxRule.create({ name: 'GST 18%', rate: 18 });
  await TaxRule.findOne({ name: 'GST 5%' }) || await TaxRule.create({ name: 'GST 5%', rate: 5 });

  const accounting = await Product.create({ name: 'Brightloop Accounting', type: 'Software', salesPrice: 999, costPrice: 250, notes: 'Demo product', taxRule: gst18._id,
    variants: [{ name: 'Standard', additionalPrice: 0 }, { name: 'Odoo', additionalPrice: 560 }] });   // Odoo brand adds 560
  const support = await Product.create({ name: 'Priority Support Add-on', type: 'Service', salesPrice: 299, costPrice: 120, taxRule: gst18._id, variants: [{ name: 'Standard', additionalPrice: 0 }] });
  const monthly = await Plan.create({ name: 'Accounting Monthly', product: accounting._id, price: 999, billingFrequency: 'monthly', minimumQuantity: 1 });
  const yearly = await Plan.create({ name: 'Accounting Yearly', product: accounting._id, price: 9990, billingFrequency: 'yearly', minimumQuantity: 1, allowPause: false });
  await Plan.create({ name: 'Support Weekly', product: support._id, price: 299, billingFrequency: 'weekly', minimumQuantity: 1, autoClose: false });

  await QuotationTemplate.create({ name: 'Starter Accounting Offer', validityDays: 30, items: [{ product: accounting._id, plan: monthly._id, quantity: 1 }] });
  await Discount.create({ name: 'Volume 10% (5+ seats)', type: 'percentage', value: 10, minimumQuantity: 5, maxUses: 100, appliesTo: 'products', products: [accounting._id], autoApply: true });
  await Discount.create({ name: 'Welcome ₹200 off (first 3 invoices)', type: 'fixed', value: 200, minimumPurchase: 500, maxUses: 3, endDate: new Date(Date.now() + 90 * MS_DAY), autoApply: false });

  const midnight = daysAgo => { const d = new Date(Date.now() - daysAgo * MS_DAY); d.setUTCHours(0, 0, 0, 0); return d; };
  const makeSub = async (customer, plan, product, quantity, anchorDaysAgo, extra = {}) => {
    const anchor = midnight(anchorDaysAgo);
    return Subscription.create({
      number: await nextNumber('SUB'), customer: customer._id, plan: plan._id, status: 'Active',
      startDate: anchor, billingAnchor: anchor, billedCycles: 0, nextBillingDate: anchor, billingFrequency: plan.billingFrequency,
      items: [{ product: product._id, description: product.name, variantName: 'Standard', quantity, unitPrice: plan.price, taxRate: 18, amount: plan.price * quantity }], ...extra
    });
  };
  const welcome = await Discount.findOne({ name: /^Welcome/ });
  await makeSub(customers[0], monthly, accounting, 1, 70, { discount: welcome._id });   // 3 past invoices, welcome discount attached
  await makeSub(customers[1], monthly, accounting, 6, 40);                             // 6 seats: volume discount applies automatically
  await makeSub(customers[2], yearly, accounting, 1, 20);                              // yearly plan
  await Subscription.create({ number: await nextNumber('SUB'), customer: customers[2]._id, plan: monthly._id, status: 'Quotation', billingFrequency: 'monthly',
    startDate: new Date(), quotationValidUntil: new Date(Date.now() + 30 * MS_DAY), items: [{ product: accounting._id, description: 'Brightloop Accounting', quantity: 2, unitPrice: 999, taxRate: 18, amount: 1998 }] });

  console.log('Billing run:', await runDueBilling());

  // Make the data interesting: confirm most invoices, pay some in full, one partially.
  const invoices = await Invoice.find().sort({ periodStart: 1 });
  for (const inv of invoices.slice(0, -1)) await Invoice.updateOne({ _id: inv._id, status: 'Draft' }, { $set: { status: 'Confirmed' } });
  const byCustomer = id => invoices.filter(i => String(i.customer) === String(id));
  const [asha, ravi] = [byCustomer(customers[0]._id), byCustomer(customers[1]._id)];
  const pay = (inv, amount, method, note) => recordPayment({ invoiceId: inv._id, amount: amount ?? inv.total, method, note, userId: admin._id });
  if (asha[0]) await pay(asha[0], null, 'UPI', 'Paid in full');
  if (asha[1]) await pay(asha[1], 500, 'Bank Transfer', 'Partial payment');
  if (ravi[0]) await pay(ravi[0], null, 'Card', 'Paid in full');
}

console.log('\nSeed complete. Demo logins:\n  admin    admin@brightloop.local / Admin@12345\n  staff    staff@brightloop.local / Staff@12345\n  customer asha@example.com / Customer@12345 (also ravi@, meera@)');
await mongoose.disconnect();
