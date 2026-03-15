// npm run seed — populates DB with demo products and an admin user
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { dbRun, dbGet } = require('./database');

const products = [
  { name: 'Overcomer Hoodie',       category: 'hoodies',     price_cents: 8900,  stock: 50, description: 'Premium heavyweight oversized hoodie. Romans 8:37 embroidered on chest.' },
  { name: 'Romans 8:37 Tee',        category: 'tshirts',     price_cents: 5400,  stock: 80, description: 'Oversized drop shoulder tee. 100% heavyweight cotton.' },
  { name: 'Armor Sweatpants',       category: 'sweatpants',  price_cents: 7200,  stock: 40, description: 'Wide leg fleece sweatpants. Ephesians 6:11 side-leg print.' },
  { name: 'Philippians 4 Tee',      category: 'tshirts',     price_cents: 5800,  stock: 60, description: 'Washed heavyweight. "I can do all things through Christ" back print.' },
  { name: 'Crown of Life Hoodie',   category: 'hoodies',     price_cents: 9400,  stock: 35, description: 'Revelation 2:10 crown motif. Premium brushed fleece.' },
  { name: 'Mountain Mover Tee',     category: 'tshirts',     price_cents: 5600,  stock: 70, description: 'Faith the size of a mustard seed. Matthew 17:20 chest print.' },
  { name: 'Gold Cross Cap',         category: 'accessories', price_cents: 4200,  stock: 90, description: 'Structured snapback. Embroidered gold cross front panel.' },
  { name: 'Gold Cross Bracelet',    category: 'accessories', price_cents: 3800,  stock: 120, description: 'Stainless steel with gold-tone cross charm.' },
  { name: 'Conqueror Chain',        category: 'accessories', price_cents: 6500,  stock: 30, description: '18k gold-plated cross pendant on 24" figaro chain.' },
  { name: 'Faith Sweatpants',       category: 'sweatpants',  price_cents: 6800,  stock: 45, description: 'Relaxed fit. "Walk by Faith" embroidered leg.' }
];

async function seed() {
  console.log('Seeding database...');

  // Admin user
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@conqueror.com';
  const existing = await dbGet('SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (!existing) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin1234', 12);
    await dbRun(
      `INSERT INTO users (email, password, name, role) VALUES (?, ?, 'Conqueror Admin', 'admin')`,
      [adminEmail, hash]
    );
    console.log('Created admin:', adminEmail);
  } else {
    console.log('Admin already exists, skipping.');
  }

  // Products
  for (const p of products) {
    const exists = await dbGet('SELECT id FROM products WHERE name = ?', [p.name]);
    if (!exists) {
      await dbRun(
        `INSERT INTO products (name, description, category, price_cents, stock) VALUES (?, ?, ?, ?, ?)`,
        [p.name, p.description, p.category, p.price_cents, p.stock]
      );
      console.log('Added product:', p.name);
    }
  }

  console.log('Seed complete.');
  process.exit(0);
}

seed().catch(e => { console.error('Seed failed:', e); process.exit(1); });
