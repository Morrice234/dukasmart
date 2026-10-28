CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- One global counter. Every insert/update of a synced row takes the next value,
-- which lets devices ask "give me everything that changed after version N".
CREATE SEQUENCE IF NOT EXISTS sync_version_seq;

CREATE TABLE IF NOT EXISTS plans (
  code           TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  price_kes      INTEGER NOT NULL,
  duration_days  INTEGER NOT NULL DEFAULT 30,
  features       JSONB NOT NULL DEFAULT '[]',
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order     INTEGER NOT NULL DEFAULT 0
);

INSERT INTO plans (code, name, price_kes, duration_days, features, sort_order) VALUES
  ('basic', 'Basic', 150, 30, '["Sales and expenses", "Deni tracker", "Daily report", "Cloud backup"]', 1),
  ('business', 'Business', 300, 30, '["Everything in Basic", "Weekly and monthly reports", "Multiple phones", "Priority support"]', 2)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS businesses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  owner_name            TEXT,
  phone                 TEXT NOT NULL UNIQUE,
  pin_hash              TEXT NOT NULL,
  business_type         TEXT NOT NULL DEFAULT 'duka',
  location              TEXT,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  trial_ends_at         TIMESTAMPTZ NOT NULL,
  subscription_ends_at  TIMESTAMPTZ,
  plan_code             TEXT REFERENCES plans(code),
  last_sync_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan_code            TEXT NOT NULL REFERENCES plans(code),
  amount               INTEGER NOT NULL,
  phone                TEXT NOT NULL,
  source               TEXT NOT NULL DEFAULT 'mpesa' CHECK (source IN ('mpesa', 'manual')),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'cancelled')),
  merchant_request_id  TEXT,
  checkout_request_id  TEXT UNIQUE,
  mpesa_receipt        TEXT,
  result_desc          TEXT,
  last_checked_at      TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_business_idx ON payments (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          TEXT NOT NULL UNIQUE,
  name           TEXT,
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Synced tables. IDs are UUIDs generated on the phone so records can be created offline.
-- created_at / updated_at are client timestamps in milliseconds (used for last-write-wins).
-- version is the server-side change counter used for pulling.

CREATE TABLE IF NOT EXISTS customers (
  id           UUID PRIMARY KEY,
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  phone        TEXT,
  notes        TEXT,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  version      BIGINT NOT NULL DEFAULT nextval('sync_version_seq')
);

CREATE TABLE IF NOT EXISTS sales (
  id           UUID PRIMARY KEY,
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  amount       NUMERIC(14,2) NOT NULL,
  method       TEXT NOT NULL DEFAULT 'cash',
  description  TEXT,
  customer_id  UUID,
  occurred_at  BIGINT NOT NULL,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  version      BIGINT NOT NULL DEFAULT nextval('sync_version_seq')
);

CREATE TABLE IF NOT EXISTS expenses (
  id           UUID PRIMARY KEY,
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  amount       NUMERIC(14,2) NOT NULL,
  method       TEXT NOT NULL DEFAULT 'cash',
  category     TEXT,
  description  TEXT,
  occurred_at  BIGINT NOT NULL,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  version      BIGINT NOT NULL DEFAULT nextval('sync_version_seq')
);

CREATE TABLE IF NOT EXISTS debt_entries (
  id           UUID PRIMARY KEY,
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL,
  type         TEXT NOT NULL CHECK (type IN ('credit', 'payment')),
  amount       NUMERIC(14,2) NOT NULL,
  note         TEXT,
  occurred_at  BIGINT NOT NULL,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  version      BIGINT NOT NULL DEFAULT nextval('sync_version_seq')
);

CREATE INDEX IF NOT EXISTS customers_sync_idx    ON customers    (business_id, version);
CREATE INDEX IF NOT EXISTS sales_sync_idx        ON sales        (business_id, version);
CREATE INDEX IF NOT EXISTS expenses_sync_idx     ON expenses     (business_id, version);
CREATE INDEX IF NOT EXISTS debt_entries_sync_idx ON debt_entries (business_id, version);

-- ============ v2: settings, referrals, branches, employees, leads ============

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  JSONB NOT NULL
);
INSERT INTO settings (key, value) VALUES
  ('referrer_bonus_days', '30'),        -- free days a business earns when someone it referred pays for the first time
  ('referee_bonus_trial_days', '7'),    -- extra trial days for a new business that signs up with a code
  ('agent_conversion_cash', '100'),     -- KSh an agent earns when a business they referred pays for the first time
  ('agent_recurring_cash', '0')         -- KSh an agent earns on every later renewal (0 = off)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_branches INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS max_employees INTEGER NOT NULL DEFAULT 0;
