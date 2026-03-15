// ─────────────────────────────────────────────────────────────────────────────
// server.js — Conqueror Charity Backend Entry Point
// ─────────────────────────────────────────────────────────────────────────────
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 4000;

// ── Security & Logging ────────────────────────────────────────────────────────
app.use(helmet());
// During development, allow all origins.
// In production set ALLOWED_ORIGINS=https://yourdomain.com in .env
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true }));
app.use('/api/auth/', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));

// ── Stripe webhook (raw body BEFORE json parser) ──────────────────────────────
app.use('/api/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  req.rawBody = req.body;
  next();
}, require('./routes/webhook'));

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Conqueror Backend', time: new Date().toISOString() });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/orders',   require('./routes/orders'));
app.use('/api/charity',  require('./routes/charity'));

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════╗');
    console.log('  ║   CONQUEROR — Charity Backend          ║');
    console.log('  ║   Faith. Strength. Victory.            ║');
    console.log('  ╠═══════════════════════════════════════╣');
    console.log('  ║   Port    : ' + PORT + '                       ║');
    console.log('  ║   Env     : ' + (process.env.NODE_ENV || 'development') + '              ║');
    console.log('  ║   Charity : ' + (process.env.CHARITY_PERCENTAGE || '10') + '% per order                ║');
    console.log('  ╚═══════════════════════════════════════╝');
    console.log('');
  });
}

module.exports = app;
