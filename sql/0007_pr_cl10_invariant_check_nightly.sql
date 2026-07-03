-- 0007_pr_cl10_invariant_check_nightly.sql
-- PR-CL10 :: nightly ledger invariant check via pg_cron ("gabung tapi aman" Lapis 3)
-- Owner-approved in chat 2026-07-04. Applied to prod via SQL Editor the same day.
--
-- Invariants live in the database, not in hope (AGENTS.md). No notification
-- webhook is configured yet, so results are appended to cash.audit_log
-- (table_name='_invariants'); wire a webhook later in a follow-up PR.

-- ============================================================
-- Mandatory safety header
-- ============================================================
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================
-- cash.invariant_check(): ledger sanity checks, logged to audit_log
-- ============================================================
CREATE OR REPLACE FUNCTION cash.invariant_check() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cash
AS $fn$
DECLARE
  n_bad_amount int;   -- posted tx with amount <= 0 (CHECK should make this impossible)
  n_no_accounts int;  -- posted tx with neither from nor to account
  s_ledger numeric;   -- from->to ledger is zero-sum when both sides are set
  n_posted int;
  n_accounts int;
  v jsonb;
BEGIN
  SELECT count(*) INTO n_bad_amount
    FROM transactions WHERE deleted_at IS NULL AND status='posted' AND amount <= 0;
  SELECT count(*) INTO n_no_accounts
    FROM transactions WHERE deleted_at IS NULL AND status='posted'
     AND from_account_id IS NULL AND to_account_id IS NULL;
  SELECT COALESCE(sum(balance),0) INTO s_ledger FROM account_balances;
  SELECT count(*) INTO n_posted
    FROM transactions WHERE deleted_at IS NULL AND status='posted';
  SELECT count(*) INTO n_accounts FROM accounts WHERE deleted_at IS NULL;

  v := jsonb_build_object(
    'bad_amount', n_bad_amount,
    'no_accounts', n_no_accounts,
    'ledger_sum', s_ledger,
    'posted_tx', n_posted,
    'accounts', n_accounts,
    'ok', (n_bad_amount = 0 AND n_no_accounts = 0 AND s_ledger = 0)
  );

  INSERT INTO audit_log(table_name, action, actor, diff)
  VALUES ('_invariants', 'check', 'pg_cron', v);

  RETURN v;
END
$fn$;

-- not for the public anon key
REVOKE ALL ON FUNCTION cash.invariant_check() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cash.invariant_check() TO authenticated, service_role;

-- ============================================================
-- schedule: nightly 02:00 WIB = 19:00 UTC (idempotent by jobname)
-- ============================================================
DO $job$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gerriofin_invariants_nightly') THEN
    PERFORM cron.schedule('gerriofin_invariants_nightly', '0 19 * * *',
                          'SELECT cash.invariant_check();');
  END IF;
END
$job$;
