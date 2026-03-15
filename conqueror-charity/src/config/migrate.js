// Database schema migration — run once with: npm run migrate
require('dotenv').config();
const { dbRun, getDb } = require('./database');

const schema = [
  // ── Users ──────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    NOT NULL UNIQUE,
    password    TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    role        TEXT    NOT NULL DEFAULT 'customer',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Products ───────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS products (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    description   TEXT,
    category      TEXT    NOT NULL,
    price_cents   INTEGER NOT NULL,
    stock         INTEGER NOT NULL DEFAULT 0,
    image_url     TEXT,
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Charity Config ─────────────────────────────────────────────────────────
  // One row per named config. Only one row should have is_active = 1.
  `CREATE TABLE IF NOT EXISTS charity_config (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT    NOT NULL DEFAULT 'Default',
    percentage      REAL    NOT NULL DEFAULT 10.0,
    min_amount_cents INTEGER NOT NULL DEFAULT 50,
    cause_name      TEXT    NOT NULL DEFAULT 'Community Outreach Fund',
    cause_desc      TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Orders ─────────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS orders (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id               INTEGER REFERENCES users(id),
    subtotal_cents        INTEGER NOT NULL,
    shipping_cents        INTEGER NOT NULL DEFAULT 0,
    tax_cents             INTEGER NOT NULL DEFAULT 0,
    total_cents           INTEGER NOT NULL,
    charity_percentage    REAL    NOT NULL,
    charity_amount_cents  INTEGER NOT NULL,
    net_revenue_cents     INTEGER NOT NULL,
    status                TEXT    NOT NULL DEFAULT 'pending',
    stripe_payment_intent TEXT,
    stripe_charge_id      TEXT,
    shipping_address      TEXT,
    notes                 TEXT,
    created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Order Items ────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS order_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id      INTEGER NOT NULL REFERENCES orders(id),
    product_id    INTEGER NOT NULL REFERENCES products(id),
    product_name  TEXT    NOT NULL,
    quantity      INTEGER NOT NULL,
    unit_price_cents INTEGER NOT NULL,
    line_total_cents INTEGER NOT NULL
  )`,

  // ── Charity Ledger ─────────────────────────────────────────────────────────
  // Immutable append-only log of every charity allocation + disbursement.
  `CREATE TABLE IF NOT EXISTS charity_ledger (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id      INTEGER REFERENCES orders(id),
    entry_type    TEXT    NOT NULL,  -- 'allocation' | 'disbursement' | 'adjustment'
    amount_cents  INTEGER NOT NULL,
    balance_after_cents INTEGER NOT NULL,
    description   TEXT,
    created_by    INTEGER REFERENCES users(id),
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Charity Disbursements ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS charity_disbursements (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    amount_cents    INTEGER NOT NULL,
    recipient       TEXT    NOT NULL,
    reference       TEXT,
    notes           TEXT,
    disbursed_by    INTEGER REFERENCES users(id),
    disbursed_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,

  // ── Indexes ────────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_order   ON charity_ledger(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ledger_type    ON charity_ledger(entry_type)`
];

async function migrate() {
  console.log('Running migrations...');
  for (const sql of schema) {
    await dbRun(sql);
  }

  // Seed default charity config if none exists
  const existing = await new Promise((res, rej) => {
    getDb().get('SELECT id FROM charity_config LIMIT 1', [], (e, r) => e ? rej(e) : res(r));
  });
  if (!existing) {
    await dbRun(
      `INSERT INTO charity_config (name, percentage, min_amount_cents, cause_name, cause_desc, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [
        'Default Config',
        parseFloat(process.env.CHARITY_PERCENTAGE || '10'),
        parseInt(process.env.CHARITY_MIN_AMOUNT_CENTS || '50'),
        'Community Outreach Fund',
        '10% of every Conqueror order supports feeding programs, missions, and youth outreach.'
      ]
    );
    console.log('Seeded default charity config (10%)');
  }

  console.log('Migrations complete.');
  process.exit(0);
}

migrate().catch(e => { console.error('Migration failed:', e); process.exit(1); });
