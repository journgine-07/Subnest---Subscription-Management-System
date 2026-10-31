import { Router } from 'express';
import mongoose from 'mongoose';
import { Invoice, Payment } from '../models/index.js';
import { protect, allow } from '../middleware/auth.js';
import { HttpError, bad } from '../utils/errors.js';
import { money } from '../utils/invoiceMath.js';
import { paginate } from '../utils/paginate.js';
import { mailConfigured, sendMail } from '../utils/mailer.js';
import { escapeRegex } from '../utils/validators.js';
import { releaseDiscountUse, runDueBilling } from '../utils/billing.js';
import { recordPayment } from '../utils/payments.js';

const router = Router();
router.use(protect);
const ops = allow('admin', 'staff');
const isCustomer = req => req.user.role === 'customer';

// Manual "run due billing" button. The same function runs on the daily schedule.
router.post('/run-due', ops, async (req, res) => res.json(await runDueBilling()));

// Invoice list (paginated). Filters: ?status=Draft,Confirmed  ?overdue=1  ?payable=1 (confirmed with balance)
// ?q=INV-0001  ?customer=<id>  ?page=  ?limit=
router.get('/invoices', async (req, res) => {
  const filter = {};
  if (isCustomer(req)) { filter.customer = req.user._id; filter.status = { $in: ['Confirmed', 'Paid'] }; }   // customers never see drafts
  else if (mongoose.isValidObjectId(req.query.customer)) filter.customer = req.query.customer;
  if (req.query.status) {
    const wanted = String(req.query.status).split(',');
    filter.status = isCustomer(req) ? { $in: wanted.filter(s => ['Confirmed', 'Paid'].includes(s)) } : { $in: wanted };
  }
  if (req.query.overdue === '1') { filter.status = 'Confirmed'; filter.dueDate = { $lt: new Date() }; }
  if (req.query.payable === '1') filter.status = 'Confirmed';
  if (req.query.q) filter.number = new RegExp('^' + escapeRegex(String(req.query.q).trim().toUpperCase()));
  const result = await paginate(Invoice, filter, req, { build: q => q.populate('customer', 'name email').populate('subscription', 'number') });
  const now = new Date();
  result.data = result.data.map(i => ({ ...i, outstanding: i.status === 'Confirmed' ? money(i.total - i.paidAmount) : 0, overdue: i.status === 'Confirmed' && i.dueDate < now }));
  res.json(result);
});

// Draft -> Confirmed, or Draft/Confirmed -> Cancelled (only while nothing has been paid).
router.patch('/invoices/:id/status', ops, async (req, res) => {
  const { status } = req.body;
  let invoice;
  if (status === 'Confirmed') {
    invoice = await Invoice.findOneAndUpdate({ _id: req.params.id, status: 'Draft' }, [
      { $set: { status: { $cond: [{ $lte: ['$total', 0] }, 'Paid', 'Confirmed'] } } }   // a zero-value invoice has nothing to collect
    ], { new: true });
  } else if (status === 'Cancelled') {
    invoice = await Invoice.findOneAndUpdate({ _id: req.params.id, status: { $in: ['Draft', 'Confirmed'] }, paidAmount: 0 }, { $set: { status: 'Cancelled' } }, { new: true });
    if (invoice?.discount) await releaseDiscountUse(invoice.discount);       // the cancelled invoice no longer uses the discount
  } else throw bad('Invoice status can be changed to Confirmed or Cancelled only.');

  if (!invoice) {
    const existing = await Invoice.findById(req.params.id).lean();
    if (!existing) throw new HttpError(404, 'Invoice not found.');
    if (status === 'Cancelled' && existing.paidAmount > 0) throw bad('An invoice with payments cannot be cancelled.');
    throw bad(`Cannot change an invoice from ${existing.status} to ${status}.`);
  }
  res.json(invoice);
});

router.post('/invoices/:id/send', ops, async (req, res) => {
  const invoice = await Invoice.findById(req.params.id).populate('customer', 'name email').populate('subscription', 'number');
  if (!invoice) throw new HttpError(404, 'Invoice not found.');
  if (!['Confirmed', 'Paid'].includes(invoice.status)) throw bad('Confirm the invoice before sending it.');
  if (!mailConfigured()) throw new HttpError(503, 'Email is not configured. Add the SMTP settings to server/.env to send invoices.');
  const lines = invoice.lines.map(x => `${x.description} x ${x.quantity} @ ₹${x.unitPrice.toFixed(2)}  (tax ${x.taxRate}%)  = ₹${x.amount.toFixed(2)}`).join('\n');
  try {
    await sendMail({
      to: invoice.customer.email, subject: `Brightloop invoice ${invoice.number}`,
      text: `Hello ${invoice.customer.name},\n\nYour invoice ${invoice.number} is ready.\n\n${lines}\n\nSubtotal: ₹${invoice.subtotal.toFixed(2)}\nDiscount: ₹${invoice.discountTotal.toFixed(2)}\nTax: ₹${invoice.taxTotal.toFixed(2)}\nTotal: ₹${invoice.total.toFixed(2)}\nDue date: ${invoice.dueDate?.toDateString()}\n\nThank you,\nBrightloop Software`
    });
  } catch (e) { console.error('Invoice email failed:', e.message); throw new HttpError(502, 'Invoice email could not be sent. Check the SMTP settings.'); }
  invoice.emailSentAt = new Date();
  await invoice.save();
  res.json({ message: `Invoice sent to ${invoice.customer.email}.` });
});

router.get('/payments', async (req, res) => {
  const filter = isCustomer(req) ? { customer: req.user._id } : {};
  if (!isCustomer(req) && mongoose.isValidObjectId(req.query.invoice)) filter.invoice = req.query.invoice;
  res.json(await paginate(Payment, filter, req, { sort: { date: -1 }, build: q => q.populate('invoice', 'number total').populate('customer', 'name email') }));
});

router.post('/payments', ops, async (req, res) => {
  const { payment, invoice } = await recordPayment({ ...req.body, invoiceId: req.body.invoice, userId: req.user._id });
  res.status(201).json({ payment, invoice });
});

export default router;
