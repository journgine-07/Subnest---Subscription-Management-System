import 'dotenv/config';
import 'express-async-errors';          // lets async route handlers throw errors that reach the error handler below
import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import catalogRoutes from './routes/catalog.js';
import subscriptionRoutes from './routes/subscriptions.js';
import billingRoutes from './routes/billing.js';
import dashboardRoutes from './routes/dashboard.js';
import { runDueBilling } from './utils/billing.js';

const secret = process.env.JWT_SECRET;
if (!secret || (process.env.NODE_ENV === 'production' && (secret.length < 32 || secret.startsWith('replace_with')))) {
  throw new Error('Set a long random JWT_SECRET (32+ characters) in server/.env. See .env.example.');
}

const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY));   // only when behind a reverse proxy
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'Brightloop Subscription Management API' }));
app.use('/api/auth', authRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api', (req, res) => res.status(404).json({ message: 'API route not found.' }));

// Optional: serve the built React app from this server (run `npm run build` first, set SERVE_CLIENT=true).
if (process.env.SERVE_CLIENT === 'true') {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// One place that turns errors into clear JSON messages.
app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ message: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Request body is not valid JSON.' });
  if (err.name === 'ValidationError') return res.status(400).json({ message: Object.values(err.errors).map(e => e.message).join(' ') });
  if (err.name === 'CastError') return res.status(400).json({ message: `Invalid value for "${err.path}".` });
  if (err.code === 11000) return res.status(409).json({ message: 'A record with the same unique value already exists.' });
  console.error(err);
  res.status(500).json({ message: 'Internal server error.' });
});

await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/subscription_management');
console.log('MongoDB connected');
await mongoose.syncIndexes?.().catch(e => console.warn('Index sync warning:', e.message));

// Recurring billing: every day at 02:00 (server time zone from TZ).
cron.schedule('0 2 * * *', async () => {
  try { console.log('Scheduled billing:', await runDueBilling()); }
  catch (e) { console.error('Scheduled billing failed:', e); }
}, { timezone: process.env.TZ || 'Asia/Kolkata' });

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
