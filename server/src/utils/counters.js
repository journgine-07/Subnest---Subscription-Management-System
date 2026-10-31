import { Counter } from '../models/index.js';
// Atomic, gap-free-on-success sequence numbers: SUB-000001, INV-000001 ...
export async function nextNumber(prefix) {
  const c = await Counter.findOneAndUpdate({ _id: prefix }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `${prefix}-${String(c.seq).padStart(6, '0')}`;
}
