import mongoose from 'mongoose';
import { Invoice, Payment } from '../models/index.js';
import { HttpError, bad } from './errors.js';
import { MS_DAY, parseDate } from './dates.js';
import { money } from './invoiceMath.js';

export const PAYMENT_METHODS = ['UPI', 'Card', 'Bank Transfer', 'Cash', 'Other'];

// Records a payment against one invoice. The "is there enough balance left?" check and the update
// of paidAmount/status are a single atomic database operation, so two staff members recording
// payments at the same moment cannot overpay an invoice.
export async function recordPayment({ invoiceId, amount, method, date, note, userId }) {
  if (!mongoose.isValidObjectId(invoiceId)) throw bad('Select a valid invoice.');
  const amt = money(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw bad('Enter a valid payment amount greater than zero.');
  if (!PAYMENT_METHODS.includes(method)) throw bad(`Payment method must be one of: ${PAYMENT_METHODS.join(', ')}.`);
  const when = date ? parseDate(date) : new Date();
  if (!when) throw bad('Enter a valid payment date.');
  if (when.getTime() > Date.now() + MS_DAY) throw bad('Payment date cannot be in the future.');

  const newPaid = { $round: [{ $add: ['$paidAmount', amt] }, 2] };
  const invoice = await Invoice.findOneAndUpdate(
    { _id: invoiceId, status: 'Confirmed', $expr: { $lte: [newPaid, '$total'] } },
    [
      { $set: { paidAmount: newPaid } },
      { $set: { status: { $cond: [{ $gte: ['$paidAmount', '$total'] }, 'Paid', '$status'] } } }
    ],
    { new: true });

  if (!invoice) {                                   // work out the friendly reason
    const existing = await Invoice.findById(invoiceId).lean();
    if (!existing) throw new HttpError(404, 'Invoice not found.');
    if (existing.status === 'Draft') throw bad('Confirm the invoice before recording a payment.');
    if (existing.status === 'Paid') throw bad('This invoice is already fully paid.');
    if (existing.status === 'Cancelled') throw bad('Cancelled invoices cannot receive payments.');
    throw bad(`Payment exceeds the outstanding balance of ₹${money(existing.total - existing.paidAmount).toFixed(2)}.`);
  }

  try {
    const payment = await Payment.create({ invoice: invoice._id, customer: invoice.customer, recordedBy: userId, method, amount: amt, date: when, note });
    return { payment, invoice };
  } catch (e) {                                     // undo the invoice update if the payment row failed
    await Invoice.updateOne({ _id: invoice._id }, [
      { $set: { paidAmount: { $round: [{ $subtract: ['$paidAmount', amt] }, 2] } } },
      { $set: { status: { $cond: [{ $and: [{ $eq: ['$status', 'Paid'] }, { $lt: ['$paidAmount', '$total'] }] }, 'Confirmed', '$status'] } } }
    ]);
    throw e;
  }
}
