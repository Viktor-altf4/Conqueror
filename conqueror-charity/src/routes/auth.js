const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { dbRun, dbGet } = require('../config/database');
const { authenticate } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('name').trim().notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, name } = req.body;
    try {
      const existing = await dbGet(`SELECT id FROM users WHERE email = ?`, [email]);
      if (existing) return res.status(409).json({ error: 'Email already registered' });

      const hash = await bcrypt.hash(password, 12);
      const result = await dbRun(
        `INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, 'customer')`,
        [email, hash, name]
      );
      const token = jwt.sign({ id: result.lastID }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
      res.status(201).json({ token, user: { id: result.lastID, email, name, role: 'customer' } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// POST /api/auth/login
router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password } = req.body;
    try {
      const user = await dbGet(`SELECT * FROM users WHERE email = ?`, [email]);
      if (!user) return res.status(401).json({ error: 'Invalid credentials' });

      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(401).json({ error: 'Invalid credentials' });

      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
      res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
