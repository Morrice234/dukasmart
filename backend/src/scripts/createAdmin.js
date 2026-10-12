// Creates an admin, or resets the password of an existing one.
// Easiest:   npm run create-admin          (asks for email, name and password)
// Or:        npm run create-admin -- you@example.com Password123 "Your Name"
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a)));
}

function describeDb() {
  try {
    const u = new URL(process.env.DATABASE_URL);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(DATABASE_URL is not set or not valid)';
  }
}

(async () => {
  let [email, password, name] = process.argv.slice(2);

  if (!email || !password) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    email = await ask(rl, 'Admin email: ');
    name = await ask(rl, 'Your name (optional): ');
    password = await ask(rl, 'Password (at least 8 characters): ');
    const again = await ask(rl, 'Type the password again: ');
    rl.close();
    if (password !== again) {
      console.error('The two passwords do not match. Nothing was saved.');
      process.exit(1);
    }
  }

  email = String(email || '').trim().toLowerCase();
  password = String(password || '');
  if (!email.includes('@')) {
    console.error('Enter a valid email address.');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }
  if (/^['"]|['"]$/.test(password) || password !== password.trim()) {
    console.warn('Warning: your password starts or ends with a quote or a space. Those characters are now part of it.');
  }

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO admins (email, password_hash, name) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET password_hash = $2, name = COALESCE($3, admins.name)`,
    [email, hash, name ? String(name).trim() : null]
  );

  const admins = (await pool.query('SELECT email FROM admins ORDER BY created_at')).rows.map((r) => r.email);
  console.log(`\nSaved admin ${email} (password is ${password.length} characters long)`);
  console.log(`Database: ${describeDb()}`);
  console.log(`All admins in this database: ${admins.join(', ')}`);
  console.log('Sign in to the admin panel with exactly this email and password.');
  await pool.end();
})().catch((err) => {
  console.error(err.code === 'ECONNREFUSED'
    ? `Could not connect to the database at ${describeDb()}. Is Docker Desktop running? Try: npm run db:up`
    : err);
  process.exit(1);
});
