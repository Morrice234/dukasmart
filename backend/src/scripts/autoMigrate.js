const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

// Bump this whenever schema.sql changes. The full schema only runs when the database is behind,
// so normal restarts (Render wakes the server often) stay fast.
const SCHEMA_VERSION = 7;

module.exports = async function autoMigrate() {
  const current = await pool.query("SELECT value FROM settings WHERE key = 'schema_version'")
    .then((r) => Number(r.rows[0] && r.rows[0].value) || 0)
    .catch(() => 0); // settings table missing means a brand new database
  if (current >= SCHEMA_VERSION) return;

  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [JSON.stringify(SCHEMA_VERSION)]
  );
  console.log(`Database updated to version ${SCHEMA_VERSION}`);
};
module.exports.SCHEMA_VERSION = SCHEMA_VERSION;
