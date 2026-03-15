// ─────────────────────────────────────────────────────────────────────────────
// orderService.js
// Creates orders with automatic charity allocation baked in.
// ─────────────────────────────────────────────────────────────────────────────
const { dbRun, dbGet, dbAll } = require('../config/database');
const { calculateAllocation, recordAllocation } = require('./charityService');

// ── Create order (charity auto-calculated) ────────────────────────────────────
async function createOrder({ userId, items, shippingCents = 0, taxCents = 0, shippingAddress, notes }) {
  if (!items || items.length === 0) throw new Error('Order must have at least one item');

  // 1. Load products and validate stock
  const productIds = items.map(i => i.productId);
  const placeholders = productIds.map(() => '?').join(',');
  const products = await dbAll(
    `SELECT * FROM products WHERE id IN (${placeholders}) AND active = 1`,
    productIds
  );

  if (products.length !== productIds.length) {
    throw new Error('One or more products not found or inactive');
  }

  const productMap = {};
  products.forEach(p => { productMap[p.id] = p; });

  for (const item of items) {
    const p = productMap[item.productId];
    if (!p) throw new Error(`Product ${item.productId} not found`);
    if (p.stock < item.quantity) {
      throw new Error(`Insufficient stock for "${p.name}" (available: ${p.stock})`);
    }
  }

  // 2. Build line items and subtotal
  const lineItems = items.map(item => {
    const p = productMap[item.productId];
    return {
      productId: p.id,
      productName: p.name,
      quantity: item.quantity,
      unitPriceCents: p.price_cents,
      lineTotalCents: p.price_cents * item.quantity
    };
  });
  const subtotalCents = lineItems.reduce((s, li) => s + li.lineTotalCents, 0);

  // 3. Calculate charity allocation (the magic happens here)
  const allocation = await calculateAllocation(subtotalCents, shippingCents, taxCents);

  // 4. Insert order row
  const orderResult = await dbRun(
    `INSERT INTO orders
       (user_id, subtotal_cents, shipping_cents, tax_cents, total_cents,
        charity_percentage, charity_amount_cents, net_revenue_cents,
        status, shipping_address, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [
      userId,
      allocation.subtotalCents,
      allocation.shippingCents,
      allocation.taxCents,
      allocation.totalCents,
      allocation.charityConfig.percentage,
      allocation.charityAmountCents,
      allocation.netRevenueCents,
      shippingAddress ? JSON.stringify(shippingAddress) : null,
      notes || null
    ]
  );
  const orderId = orderResult.lastID;

  // 5. Insert line items
  for (const li of lineItems) {
    await dbRun(
      `INSERT INTO order_items
         (order_id, product_id, product_name, quantity, unit_price_cents, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, li.productId, li.productName, li.quantity, li.unitPriceCents, li.lineTotalCents]
    );
  }

  return {
    orderId,
    ...allocation,
    lineItems,
    status: 'pending'
  };
}

// ── Mark order paid (called by Stripe webhook or manual confirmation) ─────────
async function markOrderPaid(orderId, stripeData = {}) {
  const order = await dbGet(`SELECT * FROM orders WHERE id = ?`, [orderId]);
  if (!order) throw new Error(`Order ${orderId} not found`);
  if (order.status === 'paid') return order; // idempotent

  // Update order status
  await dbRun(
    `UPDATE orders SET status = 'paid', stripe_payment_intent = ?,
     stripe_charge_id = ?, updated_at = datetime('now') WHERE id = ?`,
    [stripeData.paymentIntentId || null, stripeData.chargeId || null, orderId]
  );

  // Deduct stock for each line item
  const items = await dbAll(`SELECT * FROM order_items WHERE order_id = ?`, [orderId]);
  for (const item of items) {
    await dbRun(
      `UPDATE products SET stock = stock - ? WHERE id = ?`,
      [item.quantity, item.product_id]
    );
  }

  // Record charity allocation in the ledger (audit trail)
  const ledgerEntry = await recordAllocation(orderId, order.charity_amount_cents);

  return {
    orderId,
    status: 'paid',
    charity: {
      allocated: order.charity_amount_cents,
      percentage: order.charity_percentage,
      ledger: ledgerEntry
    }
  };
}

// ── Fetch order with full detail ──────────────────────────────────────────────
async function getOrder(orderId, userId = null) {
  const whereUser = userId ? `AND o.user_id = ${userId}` : '';
  const order = await dbGet(
    `SELECT o.*, u.email AS customer_email, u.name AS customer_name
     FROM orders o LEFT JOIN users u ON o.user_id = u.id
     WHERE o.id = ? ${whereUser}`,
    [orderId]
  );
  if (!order) return null;

  const items = await dbAll(
    `SELECT * FROM order_items WHERE order_id = ?`, [orderId]
  );

  const charityFormatted = (order.charity_amount_cents / 100).toFixed(2);
  const totalFormatted = (order.total_cents / 100).toFixed(2);

  return {
    ...order,
    shipping_address: order.shipping_address ? JSON.parse(order.shipping_address) : null,
    items,
    charity_summary: {
      percentage: order.charity_percentage,
      amount_cents: order.charity_amount_cents,
      amount_formatted: '$' + charityFormatted,
      message: `$${charityFormatted} of your $${totalFormatted} order goes to ${order.charity_percentage}% community outreach`
    }
  };
}

// ── List orders (admin: all; customer: own) ───────────────────────────────────
async function listOrders({ userId = null, status = null, page = 1, limit = 20 } = {}) {
  const offset = (page - 1) * limit;
  const conditions = [];
  const params = [];

  if (userId) { conditions.push('o.user_id = ?'); params.push(userId); }
  if (status)  { conditions.push('o.status = ?');   params.push(status); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const [orders, count] = await Promise.all([
    dbAll(
      `SELECT o.id, o.status, o.total_cents, o.charity_amount_cents,
              o.charity_percentage, o.created_at, u.email AS customer_email
       FROM orders o LEFT JOIN users u ON o.user_id = u.id
       ${where} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    ),
    dbGet(`SELECT COUNT(*) AS cnt FROM orders o ${where}`, params)
  ]);

  return {
    orders,
    pagination: { page, limit, total: count.cnt, pages: Math.ceil(count.cnt / limit) }
  };
}

module.exports = { createOrder, markOrderPaid, getOrder, listOrders };
