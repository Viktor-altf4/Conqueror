const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { dbRun, dbGet, dbAll } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');

// GET /api/products — public
router.get('/', async (req, res) => {
  const { category, search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const conditions = ['active = 1'];
  const params = [];

  if (category) { conditions.push('category = ?'); params.push(category); }
  if (search)   { conditions.push("name LIKE ?");   params.push('%' + search + '%'); }

  const where = 'WHERE ' + conditions.join(' AND ');
  const [products, count] = await Promise.all([
    dbAll(`SELECT * FROM products ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, [...params, parseInt(limit), offset]),
    dbGet(`SELECT COUNT(*) AS cnt FROM products ${where}`, params)
  ]);

  res.json({ products, pagination: { page: parseInt(page), limit: parseInt(limit), total: count.cnt } });
});

// GET /api/products/:id — public
router.get('/:id', async (req, res) => {
  const product = await dbGet(`SELECT * FROM products WHERE id = ? AND active = 1`, [req.params.id]);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json({ product });
});

// POST /api/products — admin only
router.post('/',
  authenticate, requireAdmin,
  body('name').trim().notEmpty(),
  body('category').trim().notEmpty(),
  body('price_cents').isInt({ min: 1 }),
  body('stock').isInt({ min: 0 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { name, description, category, price_cents, stock, image_url } = req.body;
    const result = await dbRun(
      `INSERT INTO products (name, description, category, price_cents, stock, image_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, description || null, category, price_cents, stock, image_url || null]
    );
    const product = await dbGet(`SELECT * FROM products WHERE id = ?`, [result.lastID]);
    res.status(201).json({ product });
  }
);

// PATCH /api/products/:id — admin only
router.patch('/:id', authenticate, requireAdmin, async (req, res) => {
  const { name, description, category, price_cents, stock, image_url, active } = req.body;
  await dbRun(
    `UPDATE products SET
       name = COALESCE(?, name), description = COALESCE(?, description),
       category = COALESCE(?, category), price_cents = COALESCE(?, price_cents),
       stock = COALESCE(?, stock), image_url = COALESCE(?, image_url),
       active = COALESCE(?, active)
     WHERE id = ?`,
    [name, description, category, price_cents, stock, image_url, active, req.params.id]
  );
  const product = await dbGet(`SELECT * FROM products WHERE id = ?`, [req.params.id]);
  res.json({ product });
});

module.exports = router;
