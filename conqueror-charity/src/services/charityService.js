// ─────────────────────────────────────────────────────────────────────────────
// charityService.js
// Core engine: calculates, records, and reports all charity allocations.
// ─────────────────────────────────────────────────────────────────────────────
const { dbRun, dbGet, dbAll } = require('../config/database');

// ── 1. Fetch the currently active charity config ──────────────────────────────
async function getActiveConfig() {
  const config = await dbGet(
    `SELECT * FROM charity_config WHERE is_active = 1 ORDER BY id DESC LIMIT 1`
  );
  if (!config) throw new Error('No active charity configuration found.');
  return config;
}

// ── 2. Calculate charity amount for a given order total ───────────────────────
//   Returns a plain object — does NOT write to DB. Call this before creating an order.
async function calculateAllocation(subtotalCents, shippingCents = 0, taxCents = 0) {
  const config = await getActiveConfig();

  const totalCents = subtotalCents + shippingCents + taxCents;

  // Charity is calculated on subtotal only (pre-tax, pre-shipping is standard practice)
  const rawCharity = Math.round(subtotalCents * (config.percentage / 100));
  const charityAmountCents = Math.max(rawCharity, config.min_amount_cents);
  const netRevenueCents = totalCents - charityAmountCents;

  return {
    subtotalCents,
    shippingCents,
    taxCents,
    totalCents,
    charityConfig: {
      id: config.id,
      name: config.cause_name,
      percentage: config.percentage
    },
    charityAmountCents,
    netRevenueCents,
    breakdown: {
      baseCalculation: `${subtotalCents}¢ × ${config.percentage}% = ${rawCharity}¢`,
      minimumApplied: rawCharity < config.min_amount_cents,
      minimumCents: config.min_amount_cents
    }
  };
}

// ── 3. Record an allocation after an order is confirmed ───────────────────────
async function recordAllocation(orderId, charityAmountCents, createdBy = null) {
  // Get running balance
  const last = await dbGet(
    `SELECT balance_after_cents FROM charity_ledger ORDER BY id DESC LIMIT 1`
  );
  const prevBalance = last ? last.balance_after_cents : 0;
  const newBalance = prevBalance + charityAmountCents;

  await dbRun(
    `INSERT INTO charity_ledger
       (order_id, entry_type, amount_cents, balance_after_cents, description, created_by)
     VALUES (?, 'allocation', ?, ?, ?, ?)`,
    [orderId, charityAmountCents, newBalance,
     `Auto-allocation from order #${orderId}`, createdBy]
  );
  return { previousBalance: prevBalance, added: charityAmountCents, newBalance };
}

// ── 4. Record a disbursement (admin pays out to charity) ─────────────────────
async function recordDisbursement({ amountCents, recipient, reference, notes, disbursedBy }) {
  const last = await dbGet(
    `SELECT balance_after_cents FROM charity_ledger ORDER BY id DESC LIMIT 1`
  );
  const prevBalance = last ? last.balance_after_cents : 0;

  if (amountCents > prevBalance) {
    throw new Error(
      `Disbursement of ${amountCents}¢ exceeds available balance of ${prevBalance}¢`
    );
  }

  const newBalance = prevBalance - amountCents;

  // Write to ledger (negative amount = outflow)
  await dbRun(
    `INSERT INTO charity_ledger
       (order_id, entry_type, amount_cents, balance_after_cents, description, created_by)
     VALUES (NULL, 'disbursement', ?, ?, ?, ?)`,
    [-amountCents, newBalance, `Disbursement to: ${recipient}`, disbursedBy]
  );

  // Write to disbursements table
  const result = await dbRun(
    `INSERT INTO charity_disbursements
       (amount_cents, recipient, reference, notes, disbursed_by)
     VALUES (?, ?, ?, ?, ?)`,
    [amountCents, recipient, reference || null, notes || null, disbursedBy]
  );

  return {
    disbursementId: result.lastID,
    previousBalance: prevBalance,
    disbursed: amountCents,
    newBalance
  };
}

