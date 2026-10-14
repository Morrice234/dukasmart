require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.query(
    "INSERT INTO settings (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO UPDATE SET value = $1",
    [JSON.stringify(require('./autoMigrate').SCHEMA_VERSION)]
  );
  console.log('Database schema is up to date');
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
