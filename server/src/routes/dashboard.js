import { Router } from 'express';
import { Invoice, Payment, Subscription } from '../models/index.js';
import { protect, allow } from '../middleware/auth.js';
import { MS_DAY, parseDate } from '../utils/dates.js';
import { MONTHLY_FACTOR, money } from '../utils/invoiceMath.js';
import { bad } from '../utils/errors.js';

const router = Router();
router.use(protect, allow('admin', 'staff'));

// Every query below is an indexed, bounded count/aggregate or a LIMITed list, so the work does not
// grow with the number of rows returned to the browser.
const balance = { $subtract: ['$total', '$paidAmount'] };

router.get('/', async (req, res) => {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const [active, mrr, outstanding, overdue, collected, overdueInvoices, recentPayments, monthly] = await Promise.all([
    Subscription.countDocuments({ status: 'Active' }),
    Subscription.aggregate([
      { $match: { status: 'Active' } },
      { $group: { _id: '$billingFrequency', amount: { $sum: { $sum: { $map: { input: '$items', as: 'i', in: { $multiply: ['$$i.quantity', '$$i.unitPrice'] } } } } } } }
    ]),
    Invoice.aggregate([{ $match: { status: 'Confirmed' } }, { $group: { _id: null, amount: { $sum: balance }, count: { $sum: 1 } } }]),
    Invoice.aggregate([{ $match: { status: 'Confirmed', dueDate: { $lt: now } } }, { $group: { _id: null, amount: { $sum: balance }, count: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { date: { $gte: monthStart } } }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    Invoice.find({ status: 'Confirmed', dueDate: { $lt: now } }).sort({ dueDate: 1 }).limit(10).populate('customer', 'name email').lean(),
    Payment.find().sort({ date: -1 }).limit(8).populate('customer', 'name').populate('invoice', 'number').lean(),
    Payment.aggregate([
      { $match: { date: { $gte: sixMonthsAgo } } },
      { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, amount: { $sum: '$amount' } } },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ])
  ]);
  const mrrTotal = mrr.reduce((s, r) => s + (MONTHLY_FACTOR[r._id] ?? 0) * r.amount, 0);
  res.json({
    activeSubscriptions: active,
    monthlyRecurringRevenue: money(mrrTotal),            // before tax and discounts
    revenueThisMonth: money(collected[0]?.amount || 0),
    outstanding: money(outstanding[0]?.amount || 0), outstandingCount: outstanding[0]?.count || 0,
    overdueAmount: money(overdue[0]?.amount || 0), overdueCount: overdue[0]?.count || 0,
    overdueInvoices: overdueInvoices.map(i => ({ ...i, outstanding: money(i.total - i.paidAmount) })),
    recentPayments, monthly
  });
});

// Date-filtered summary. ?from=YYYY-MM-DD&to=YYYY-MM-DD (invoices/subscriptions by creation date, payments by payment date)
router.get('/reports', async (req, res) => {
  const now = new Date();
  const from = req.query.from ? parseDate(req.query.from) : new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const toRaw = req.query.to ? parseDate(req.query.to) : now;
  if (!from || !toRaw) throw bad('Enter valid from and to dates.');
  const to = req.query.to ? new Date(toRaw.getTime() + MS_DAY - 1) : toRaw;      // "to" includes the whole day
  if (from > to) throw bad('The "from" date must be before the "to" date.');
  const [payments, byMethod, invoices, subscriptions] = await Promise.all([
    Payment.aggregate([{ $match: { date: { $gte: from, $lte: to } } }, { $group: { _id: { year: { $year: '$date' }, month: { $month: '$date' } }, amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { '_id.year': 1, '_id.month': 1 } }]),
    Payment.aggregate([{ $match: { date: { $gte: from, $lte: to } } }, { $group: { _id: '$method', amount: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { amount: -1 } }]),
    Invoice.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$total' } } }]),
    Subscription.aggregate([{ $match: { createdAt: { $gte: from, $lte: to } } }, { $group: { _id: '$status', count: { $sum: 1 } } }])
  ]);
  const collected = money(payments.reduce((s, p) => s + p.amount, 0));
  const invoiced = money(invoices.filter(i => i._id !== 'Cancelled').reduce((s, i) => s + i.total, 0));
  res.json({ from, to, collected, invoiced, payments, byMethod, invoices, subscriptions });
});

export default router;