UPDATE plans SET max_branches = 5, max_employees = 10 WHERE code = 'business' AND max_branches = 1 AND max_employees = 0;
UPDATE plans SET max_employees = 2 WHERE code = 'basic' AND max_employees = 0;

-- Friends and sales agents who bring in customers but are not customers themselves
CREATE TABLE IF NOT EXISTS agents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL UNIQUE,
  code        TEXT NOT NULL UNIQUE,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS referral_code TEXT;
UPDATE businesses SET referral_code = upper(substr(md5(id::text), 1, 6)) WHERE referral_code IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS businesses_referral_code_idx ON businesses (referral_code);

CREATE TABLE IF NOT EXISTS referrals (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referee_id         UUID NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  referrer_type      TEXT NOT NULL CHECK (referrer_type IN ('business', 'agent')),
  referrer_business  UUID REFERENCES businesses(id) ON DELETE SET NULL,
  referrer_agent     UUID REFERENCES agents(id) ON DELETE SET NULL,
  code_used          TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'signed_up' CHECK (status IN ('signed_up', 'converted')),
  converted_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referrals_business_idx ON referrals (referrer_business);
CREATE INDEX IF NOT EXISTS referrals_agent_idx ON referrals (referrer_agent);

-- kind 'days' is applied automatically, kind 'cash' waits for you to pay it out
CREATE TABLE IF NOT EXISTS referral_rewards (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id  UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  payment_id   UUID REFERENCES payments(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('days', 'cash')),
  amount       INTEGER NOT NULL,
  reason       TEXT NOT NULL DEFAULT 'conversion' CHECK (reason IN ('conversion', 'renewal')),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'paid', 'void')),
  paid_ref     TEXT,
  paid_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_id, kind)
);

-- Branches sync like the other business data so they can be created offline
CREATE TABLE IF NOT EXISTS branches (
  id           UUID PRIMARY KEY,
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  location     TEXT,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  version      BIGINT NOT NULL DEFAULT nextval('sync_version_seq')
);
CREATE INDEX IF NOT EXISTS branches_sync_idx ON branches (business_id, version);

CREATE TABLE IF NOT EXISTS employees (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id    UUID REFERENCES branches(id) ON DELETE SET NULL,   -- NULL = all branches (managers only)
  name         TEXT NOT NULL,
  phone        TEXT NOT NULL UNIQUE,
  pin_hash     TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('manager', 'cashier')),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS employees_business_idx ON employees (business_id);

ALTER TABLE customers    ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE sales        ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE expenses     ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE debt_entries ADD COLUMN IF NOT EXISTS branch_id UUID;
ALTER TABLE customers    ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE sales        ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE expenses     ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE debt_entries ADD COLUMN IF NOT EXISTS created_by UUID;

-- Every business gets a main branch; older records are moved into it
INSERT INTO branches (id, business_id, name, created_at, updated_at)
SELECT gen_random_uuid(), b.id, 'Main branch',
       (extract(epoch FROM b.created_at) * 1000)::bigint, (extract(epoch FROM now()) * 1000)::bigint
  FROM businesses b
 WHERE NOT EXISTS (SELECT 1 FROM branches br WHERE br.business_id = b.id);

