require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');

for (const key of ['DATABASE_URL', 'JWT_SECRET', 'ADMIN_JWT_SECRET']) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env`);
    process.exit(1);
  }
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : true }));
app.use(express.json({ limit: '5mb' }));
app.use(morgan('tiny'));

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/team', require('./routes/team'));
app.use('/api/referrals', require('./routes/referrals'));
// Payment confirmations from Safaricom. /api/mpesa is kept for payments started before the rename.
app.use('/api/payhook', require('./routes/mpesa'));
app.use('/api/mpesa', require('./routes/mpesa'));
app.use('/api/admin', require('./routes/admin'));

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Express 5 forwards errors thrown in async handlers here
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong' : err.message, code: err.code });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`DukaSmart API running on port ${port}`));
