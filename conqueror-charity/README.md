# Conqueror — Charity Allocation Backend

> **Faith. Strength. Victory.**  
> Every order automatically calculates and logs a percentage donation to charity.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET, STRIPE keys, CHARITY_PERCENTAGE

# 3. Create database & tables
npm run migrate

# 4. Seed demo products & admin user
npm run seed

# 5. Start the server
npm run dev       # development (nodemon)
npm start         # production
```

Server runs at `http://localhost:4000`

---

## How the Charity System Works

```
Customer places order
        │
        ▼
┌─────────────────────────────────┐
│  calculateAllocation()          │
│  ─────────────────────────────  │
│  subtotal × CHARITY_PERCENTAGE  │
│  (default 10%)                  │
│                                 │
│  min floor = $0.50              │
│  charity stored on order row    │
└──────────────┬──────────────────┘
               │
               ▼
    Order created (status: pending)
    • charity_amount_cents  ← locked in
    • charity_percentage    ← locked in
    • net_revenue_cents     ← total - charity
               │
               ▼ (Stripe webhook or manual)
    Order marked PAID
               │
               ▼
┌──────────────────────────────────┐
│  charity_ledger (append-only)    │
│  entry_type: 'allocation'        │
│  amount_cents: e.g. 890          │
│  balance_after_cents: running    │
└──────────────┬───────────────────┘
               │
               ▼ (Admin action)
    POST /api/charity/disbursements
    Records payout to real charity
    Ledger entry_type: 'disbursement'
    Balance reduced accordingly
```

---

## API Reference

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | — | Register customer |
| POST | `/api/auth/login` | — | Login → JWT token |
| GET | `/api/auth/me` | Bearer | Current user |

### Products
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/products` | — | List products (filter: `?category=hoodies`) |
| GET | `/api/products/:id` | — | Single product |
| POST | `/api/products` | Admin | Create product |
| PATCH | `/api/products/:id` | Admin | Update product/stock |

### Orders
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/orders/preview` | Bearer | Preview order + charity amount (no DB write) |
| POST | `/api/orders` | Bearer | Create order (charity auto-calculated) |
| GET | `/api/orders` | Bearer | List own orders (admin: all orders) |
| GET | `/api/orders/:id` | Bearer | Order detail with `charity_summary` |
| PATCH | `/api/orders/:id/pay` | Admin | Mark paid, trigger ledger allocation |

### Charity
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/charity/config` | — | Active donation % (public) |
| GET | `/api/charity/impact` | — | Public impact numbers for website |
| GET | `/api/charity/dashboard` | Admin | Full stats + monthly breakdown |
| PATCH | `/api/charity/config` | Admin | Update donation percentage |
| POST | `/api/charity/calculate` | Admin | Simulate charity calc for any amount |
| GET | `/api/charity/ledger` | Admin | Full audit ledger (paginated) |
| GET | `/api/charity/balance` | Admin | Current undisbursed balance |
| POST | `/api/charity/disbursements` | Admin | Record payout to charity |

### Stripe Webhook
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/webhook` | Stripe `payment_intent.succeeded` → auto marks order paid + records allocation |

---

## Example: Full Order Flow

```bash
# 1. Preview order (see charity before committing)
curl -X POST http://localhost:4000/api/orders/preview \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"items": [{"productId": 1, "quantity": 2}], "shippingCents": 800}'

# Response:
{
  "charity": {
    "percentage": 10,
    "amount": "$17.80",
    "message": "10% of your order ($17.80) goes directly to Community Outreach Fund"
  },
  "pricing": { "subtotal": "$178.00", "total": "$186.00" }
}

# 2. Create the order
curl -X POST http://localhost:4000/api/orders \
  -H "Authorization: Bearer <token>" \
  -d '{"items": [{"productId": 1, "quantity": 2}]}'

# Response:
{
  "order": {
    "id": 1,
    "charity": {
      "percentage": 10,
      "amount": "$17.80",
      "cause": "Community Outreach Fund"
    }
  }
}

# 3. Check charity balance (admin)
curl http://localhost:4000/api/charity/balance \
  -H "Authorization: Bearer <admin-token>"

# 4. Disburse funds to charity (admin)
curl -X POST http://localhost:4000/api/charity/disbursements \
  -H "Authorization: Bearer <admin-token>" \
  -d '{"amountCents": 5000, "recipient": "Local Food Bank", "reference": "FEB-2026"}'
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port |
| `JWT_SECRET` | — | **Required.** Secret for signing JWTs |
| `JWT_EXPIRES_IN` | `7d` | Token expiry |
| `DB_PATH` | `./conqueror.db` | SQLite file path |
| `CHARITY_PERCENTAGE` | `10` | % of subtotal donated |
| `CHARITY_MIN_AMOUNT_CENTS` | `50` | Minimum donation per order (cents) |
| `STRIPE_SECRET_KEY` | — | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | — | Stripe webhook signing secret |

---

## Database Schema

```
users               — customers & admins
products            — clothing & accessories inventory
charity_config      — active donation percentage & cause name
orders              — every order with charity_amount_cents locked in
order_items         — line items per order
charity_ledger      — immutable audit log (allocations + disbursements)
charity_disbursements — record of actual payouts to charity partners
```

---

## Running Tests

```bash
npm test
```

Tests cover:
- Auth registration & login
- Charity % calculation (including minimum floor)
- Order preview with charity breakdown
- Order creation → auto allocation
- Ledger entry on payment
- Disbursement flow & balance tracking
- Overspend protection
- Public impact endpoint
- Stock decrement on paid orders

---

## Adjusting the Charity Percentage

Change it live via the admin API — no restart needed:

```bash
curl -X PATCH http://localhost:4000/api/charity/config \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"percentage": 15, "causeName": "Global Missions Fund"}'
```

All future orders will use the new percentage. Existing orders are unaffected (percentage is locked in at order creation time).

---

*"In all these things we are more than conquerors through him who loved us." — Romans 8:37*
