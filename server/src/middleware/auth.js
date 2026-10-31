import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

export async function protect(req, res, next) {
  try {
    const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Please log in.' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id).select('+passwordChangedAt');
    if (!user) return res.status(401).json({ message: 'Account not found.' });
    // A token issued before the last password change is no longer valid.
    if (user.passwordChangedAt && payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000)) {
      return res.status(401).json({ message: 'Password was changed. Please log in again.' });
    }
    req.user = user;
    next();
  } catch { res.status(401).json({ message: 'Invalid or expired token.' }); }
}

// Authorization is enforced here, on the API, not just by hiding buttons in the UI.
export const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'You do not have permission to perform this action.' });