// ── 5. Get current balance ────────────────────────────────────────────────────
async function getCurrentBalance() {
  const row = await dbGet(
    `SELECT balance_after_cents FROM charity_ledger ORDER BY id DESC LIMIT 1`
  );
  return row ? row.balance_after_cents : 0;
}

// ── 6. Summary stats for the dashboard ───────────────────────────────────────
async function getSummaryStats() {
  const [totalAllocated, totalDisbursed, orderCount, config, balance] = await Promise.all([
    dbGet(`SELECT COALESCE(SUM(amount_cents), 0) AS total
           FROM charity_ledger WHERE entry_type = 'allocation'`),
    dbGet(`SELECT COALESCE(SUM(amount_cents), 0) AS total
           FROM charity_disbursements`),
    dbGet(`SELECT COUNT(*) AS cnt FROM orders WHERE status = 'paid'`),
    getActiveConfig(),
    getCurrentBalance()
  ]);

  // Monthly breakdown (last 12 months)
  const monthly = await dbAll(
    `SELECT strftime('%Y-%m', created_at) AS month,
            SUM(CASE WHEN entry_type = 'allocation' THEN amount_cents ELSE 0 END) AS allocated,
            SUM(CASE WHEN entry_type = 'disbursement' THEN ABS(amount_cents) ELSE 0 END) AS disbursed,
            COUNT(CASE WHEN entry_type = 'allocation' THEN 1 END) AS orders
     FROM charity_ledger
     WHERE created_at >= datetime('now', '-12 months')
     GROUP BY month ORDER BY month DESC`
  );

  return {
    config: {
      percentage: config.percentage,
      causeName: config.cause_name,
      causeDesc: config.cause_desc
    },
    totals: {
      allocatedCents: totalAllocated.total,
      disbursedCents: totalDisbursed.total,
      availableBalanceCents: balance,
      ordersWithDonation: orderCount.cnt
    },
    monthly,
    formatted: {
      allocated: formatCurrency(totalAllocated.total),
      disbursed: formatCurrency(totalDisbursed.total),
      balance: formatCurrency(balance)
    }
  };
}

// ── 7. Full ledger (paginated) ────────────────────────────────────────────────
async function getLedger({ page = 1, limit = 20, type = null } = {}) {
  const offset = (page - 1) * limit;
  const typeFilter = type ? `AND entry_type = ?` : '';
  const params = type ? [type, limit, offset] : [limit, offset];

  const [rows, count] = await Promise.all([
    dbAll(
      `SELECT l.*, o.total_cents AS order_total, u.email AS created_by_email
       FROM charity_ledger l
       LEFT JOIN orders o ON l.order_id = o.id
       LEFT JOIN users  u ON l.created_by = u.id
       WHERE 1=1 ${typeFilter}
       ORDER BY l.id DESC LIMIT ? OFFSET ?`,
      params
    ),
    dbGet(
      `SELECT COUNT(*) AS cnt FROM charity_ledger WHERE 1=1 ${typeFilter}`,
      type ? [type] : []
    )
  ]);

  return {
    entries: rows,
    pagination: { page, limit, total: count.cnt, pages: Math.ceil(count.cnt / limit) }
  };
}

// ── 8. Update charity config (admin only) ─────────────────────────────────────
async function updateConfig({ percentage, minAmountCents, causeName, causeDesc }) {
  if (percentage < 0 || percentage > 100) throw new Error('Percentage must be 0–100');

  await dbRun(
    `UPDATE charity_config
     SET percentage = ?, min_amount_cents = ?, cause_name = ?,
         cause_desc = ?, updated_at = datetime('now')
     WHERE is_active = 1`,
    [percentage, minAmountCents, causeName, causeDesc]
  );
  return getActiveConfig();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatCurrency(cents) {
  return '$' + (cents / 100).toFixed(2);
}

module.exports = {
  getActiveConfig,
  calculateAllocation,
  recordAllocation,
  recordDisbursement,
  getCurrentBalance,
  getSummaryStats,
  getLedger,
  updateConfig
};
