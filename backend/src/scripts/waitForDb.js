// Waits until Postgres accepts connections (the container needs a few seconds on first start)
require('dotenv').config();
const { Client } = require('pg');

(async () => {
  for (let i = 1; i <= 30; i++) {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      await client.end();
      console.log('Database is ready');
      return;
    } catch {
      process.stdout.write(i === 1 ? 'Waiting for database' : '.');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error('\nDatabase did not start. Check: docker compose logs db');
  process.exit(1);
})();