UPDATE customers t SET branch_id = (SELECT id FROM branches br WHERE br.business_id = t.business_id AND NOT br.deleted ORDER BY created_at LIMIT 1), version = nextval('sync_version_seq') WHERE branch_id IS NULL;
UPDATE sales t SET branch_id = (SELECT id FROM branches br WHERE br.business_id = t.business_id AND NOT br.deleted ORDER BY created_at LIMIT 1), version = nextval('sync_version_seq') WHERE branch_id IS NULL;
UPDATE expenses t SET branch_id = (SELECT id FROM branches br WHERE br.business_id = t.business_id AND NOT br.deleted ORDER BY created_at LIMIT 1), version = nextval('sync_version_seq') WHERE branch_id IS NULL;
UPDATE debt_entries t SET branch_id = (SELECT id FROM branches br WHERE br.business_id = t.business_id AND NOT br.deleted ORDER BY created_at LIMIT 1), version = nextval('sync_version_seq') WHERE branch_id IS NULL;

CREATE INDEX IF NOT EXISTS sales_branch_idx ON sales (business_id, branch_id, version);
CREATE INDEX IF NOT EXISTS expenses_branch_idx ON expenses (business_id, branch_id, version);

-- ============ v3: stock ============

-- One product list per business, shared by all branches
CREATE TABLE IF NOT EXISTS products (
  id             UUID PRIMARY KEY,
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  unit           TEXT NOT NULL DEFAULT 'pcs',
  buy_price      NUMERIC(14,2),
  sell_price     NUMERIC(14,2),
  reorder_level  NUMERIC(14,3),
  created_by     UUID,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL,
  deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  version        BIGINT NOT NULL DEFAULT nextval('sync_version_seq')
);
CREATE INDEX IF NOT EXISTS products_sync_idx ON products (business_id, version);

-- Every stock change is its own row; quantity is signed (+ received, - sold/damaged, +/- count correction).
-- The current stock of a product at a branch is the sum of its movements, so offline phones never overwrite each other.
CREATE TABLE IF NOT EXISTS stock_movements (
  id           UUID PRIMARY KEY,
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL,
  branch_id    UUID,
  type         TEXT NOT NULL CHECK (type IN ('in', 'sale', 'out', 'adjust')),
  quantity     NUMERIC(14,3) NOT NULL,
  unit_cost    NUMERIC(14,2),
  sale_id      UUID,
  expense_id   UUID,
  note         TEXT,
  occurred_at  BIGINT NOT NULL,
  created_by   UUID,
  created_at   BIGINT NOT NULL,
  updated_at   BIGINT NOT NULL,
  deleted      BOOLEAN NOT NULL DEFAULT FALSE,
  version      BIGINT NOT NULL DEFAULT nextval('sync_version_seq')
);
CREATE INDEX IF NOT EXISTS stock_movements_sync_idx ON stock_movements (business_id, version);
CREATE INDEX IF NOT EXISTS stock_movements_branch_idx ON stock_movements (business_id, branch_id, version);

-- Prospects who are interested but not ready yet
CREATE TABLE IF NOT EXISTS leads (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name          TEXT NOT NULL,
  contact_name           TEXT,
  phone                  TEXT,
  business_type          TEXT,
  location               TEXT,
  status                 TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'interested', 'follow_up', 'converted', 'lost')),
  interest               TEXT NOT NULL DEFAULT 'warm' CHECK (interest IN ('hot', 'warm', 'cold')),
  objection              TEXT,          -- e.g. "No money this month", "Wants to ask partner"
  source                 TEXT,          -- e.g. "Door to door Kawangware", "WhatsApp"
  agent_id               UUID REFERENCES agents(id) ON DELETE SET NULL,
  next_follow_up         DATE,
  converted_business_id  UUID REFERENCES businesses(id) ON DELETE SET NULL,
  created_by             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_phone_idx ON leads (phone);
CREATE INDEX IF NOT EXISTS leads_follow_up_idx ON leads (next_follow_up) WHERE status NOT IN ('converted', 'lost');

CREATE TABLE IF NOT EXISTS lead_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  note        TEXT NOT NULL,
  author      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ v4: SMS reminders ============

-- SMS each plan gives per payment. Set once when the column is first added; edit them in the admin panel after that.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'plans' AND column_name = 'sms_credits') THEN
    ALTER TABLE plans ADD COLUMN sms_credits INTEGER NOT NULL DEFAULT 0;
    UPDATE plans SET sms_credits = CASE code WHEN 'basic' THEN 20 WHEN 'business' THEN 50 ELSE 0 END;
  END IF;
