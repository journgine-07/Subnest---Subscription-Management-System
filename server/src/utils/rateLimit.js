// Tiny in-memory rate limiter (per IP). Good enough for one server; use Redis if you scale out.
export function rateLimit({ windowMs, max, message = 'Too many requests. Please try again later.' }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const rec = hits.get(req.ip);
    if (!rec || rec.reset < now) { hits.set(req.ip, { count: 1, reset: now + windowMs }); return next(); }
    if (++rec.count > max) return res.status(429).json({ message });
    next();
  };
}
