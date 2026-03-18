// ─────────────────────────────────────────────────────────────────────────────
// charity.test.js — Integration tests for the charity allocation system
// ─────────────────────────────────────────────────────────────────────────────
process.env.NODE_ENV = 'test';
process.env.DB_PATH = './test.db';
process.env.JWT_SECRET = 'test_secret';
process.env.CHARITY_PERCENTAGE = '10';
process.env.CHARITY_MIN_AMOUNT_CENTS = '50';

const request = require('supertest');
const app = require('../src/server');
const { dbRun, dbAll, closeDb } = require('../src/config/database');

let adminToken, userToken, createdOrderId;

// ── Setup & Teardown ──────────────────────────────────────────────────────────
beforeAll(async () => {
  // Run migrations inline
  const migrate = require('../src/config/migrate');
  // Instead, create tables directly for test isolation
  await dbRun(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL, name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer', created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await dbRun(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT,
    category TEXT NOT NULL, price_cents INTEGER NOT NULL, stock INTEGER NOT NULL DEFAULT 0,
    image_url TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await dbRun(`CREATE TABLE IF NOT EXISTS charity_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL DEFAULT 'Default',
    percentage REAL NOT NULL DEFAULT 10.0, min_amount_cents INTEGER NOT NULL DEFAULT 50,
    cause_name TEXT NOT NULL DEFAULT 'Community Outreach Fund', cause_desc TEXT,
    is_active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await dbRun(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
    subtotal_cents INTEGER NOT NULL, shipping_cents INTEGER NOT NULL DEFAULT 0,
    tax_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL,
    charity_percentage REAL NOT NULL, charity_amount_cents INTEGER NOT NULL,
    net_revenue_cents INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    stripe_payment_intent TEXT, stripe_charge_id TEXT,
    shipping_address TEXT, notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await dbRun(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL, product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL, unit_price_cents INTEGER NOT NULL, line_total_cents INTEGER NOT NULL)`);
  await dbRun(`CREATE TABLE IF NOT EXISTS charity_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER,
    entry_type TEXT NOT NULL, amount_cents INTEGER NOT NULL,
    balance_after_cents INTEGER NOT NULL, description TEXT,
    created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  await dbRun(`CREATE TABLE IF NOT EXISTS charity_disbursements (
    id INTEGER PRIMARY KEY AUTOINCREMENT, amount_cents INTEGER NOT NULL,
    recipient TEXT NOT NULL, reference TEXT, notes TEXT,
    disbursed_by INTEGER, disbursed_at TEXT NOT NULL DEFAULT (datetime('now')))`);

  // Seed charity config
  const existing = await dbRun(`INSERT OR IGNORE INTO charity_config
    (name, percentage, min_amount_cents, cause_name, is_active)
    VALUES ('Test Config', 10, 50, 'Test Outreach Fund', 1)`);

  // Seed a test product
  await dbRun(`INSERT OR IGNORE INTO products (id, name, category, price_cents, stock, active)
    VALUES (1, 'Test Hoodie', 'hoodies', 8900, 100, 1)`);
});

afterAll(async () => {
  // Clean up test DB tables
  const tables = ['charity_disbursements','charity_ledger','order_items','orders','products','users','charity_config'];
  for (const t of tables) await dbRun(`DROP TABLE IF EXISTS ${t}`);
  await closeDb();
  require('fs').existsSync('./test.db') && require('fs').unlinkSync('./test.db');
});

// ── Auth ──────────────────────────────────────────────────────────────────────
describe('Auth', () => {
  test('Register admin user', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'admin@test.com', password: 'password123', name: 'Test Admin' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    adminToken = res.body.token;
    // Manually promote to admin
    await dbRun(`UPDATE users SET role = 'admin' WHERE email = 'admin@test.com'`);
    // Re-login to get fresh token with admin role reflected in DB
  });

  test('Register customer user', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'customer@test.com', password: 'password123', name: 'Test Customer' });
    expect(res.status).toBe(201);
    userToken = res.body.token;
  });

  test('Login returns token', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'password123' });
    expect(res.status).toBe(200);
    adminToken = res.body.token; // refresh after role update
  });

  test('Rejects duplicate email', async () => {
    const res = await request(app).post('/api/auth/register')
      .send({ email: 'admin@test.com', password: 'password123', name: 'Dup' });
    expect(res.status).toBe(409);
  });
});

// ── Charity Config ────────────────────────────────────────────────────────────
describe('Charity Config', () => {
  test('GET /api/charity/config returns active config', async () => {
    const res = await request(app).get('/api/charity/config');
    expect(res.status).toBe(200);
    expect(res.body.percentage).toBe(10);
    expect(res.body.causeName).toBeDefined();
  });

  test('PATCH /api/charity/config updates percentage (admin)', async () => {
    const res = await request(app).patch('/api/charity/config')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ percentage: 15, causeName: 'Updated Cause' });
    expect(res.status).toBe(200);
    expect(res.body.config.percentage).toBe(15);
    // Reset to 10
    await request(app).patch('/api/charity/config')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ percentage: 10, causeName: 'Test Outreach Fund' });
  });

  test('PATCH /api/charity/config rejects non-admin', async () => {
    const res = await request(app).patch('/api/charity/config')
      .set('Authorization', 'Bearer ' + userToken)
      .send({ percentage: 50 });
    expect(res.status).toBe(403);
  });

  test('Rejects percentage > 100', async () => {
    const res = await request(app).patch('/api/charity/config')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ percentage: 101 });
    expect(res.status).toBe(400);
  });
});

// ── Charity Calculation ───────────────────────────────────────────────────────
describe('Charity Calculation Engine', () => {
  test('Calculates 10% of subtotal correctly', async () => {
    const { calculateAllocation } = require('../src/services/charityService');
    const result = await calculateAllocation(10000, 500, 800); // $100 subtotal
    expect(result.charityAmountCents).toBe(1000);   // 10% of $100
    expect(result.totalCents).toBe(11300);           // $100 + $5 + $8
    expect(result.netRevenueCents).toBe(10300);      // total - charity
  });

  test('Applies minimum donation floor', async () => {
    const { calculateAllocation } = require('../src/services/charityService');
    const result = await calculateAllocation(100, 0, 0); // $1 order → 10¢, but min is 50¢
    expect(result.charityAmountCents).toBe(50);
    expect(result.breakdown.minimumApplied).toBe(true);
  });

  test('POST /api/charity/calculate returns breakdown', async () => {
    const res = await request(app).post('/api/charity/calculate')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ subtotalCents: 5400, shippingCents: 800, taxCents: 0 });
    expect(res.status).toBe(200);
    expect(res.body.charity.amount).toBe('$5.40');
    expect(res.body.total).toBe('$62.00');
  });
});

// ── Order Creation & Charity Allocation ───────────────────────────────────────
describe('Order → Charity Allocation Flow', () => {
  test('POST /api/orders/preview shows charity breakdown', async () => {
    const res = await request(app).post('/api/orders/preview')
      .set('Authorization', 'Bearer ' + userToken)
      .send({ items: [{ productId: 1, quantity: 2 }], shippingCents: 800 });
    expect(res.status).toBe(200);
    expect(res.body.charity.percentage).toBe(10);
    expect(res.body.charity.amount).toBe('$17.80'); // 10% of $178 (2x $89)
    expect(res.body.charity.message).toContain('10%');
  });

  test('POST /api/orders creates order with charity auto-allocated', async () => {
    const res = await request(app).post('/api/orders')
      .set('Authorization', 'Bearer ' + userToken)
      .send({ items: [{ productId: 1, quantity: 1 }], shippingCents: 500 });
    expect(res.status).toBe(201);
    expect(res.body.order.id).toBeDefined();
    expect(res.body.order.charity.percentage).toBe(10);
    expect(res.body.order.charity.amount).toBe('$8.90'); // 10% of $89
    createdOrderId = res.body.order.id;
  });

  test('GET /api/orders/:id shows charity_summary', async () => {
    const res = await request(app).get('/api/orders/' + createdOrderId)
      .set('Authorization', 'Bearer ' + userToken);
    expect(res.status).toBe(200);
    expect(res.body.order.charity_summary).toBeDefined();
    expect(res.body.order.charity_summary.amount_cents).toBe(890);
  });

  test('PATCH /api/orders/:id/pay marks paid and records ledger entry', async () => {
    const res = await request(app).patch('/api/orders/' + createdOrderId + '/pay')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paid');
    expect(res.body.charity.allocated).toBe(890);
  });

  test('Ledger has allocation entry after payment', async () => {
    const res = await request(app).get('/api/charity/ledger')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    const alloc = res.body.entries.find(e => e.entry_type === 'allocation' && e.order_id === createdOrderId);
    expect(alloc).toBeDefined();
    expect(alloc.amount_cents).toBe(890);
  });
});

// ── Disbursements ─────────────────────────────────────────────────────────────
describe('Charity Disbursements', () => {
  test('GET /api/charity/balance returns correct balance', async () => {
    const res = await request(app).get('/api/charity/balance')
      .set('Authorization', 'Bearer ' + adminToken);
    expect(res.status).toBe(200);
    expect(res.body.balanceCents).toBeGreaterThan(0);
  });

  test('POST /api/charity/disbursements records payout', async () => {
    const res = await request(app).post('/api/charity/disbursements')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amountCents: 500, recipient: 'Local Food Bank', reference: 'REF-001', notes: 'Monthly donation' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.disbursement.disbursed).toBe(500);
  });

  test('Disbursement reduces ledger balance', async () => {
    const { getCurrentBalance } = require('../src/services/charityService');
    const balance = await getCurrentBalance();
    expect(balance).toBe(390); // 890 allocated - 500 disbursed
  });

  test('Cannot disburse more than available balance', async () => {
    const res = await request(app).post('/api/charity/disbursements')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amountCents: 9999999, recipient: 'Overflow Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('exceeds available balance');
  });
});

// ── Public Impact Endpoint ────────────────────────────────────────────────────
describe('Public Impact Stats', () => {
  test('GET /api/charity/impact returns public numbers', async () => {
    const res = await request(app).get('/api/charity/impact');
    expect(res.status).toBe(200);
    expect(res.body.percentage).toBe(10);
    expect(res.body.impact.totalDonated).toBeDefined();
    expect(res.body.impact.totalOrders).toBeGreaterThanOrEqual(0);
  });
});

// ── Stock management ──────────────────────────────────────────────────────────
describe('Stock management on paid order', () => {
  test('Stock decrements after order paid', async () => {
    const { dbGet } = require('../src/config/database');
    const product = await dbGet('SELECT stock FROM products WHERE id = 1');
    expect(product.stock).toBe(99); // started at 100, sold 1
  });
});
