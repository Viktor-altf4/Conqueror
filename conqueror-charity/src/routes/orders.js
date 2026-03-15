const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { createOrder, markOrderPaid, getOrder, listOrders } = require('../services/orderService');
const { calculateAllocation } = require('../services/charityService');

// POST /api/orders/preview — show charity breakdown before checkout
router.post('/preview',
  authenticate,
  body('items').isArray({ min: 1 }),
  body('items.*.productId').isInt(),
  body('items.*.quantity').isInt({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { items, shippingCents = 0, taxCents = 0 } = req.body;
      const { dbAll } = require('../config/database');
      const ids = items.map(i => i.productId);
      const products = await dbAll(
        `SELECT id, name, price_cents FROM products WHERE id IN (${ids.map(() => '?').join(',')}) AND active = 1`,
        ids
      );
      const productMap = {};
      products.forEach(p => { productMap[p.id] = p; });

      let subtotalCents = 0;
      const lineItems = items.map(item => {
        const p = productMap[item.productId];
        if (!p) throw new Error('Product ' + item.productId + ' not found');
        const lineTotal = p.price_cents * item.quantity;
        subtotalCents += lineTotal;
        return { product: p.name, quantity: item.quantity, unitPrice: '$' + (p.price_cents / 100).toFixed(2), lineTotal: '$' + (lineTotal / 100).toFixed(2) };
      });

      const allocation = await calculateAllocation(subtotalCents, parseInt(shippingCents), parseInt(taxCents));

      res.json({
        lineItems,
        pricing: {
          subtotal: '$' + (allocation.subtotalCents / 100).toFixed(2),
          shipping: '$' + (allocation.shippingCents / 100).toFixed(2),
          tax:      '$' + (allocation.taxCents / 100).toFixed(2),
          total:    '$' + (allocation.totalCents / 100).toFixed(2)
        },
        charity: {
          causeName:  allocation.charityConfig.name,
          percentage: allocation.charityConfig.percentage,
          amount:     '$' + (allocation.charityAmountCents / 100).toFixed(2),
          message:    allocation.charityConfig.percentage + '% of your order (' + '$' + (allocation.charityAmountCents / 100).toFixed(2) + ') goes directly to ' + allocation.charityConfig.name,
          breakdown:  allocation.breakdown
        },
        netRevenue: '$' + (allocation.netRevenueCents / 100).toFixed(2)
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// POST /api/orders — create order with auto charity allocation
router.post('/',
  authenticate,
  body('items').isArray({ min: 1 }),
  body('items.*.productId').isInt(),
  body('items.*.quantity').isInt({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { items, shippingCents = 0, taxCents = 0, shippingAddress, notes } = req.body;
      const result = await createOrder({
        userId: req.user.id,
        items,
        shippingCents: parseInt(shippingCents),
        taxCents: parseInt(taxCents),
        shippingAddress,
        notes
      });

      res.status(201).json({
        order: {
          id: result.orderId,
          status: result.status,
          total: '$' + (result.totalCents / 100).toFixed(2),
          charity: {
            percentage: result.charityConfig.percentage,
            amount: '$' + (result.charityAmountCents / 100).toFixed(2),
            cause: result.charityConfig.name,
            message: result.charityConfig.percentage + '% of your order goes to ' + result.charityConfig.name
          }
        }
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// GET /api/orders — list customer's own orders
router.get('/', authenticate, async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const result = await listOrders({
    userId: isAdmin ? null : req.user.id,
    status: req.query.status || null,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20
  });
  res.json(result);
});

// GET /api/orders/:id
router.get('/:id', authenticate, async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const order = await getOrder(req.params.id, isAdmin ? null : req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({ order });
});

// PATCH /api/orders/:id/pay — admin: manually mark as paid (for testing)
router.patch('/:id/pay', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await markOrderPaid(req.params.id, req.body.stripeData || {});
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
