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
// Websites allowed to call the API from a browser (the admin panel). Spaces and trailing slashes are ignored.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);
app.use(cors({
  origin(origin, done) {
    // Phones and server-to-server calls (M-Pesa) send no Origin header
    if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return done(null, true);
    console.warn(`Blocked browser request from ${origin}. Add it to CORS_ORIGINS to allow it.`);
    return done(null, false);
  },
}));
app.use(express.json({ limit: '5mb' }));
app.use(morgan('tiny'));

app.get('/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/team', require('./routes/team'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/till', require('./routes/till'));
app.use('/api/app', require('./routes/app'));
app.use('/api/agent', require('./routes/agentPortal'));
// Payment confirmations from Safaricom. /api/mpesa is kept for payments started before the rename.
app.use('/api/payhook/till', require('./routes/tillCallbacks'));
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
// Brings the database up to date on start, so a new deploy never needs a manual "npm run migrate"
require('./scripts/autoMigrate')()
  .catch((err) => console.error('Database update failed. Run "npm run migrate" to see why.', err.message))
  .finally(() => app.listen(port, () => console.log(`DukaSmart API running on port ${port}`)));
