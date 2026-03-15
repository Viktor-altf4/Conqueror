// ─────────────────────────────────────────────────────────────────────────────
// webhook.js — Stripe webhook handler
// This must be registered BEFORE express.json() in server.js (raw body needed).
// ─────────────────────────────────────────────────────────────────────────────
const router = require('express').Router();
const { markOrderPaid } = require('../services/orderService');

router.post('/', async (req, res) => {
  // Verify Stripe signature if secret is configured
  let event = req.body;

  if (process.env.STRIPE_WEBHOOK_SECRET && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(
        req.rawBody || req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (e) {
      console.error('Webhook signature verification failed:', e.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const pi = event.data.object;
        const orderId = pi.metadata && pi.metadata.order_id;
        if (orderId) {
          await markOrderPaid(parseInt(orderId), {
            paymentIntentId: pi.id,
            chargeId: pi.latest_charge
          });
          console.log('Order ' + orderId + ' marked paid via Stripe webhook');
        }
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        const { dbRun } = require('../config/database');
        const orderId = pi.metadata && pi.metadata.order_id;
        if (orderId) {
          await dbRun(`UPDATE orders SET status = 'failed', updated_at = datetime('now') WHERE id = ?`, [orderId]);
        }
        break;
      }
      default:
        // Unhandled event type — ignore
    }
    res.json({ received: true });
  } catch (e) {
    console.error('Webhook handler error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
