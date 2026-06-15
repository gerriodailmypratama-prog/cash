-- 0004_pr_cl03_credit_cards.sql  (renumbered from 0003 -- PR #4, also PR-CL03, merged a 0003 migration first; AGENTS.md collision rule => take next free number)
-- PR-CL03 :: Phase 1 Credit Cards (cards + installments + ledger-derived views)
-- GerrioFin. Additive-first, idempotent, nullable-first, soft-delete via _active views.
-- A credit card == a LIABILITY account in the chart of accounts (accounts.id).
-- Ledger convention: a card purchase flows FROM the card account (outflow),
-- a card payment flows TO the card account (inflow). So account_balances.balance
-- for a card account is NEGATIVE while money is owed; outstanding = -balance.
-- NOTE: RLS on these new tables is intentionally NOT toggled here. RLS is RED lane
--       (see PR-CL02). Enabling RLS for credit_cards/cc_installments/cc_installment_schedule
--       is an owner-approved follow-up, mirroring how PR-CL02 secured the core tables.

-- ============================================================
-- Mandatory safety header
-- ============================================================
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ============================================================
-- credit_cards (1 row per card; PK = the card's liability account)
-- ============================================================
CREATE TABLE IF NOT EXISTS credit_cards (
  account_id       uuid PRIMARY KEY REFERENCES accounts(id),
  issuer           text,
  credit_limit     numeric(20,4),          -- "limit" is reserved; store as credit_limit
  statement_day    smallint,               -- day-of-month statement closes (1..31)
  due_day          smallint,               -- day-of-month payment due (1..31)
  apr              numeric(7,4),            -- annual % rate, e.g. 26.0000
  min_payment_pct  numeric(7,4),           -- min payment as % of balance, e.g. 5.0000
  annual_fee       numeric(20,4),
  reminder_window  smallint DEFAULT 3,     -- days before due_day to start reminding
  memo             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,
  CONSTRAINT credit_cards_limit_nonneg      CHECK (credit_limit    IS NULL OR credit_limit    >= 0),
  CONSTRAINT credit_cards_statement_day_rng CHECK (statement_day   IS NULL OR statement_day BETWEEN 1 AND 31),
  CONSTRAINT credit_cards_due_day_rng       CHECK (due_day         IS NULL OR due_day       BETWEEN 1 AND 31),
  CONSTRAINT credit_cards_min_pct_rng       CHECK (min_payment_pct IS NULL OR min_payment_pct BETWEEN 0 AND 100),
  CONSTRAINT credit_cards_reminder_nonneg   CHECK (reminder_window IS NULL OR reminder_window >= 0)
);

-- ============================================================
-- cc_installments (one row per installment plan = one converted txn)
-- ============================================================
CREATE TABLE IF NOT EXISTS cc_installments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_account_id uuid REFERENCES accounts(id),
  source_txn_id   uuid REFERENCES transactions(id),
  tenor           smallint,            -- number of monthly payments
  monthly_amount  numeric(20,4),       -- amount payable each month
  remaining       smallint,            -- installments still outstanding
  started_on      date DEFAULT current_date,
  memo            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT cc_installments_tenor_pos     CHECK (tenor          IS NULL OR tenor > 0),
  CONSTRAINT cc_installments_monthly_pos   CHECK (monthly_amount IS NULL OR monthly_amount > 0),
  CONSTRAINT cc_installments_remaining_rng CHECK (remaining      IS NULL OR remaining >= 0)
);

-- ============================================================
-- cc_installment_schedule (one row per month of a plan; the "payable" calendar)
-- ============================================================
CREATE TABLE IF NOT EXISTS cc_installment_schedule (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  installment_id  uuid REFERENCES cc_installments(id),
  seq             smallint,            -- 1..tenor
  due_date        date,
  amount          numeric(20,4),
  paid            boolean NOT NULL DEFAULT false,
  paid_txn_id     uuid REFERENCES transactions(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT cc_sched_seq_pos    CHECK (seq    IS NULL OR seq > 0),
  CONSTRAINT cc_sched_amount_pos CHECK (amount IS NULL OR amount > 0)
);

-- ============================================================
-- Indexes (idempotent)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_cc_installments_card  ON cc_installments(card_account_id);
CREATE INDEX IF NOT EXISTS idx_cc_installments_txn   ON cc_installments(source_txn_id);
CREATE INDEX IF NOT EXISTS idx_cc_sched_installment  ON cc_installment_schedule(installment_id);
CREATE INDEX IF NOT EXISTS idx_cc_sched_due          ON cc_installment_schedule(due_date);

-- ============================================================
-- Soft-delete: _active views (all reads use these)
-- ============================================================
CREATE OR REPLACE VIEW credit_cards_active AS
  SELECT * FROM credit_cards WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW cc_installments_active AS
  SELECT * FROM cc_installments WHERE deleted_at IS NULL;
CREATE OR REPLACE VIEW cc_installment_schedule_active AS
  SELECT * FROM cc_installment_schedule WHERE deleted_at IS NULL;

-- ============================================================
-- credit_card_status: ledger-derived balance, available, utilization.
--   current_balance = outstanding owed = GREATEST(-ledger_balance, 0)
--   available       = credit_limit - current_balance
--   util_pct        = current_balance / credit_limit * 100
--   over_limit      = current_balance > credit_limit  (warn flag)
-- ============================================================
CREATE OR REPLACE VIEW credit_card_status AS
SELECT
  c.account_id,
  a.entity_id,
  a.name              AS card_name,
  c.issuer,
  c.credit_limit,
  c.statement_day,
  c.due_day,
  c.apr,
  c.min_payment_pct,
  c.annual_fee,
  c.reminder_window,
  COALESCE(b.balance, 0)                            AS ledger_balance,
  GREATEST(-COALESCE(b.balance, 0), 0)             AS current_balance,
  CASE WHEN c.credit_limit IS NOT NULL
       THEN c.credit_limit - GREATEST(-COALESCE(b.balance,0),0)
  END                                              AS available,
  CASE WHEN c.credit_limit IS NOT NULL AND c.credit_limit > 0
       THEN round(GREATEST(-COALESCE(b.balance,0),0) / c.credit_limit * 100, 2)
  END                                              AS util_pct,
  CASE WHEN c.credit_limit IS NOT NULL
       THEN GREATEST(-COALESCE(b.balance,0),0) > c.credit_limit
       ELSE false
  END                                              AS over_limit
FROM credit_cards c
JOIN accounts a       ON a.id = c.account_id AND a.deleted_at IS NULL
LEFT JOIN account_balances b ON b.account_id = c.account_id
WHERE c.deleted_at IS NULL;

-- ============================================================
-- Over-limit warn helper (no blocking cross-table CHECK; over-limit is a real
-- event, not corruption). The nightly invariant job / app reads this view.
-- ============================================================
CREATE OR REPLACE VIEW credit_card_over_limit AS
  SELECT account_id, card_name, current_balance, credit_limit
  FROM credit_card_status
  WHERE over_limit IS TRUE;

-- ============================================================
-- convert_to_installment(): turn ONE transaction into an n-month payable plan.
-- Idempotent per source txn (returns the existing active plan if one exists).
-- Additive only: creates plan + monthly schedule rows; does not move the ledger.
-- ============================================================
CREATE OR REPLACE FUNCTION convert_to_installment(
  p_txn_id    uuid,
  p_tenor     smallint,
  p_first_due date DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_card_account uuid;
  v_total        numeric(20,4);
  v_monthly      numeric(20,4);
  v_first        date;
  v_plan_id      uuid;
  i              int;
BEGIN
  IF p_tenor IS NULL OR p_tenor < 1 THEN
    RAISE EXCEPTION 'tenor must be >= 1';
  END IF;

  SELECT id INTO v_plan_id
  FROM cc_installments
  WHERE source_txn_id = p_txn_id AND deleted_at IS NULL
  LIMIT 1;
  IF v_plan_id IS NOT NULL THEN
    RETURN v_plan_id;
  END IF;

  SELECT from_account_id, amount
    INTO v_card_account, v_total
  FROM transactions
  WHERE id = p_txn_id AND deleted_at IS NULL;

  IF v_total IS NULL THEN
    RAISE EXCEPTION 'transaction % not found / has no amount', p_txn_id;
  END IF;

  v_monthly := round(v_total / p_tenor, 4);
  v_first   := COALESCE(p_first_due, (current_date + interval '1 month')::date);

  INSERT INTO cc_installments(card_account_id, source_txn_id, tenor, monthly_amount, remaining, memo)
  VALUES (v_card_account, p_txn_id, p_tenor, v_monthly, p_tenor,
          'auto plan from txn ' || p_txn_id::text)
  RETURNING id INTO v_plan_id;

  FOR i IN 1..p_tenor LOOP
    INSERT INTO cc_installment_schedule(installment_id, seq, due_date, amount)
    VALUES (
      v_plan_id,
      i,
      (v_first + ((i - 1) || ' month')::interval)::date,
      CASE WHEN i < p_tenor THEN v_monthly
           ELSE v_total - (v_monthly * (p_tenor - 1)) END  -- last row absorbs rounding
    );
  END LOOP;

  RETURN v_plan_id;
END;
$fn$;

-- ============================================================
-- cc_days_until_due(): days from today to the next due_day (clamped to month length).
-- ============================================================
CREATE OR REPLACE FUNCTION cc_days_until_due(p_due_day smallint, p_today date DEFAULT current_date)
RETURNS int
LANGUAGE sql IMMUTABLE
AS $d$
  SELECT CASE
    WHEN p_due_day IS NULL THEN NULL
    ELSE (
      LEAST(p_due_day, date_part('day', (date_trunc('month', p_today) + interval '1 month - 1 day'))::int)
      - date_part('day', p_today)::int
    )
  END;
$d$;

-- ============================================================
-- cc_due_reminders: rows the daily reminder job should notify on.
--   due within reminder_window days AND still owing money.
-- Pure SELECT helper, no money movement, no secrets.
-- ============================================================
CREATE OR REPLACE VIEW cc_due_reminders AS
SELECT
  s.account_id,
  s.card_name,
  s.issuer,
  s.due_day,
  s.reminder_window,
  s.current_balance,
  cc_days_until_due(s.due_day) AS days_until_due
FROM credit_card_status s
WHERE s.due_day IS NOT NULL
  AND s.current_balance > 0
  AND cc_days_until_due(s.due_day) IS NOT NULL
  AND cc_days_until_due(s.due_day) <= COALESCE(s.reminder_window, 3)
  AND cc_days_until_due(s.due_day) >= 0;

-- ============================================================
-- RED -- Telegram reminder pg_cron job is INTENTIONALLY NOT created here.
-- It is a money-flow reminder and needs the Telegram bot token from Supabase
-- Vault. Per AGENTS.md that is OWNER-ONLY (RED lane). Owner activates with the
-- snippet below AFTER storing secrets in Vault (names: 'telegram_bot_token',
-- 'telegram_chat_id'). pg_cron + pg_net assumed available.
--
--   SELECT cron.schedule('cc_due_reminder_daily', '0 1 * * *', $job$
--     SELECT net.http_post(
--       url := 'https://api.telegram.org/bot'
--              || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='telegram_bot_token')
--              || '/sendMessage',
--       body := jsonb_build_object(
--         'chat_id', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='telegram_chat_id'),
--         'text', 'GerrioFin CC due:' || E'\n'
--                 || (SELECT string_agg(card_name || ': due in ' || days_until_due
--                                       || 'd, balance ' || current_balance, E'\n')
--                     FROM cc_due_reminders)
--       )
--     )
--     WHERE EXISTS (SELECT 1 FROM cc_due_reminders);
--   $job$);
-- ============================================================