END $$;

-- SMS a business has left. Unused SMS carry over while they keep paying.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS sms_credits INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS sms_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id  UUID,
  employee_id  UUID,
  phone        TEXT NOT NULL,
  message      TEXT NOT NULL,
  segments     INTEGER NOT NULL DEFAULT 1,
  status       TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'simulated')),
  provider_id  TEXT,
  cost         TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sms_messages_business_idx ON sms_messages (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sms_messages_month_idx ON sms_messages (created_at);

-- ============ v5: M-Pesa till payments recorded automatically ============

-- A shop's own till, taken live on Daraja with the shop's own credentials (Safaricom only sends a till's
-- payments to an app that belongs to that till). Secrets are stored encrypted.
CREATE TABLE IF NOT EXISTS till_connections (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id      UUID NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id        UUID,
  environment      TEXT NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox', 'production')),
  shortcode        TEXT NOT NULL,          -- what was registered: the store number for a till, or the paybill
  till_number      TEXT,                   -- what customers pay to, shown in the app
  consumer_key     TEXT NOT NULL,          -- encrypted
  consumer_secret  TEXT NOT NULL,          -- encrypted
  callback_token   TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'failed', 'disabled')),
  last_error       TEXT,
  registered_at    TIMESTAMPTZ,
  last_payment_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Every confirmation Safaricom sends, kept as received. The sale it created has an id made from the
-- M-Pesa code, so a repeated callback or a pasted SMS of the same payment never counts twice.
CREATE TABLE IF NOT EXISTS till_payments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  trans_id     TEXT NOT NULL,
  amount       NUMERIC(14,2) NOT NULL,
  payer_name   TEXT,
  payer_phone  TEXT,                       -- Safaricom masks or hashes this
  bill_ref     TEXT,
  shortcode    TEXT,
  paid_at      BIGINT NOT NULL,
  sale_id      UUID,
  raw          JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, trans_id)
);
CREATE INDEX IF NOT EXISTS till_payments_business_idx ON till_payments (business_id, paid_at DESC);

-- ============ v6: M-Pesa payment prompts sent from the shop's own till ============

ALTER TABLE till_connections ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'till';
ALTER TABLE till_connections ADD COLUMN IF NOT EXISTS passkey TEXT;   -- encrypted; needed for payment prompts

-- A payment prompt sent to a customer's phone at the counter or for a deni balance.
-- record_id is the sale or deni payment it created; the M-Pesa receipt links it to the till notification
-- for the same money, so it is only ever counted once.
CREATE TABLE IF NOT EXISTS payment_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  employee_id          UUID,
  branch_id            UUID,
  purpose              TEXT NOT NULL CHECK (purpose IN ('sale', 'deni')),
  customer_id          UUID,
  phone                TEXT NOT NULL,
  amount               INTEGER NOT NULL,
  merchant_request_id  TEXT,
  checkout_request_id  TEXT UNIQUE,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  receipt              TEXT,
  result_desc          TEXT,
  record_id            UUID,
  last_checked_at      TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_requests_business_idx ON payment_requests (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_requests_receipt_idx ON payment_requests (business_id, receipt);

-- ============ v7: product barcodes / QR codes ============
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE INDEX IF NOT EXISTS products_barcode_idx ON products (business_id, barcode) WHERE barcode IS NOT NULL AND barcode <> '';

-- ============ v8: Android app download link with invite codes ============
CREATE TABLE IF NOT EXISTS app_downloads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT,             -- invite code from the link, if any
  version     TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_downloads_code_idx ON app_downloads (upper(code));
CREATE INDEX IF NOT EXISTS app_downloads_month_idx ON app_downloads (created_at);

-- ============ v9: agent portal ============
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- ============ v10: referral bonuses per plan ============
-- Empty (NULL) means the plan uses the default bonus rules in settings
ALTER TABLE plans ADD COLUMN IF NOT EXISTS referrer_bonus_days INTEGER;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS agent_conversion_cash INTEGER;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS agent_recurring_cash INTEGER;
