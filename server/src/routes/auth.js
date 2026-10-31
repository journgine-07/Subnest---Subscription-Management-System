import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';
import { protect, allow } from '../middleware/auth.js';
import { paginate } from '../utils/paginate.js';
import { mailConfigured, sendMail } from '../utils/mailer.js';
import { rateLimit } from '../utils/rateLimit.js';
import { HttpError, bad } from '../utils/errors.js';
import { PASSWORD_MESSAGE, emailOK, escapeRegex, passwordOK } from '../utils/validators.js';

const router = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, message: 'Too many attempts. Try again in a few minutes.' });
const tokenFor = user => jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
const safeUser = u => ({ id: u._id, name: u.name, email: u.email, role: u.role });
const str = v => (typeof v === 'string' ? v : '');

async function createUser({ name, email, password }, role) {
  if (!str(name).trim()) throw bad('Name is required.');
  if (!emailOK(email)) throw bad('Enter a valid email address.');
  if (!passwordOK(password)) throw bad(PASSWORD_MESSAGE);
  try {
    return await User.create({ name: name.trim(), email: email.trim(), passwordHash: await bcrypt.hash(password, 12), role });
  } catch (e) {
    if (e.code === 11000) throw new HttpError(409, 'Email is already registered.');
    throw e;
  }
}

// Public sign-up always creates a customer. The role can never come from the request body.
router.post('/register', authLimiter, async (req, res) => {
  const user = await createUser(req.body, 'customer');
  res.status(201).json({ token: tokenFor(user), user: safeUser(user) });
});

router.post('/login', authLimiter, async (req, res) => {
  const user = await User.findOne({ email: str(req.body.email).trim().toLowerCase() }).select('+passwordHash');
  if (!user || !(await bcrypt.compare(str(req.body.password), user.passwordHash))) {
    return res.status(401).json({ message: 'Incorrect email or password.' });
  }
  res.json({ token: tokenFor(user), user: safeUser(user) });
});

router.get('/me', protect, (req, res) => res.json({ user: safeUser(req.user) }));

// Staff/admin: paginated user list. ?role=customer&q=asha&page=1&limit=50
router.get('/users', protect, allow('admin', 'staff'), async (req, res) => {
  const filter = {};
  if (['admin', 'staff', 'customer'].includes(req.query.role)) filter.role = req.query.role;
  if (req.query.q) {
    const rx = new RegExp(escapeRegex(String(req.query.q).slice(0, 60)), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  res.json(await paginate(User, filter, req, { build: q => q.select('name email role createdAt'), maxLimit: 200 }));
});

// Only an admin can create staff accounts.
router.post('/staff', protect, allow('admin'), async (req, res) => {
  const user = await createUser(req.body, 'staff');
  res.status(201).json({ user: safeUser(user) });
});

// Always answers the same way so the endpoint cannot be used to discover which emails exist.
// The reset link is only ever e-mailed (or printed to the server console when SMTP is not set up
// for local development) — it is never returned in the API response.
router.post('/forgot-password', authLimiter, async (req, res) => {
  const generic = { message: 'If that email is registered, a password reset link has been sent.' };
  const user = await User.findOne({ email: str(req.body.email).trim().toLowerCase() });
  if (!user) return res.json(generic);
  const raw = crypto.randomBytes(32).toString('hex');
  user.resetTokenHash = crypto.createHash('sha256').update(raw).digest('hex');
  user.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();
  const link = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${raw}`;
  if (mailConfigured()) {
    try { await sendMail({ to: user.email, subject: 'Reset your Brightloop password', text: `Use this link within 30 minutes to reset your password:\n${link}\n\nIf you did not ask for this, ignore this email.` }); }
    catch (e) { console.error('Password reset email failed:', e.message); }
  } else {
    console.log(`[DEV] SMTP not configured. Password reset link for ${user.email}: ${link}`);
  }
  res.json(generic);
});

router.post('/reset-password', authLimiter, async (req, res) => {
  const hash = crypto.createHash('sha256').update(str(req.body.token)).digest('hex');
  const user = await User.findOne({ resetTokenHash: hash, resetTokenExpires: { $gt: new Date() } });
  if (!user) throw bad('Reset link is invalid or expired.');
  if (!passwordOK(req.body.password)) throw bad(PASSWORD_MESSAGE);
  user.passwordHash = await bcrypt.hash(req.body.password, 12);
  user.resetTokenHash = undefined; user.resetTokenExpires = undefined; user.passwordChangedAt = new Date();
  await user.save();
  res.json({ message: 'Password updated. You can now log in.' });
});

export default router;
