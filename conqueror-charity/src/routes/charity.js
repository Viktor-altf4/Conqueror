// ─────────────────────────────────────────────────────────────────────────────
// charity.js routes
// /api/charity  — public stats + admin management
// ─────────────────────────────────────────────────────────────────────────────
const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const charity = require('../services/charityService');

// ── PUBLIC ────────────────────────────────────────────────────────────────────

// GET /api/charity/impact — public-facing impact numbers for the website
router.get('/impact', async (req, res) => {
  try {
    const stats = await charity.getSummaryStats();
    res.json({
      cause: stats.config.causeName,
      description: stats.config.causeDesc,
      percentage: stats.config.percentage,
      impact: {
        totalDonated: stats.formatted.allocated,
        totalOrders: stats.totals.ordersWithDonation,
        availableToDisburse: stats.formatted.balance
      },
      monthly: stats.monthly.slice(0, 6)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/charity/config — current donation settings (public)
router.get('/config', async (req, res) => {
  try {
    const config = await charity.getActiveConfig();
    res.json({
      percentage: config.percentage,
      causeName: config.cause_name,
      causeDesc: config.cause_desc,
      minAmountCents: config.min_amount_cents
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ADMIN ─────────────────────────────────────────────────────────────────────

// GET /api/charity/dashboard — full stats for admin
router.get('/dashboard', authenticate, requireAdmin, async (req, res) => {
  try {
    const stats = await charity.getSummaryStats();
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/charity/ledger — full audit ledger
router.get('/ledger', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await charity.getLedger({
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      type: req.query.type || null
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/charity/config — update donation percentage
router.patch('/config',
  authenticate, requireAdmin,
  body('percentage').isFloat({ min: 0, max: 100 }),
  body('minAmountCents').optional().isInt({ min: 0 }),
  body('causeName').optional().trim().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const current = await charity.getActiveConfig();
      const updated = await charity.updateConfig({
        percentage: req.body.percentage,
        minAmountCents: req.body.minAmountCents !== undefined ? req.body.minAmountCents : current.min_amount_cents,
        causeName: req.body.causeName || current.cause_name,
        causeDesc: req.body.causeDesc || current.cause_desc
      });
      res.json({ config: updated, message: 'Charity config updated. New orders will use the updated percentage.' });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// POST /api/charity/calculate — simulate allocation for any amount (admin/dev tool)
router.post('/calculate',
  authenticate, requireAdmin,
  body('subtotalCents').isInt({ min: 1 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const { subtotalCents, shippingCents = 0, taxCents = 0 } = req.body;
      const result = await charity.calculateAllocation(subtotalCents, shippingCents, taxCents);
      res.json({
        input: { subtotal: '$' + (subtotalCents / 100).toFixed(2) },
        charity: {
          percentage: result.charityConfig.percentage,
          amount: '$' + (result.charityAmountCents / 100).toFixed(2),
          amountCents: result.charityAmountCents
        },
        total: '$' + (result.totalCents / 100).toFixed(2),
        netRevenue: '$' + (result.netRevenueCents / 100).toFixed(2),
        breakdown: result.breakdown
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// POST /api/charity/disbursements — record a payout to charity
router.post('/disbursements',
  authenticate, requireAdmin,
  body('amountCents').isInt({ min: 1 }),
  body('recipient').trim().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    try {
      const result = await charity.recordDisbursement({
        amountCents: req.body.amountCents,
        recipient: req.body.recipient,
        reference: req.body.reference,
        notes: req.body.notes,
        disbursedBy: req.user.id
      });
      res.status(201).json({
        success: true,
        disbursement: result,
        message: '$' + (req.body.amountCents / 100).toFixed(2) + ' disbursed to ' + req.body.recipient
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// GET /api/charity/balance — current available balance
router.get('/balance', authenticate, requireAdmin, async (req, res) => {
  try {
    const balanceCents = await charity.getCurrentBalance();
    res.json({
      balanceCents,
      balance: '$' + (balanceCents / 100).toFixed(2),
      message: 'Funds available for disbursement'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
