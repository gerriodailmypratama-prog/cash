-- 0001_pr_cl01_phase0_ledger_schema.sql
-- PR-CL01 :: Phase 0 schema foundation (ledger from/to, cash-basis)
-- GerrioFin (personal + business finance). Additive-first, idempotent.
-- NOTE: RLS policies / roles / permission tables are intentionally OMITTED (RED lane).

-- ============================================================
-- Mandatory safety header
-- ============================================================
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Enums (guarded)
-- ============================================================
DO $$ BEGIN
  CREATE TYPE account_type AS ENUM ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transaction_status AS ENUM ('draft','posted','void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- entities (personal + business "books")
-- ============================================================
CREATE TABLE IF NOT EXISTS entities (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text,                 -- e.g. 'personal' | 'business'
  currency    text DEFAULT 'IDR',
  memo        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- ============================================================
-- accounts (chart of accounts, tree via parent_id)
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid REFERENCES entities(id),
  code        text,
  name        text NOT NULL,
  type        account_type NOT NULL,
  subtype     text,
  parent_id   uuid REFERENCES accounts(id),
  currency    text DEFAULT 'IDR',
  is_active   boolean NOT NULL DEFAULT true,
  memo        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- ============================================================
-- counterparties (customers / suppliers / people)
-- ============================================================
CREATE TABLE IF NOT EXISTS counterparties (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid REFERENCES entities(id),
  name        text NOT NULL,
  kind        text,                 -- 'customer' | 'supplier' | 'other'
  contact     text,
  memo        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- ============================================================
-- transactions (cash-basis ledger: amount always positive, from -> to)
-- ============================================================
CREATE TABLE IF NOT EXISTS transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid REFERENCES entities(id),
  date            date NOT NULL DEFAULT current_date,
  amount          numeric(20,4) NOT NULL,
  from_account_id uuid REFERENCES accounts(id),
  to_account_id   uuid REFERENCES accounts(id),
  counterparty_id uuid REFERENCES counterparties(id),
  receipt_id      uuid,
  status          transaction_status NOT NULL DEFAULT 'draft',
  currency        text NOT NULL DEFAULT 'IDR',
  fx_rate         numeric(20,8) NOT NULL DEFAULT 1,
  memo            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT transactions_amount_positive CHECK (amount > 0),
  CONSTRAINT transactions_from_to_distinct CHECK (from_account_id IS DISTINCT FROM to_account_id)
);

-- ============================================================
-- transaction_lines (optional split lines)
-- ============================================================
CREATE TABLE IF NOT EXISTS transaction_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  uuid NOT NULL REFERENCES transactions(id),
  account_id      uuid REFERENCES accounts(id),
  amount          numeric(20,4) NOT NULL,
  direction       text,             -- 'from' | 'to'
  memo            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT transaction_lines_amount_positive CHECK (amount > 0)
);

-- ============================================================
-- audit_log (append-only trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid REFERENCES entities(id),
  table_name  text NOT NULL,
  row_id      uuid,
  action      text NOT NULL,        -- 'insert' | 'update' | 'void' | ...
  actor       text,
  diff        jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

-- ============================================================
-- Indexes (idempotent)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_accounts_entity      ON accounts(entity_id);
CREATE INDEX IF NOT EXISTS idx_accounts_parent      ON accounts(parent_id);
CREATE INDEX IF NOT EXISTS idx_tx_entity            ON transactions(entity_id);
CREATE INDEX IF NOT EXISTS idx_tx_from              ON transactions(from_account_id);
CREATE INDEX IF NOT EXISTS idx_tx_to                ON transactions(to_account_id);
CREATE INDEX IF NOT EXISTS idx_tx_date              ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_txlines_tx           ON transaction_lines(transaction_id);
CREATE INDEX IF NOT EXISTS idx_cp_entity            ON counterparties(entity_id);

-- ============================================================
-- Soft-delete: <table>_active views (all reads use these)
-- ============================================================
CREATE OR REPLACE VIEW entities_active AS
  SELECT * FROM entities WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW accounts_active AS
  SELECT * FROM accounts WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW counterparties_active AS
  SELECT * FROM counterparties WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW transactions_active AS
  SELECT * FROM transactions WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW transaction_lines_active AS
  SELECT * FROM transaction_lines WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW audit_log_active AS
  SELECT * FROM audit_log WHERE deleted_at IS NULL;

-- ============================================================
-- Account balance view (cash-basis)
--   balance = SUM(amount in via to_account) - SUM(amount out via from_account)
--   only posted, non-deleted transactions count.
-- ============================================================
CREATE OR REPLACE VIEW account_balances AS
WITH inflow AS (
  SELECT to_account_id AS account_id, COALESCE(SUM(amount * fx_rate),0) AS amt
  FROM transactions
  WHERE deleted_at IS NULL AND status = 'posted' AND to_account_id IS NOT NULL
  GROUP BY to_account_id
),
outflow AS (
  SELECT from_account_id AS account_id, COALESCE(SUM(amount * fx_rate),0) AS amt
  FROM transactions
  WHERE deleted_at IS NULL AND status = 'posted' AND from_account_id IS NOT NULL
  GROUP BY from_account_id
)
SELECT
  a.id            AS account_id,
  a.entity_id,
  a.code,
  a.name,
  a.type,
  a.subtype,
  COALESCE(i.amt,0) - COALESCE(o.amt,0) AS balance
FROM accounts a
LEFT JOIN inflow  i ON i.account_id = a.id
LEFT JOIN outflow o ON o.account_id = a.id
WHERE a.deleted_at IS NULL;

-- ============================================================
-- Seed: starter entity + Chart of Accounts (live-commerce)
-- Idempotent via stable codes (ON CONFLICT on code per entity).
-- ============================================================
-- ensure a uniqueness target for idempotent seeding
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_entity_code
  ON accounts(entity_id, code) WHERE code IS NOT NULL AND deleted_at IS NULL;

DO $seed$
DECLARE
  v_entity uuid;
BEGIN
  -- starter entity
  SELECT id INTO v_entity FROM entities WHERE name = 'GerrioFin' LIMIT 1;
  IF v_entity IS NULL THEN
    INSERT INTO entities(name, kind, currency) VALUES ('GerrioFin','business','IDR')
    RETURNING id INTO v_entity;
  END IF;

  INSERT INTO accounts (entity_id, code, name, type, subtype) VALUES
    -- ASSET
    (v_entity,'1000','Cash & Bank','ASSET','cash'),
    (v_entity,'1100','E-Wallet / Marketplace Balance','ASSET','cash'),
    (v_entity,'1200','Accounts Receivable','ASSET','receivable'),
    (v_entity,'1300','Inventory','ASSET','inventory'),
    -- LIABILITY
    (v_entity,'2000','Accounts Payable','LIABILITY','payable'),
    -- EQUITY
    (v_entity,'3000','Owner Equity','EQUITY','equity'),
    -- INCOME
    (v_entity,'4000','Live Commerce Sales','INCOME','sales'),
    (v_entity,'4100','Other Income','INCOME','other'),
    -- COGS (EXPENSE)
    (v_entity,'5000','COGS','EXPENSE','cogs'),
    (v_entity,'5100','Shipping Cost','EXPENSE','cogs'),
    (v_entity,'5200','Marketplace / Platform Fees','EXPENSE','cogs'),
    -- OPEX (EXPENSE)
    (v_entity,'6000','Marketing & Ads','EXPENSE','opex'),
    (v_entity,'6100','Host / Talent Fees','EXPENSE','opex'),
    (v_entity,'6200','Salaries & Wages','EXPENSE','opex'),
    (v_entity,'6300','Rent & Utilities','EXPENSE','opex'),
    (v_entity,'6400','Equipment & Supplies','EXPENSE','opex'),
    -- PERSONAL (EXPENSE)
    (v_entity,'7000','Personal Drawings','EXPENSE','personal'),
    (v_entity,'7100','Personal Living','EXPENSE','personal')
  ON CONFLICT (entity_id, code) WHERE code IS NOT NULL AND deleted_at IS NULL
  DO NOTHING;
END
$seed$;
