-- 0005_pr_cl07_lock_views_cc_policies.sql
-- PR-CL07 :: views follow caller RLS + CC authenticated policies + revoke anon on views
-- Owner-approved in chat (RED lane) 2026-07-04. Applied to prod via SQL Editor
-- the same day; this file replays that exact SQL.
--
-- Why: the views were created without security_invoker, so they ran with the
-- view owner's rights and BYPASSED RLS — the public anon key (baked into the
-- JS bundle) could read every ledger row without logging in. Base-table writes
-- were already safe (RLS deny-all for anon). This migration:
--   1) flips every view to security_invoker => views enforce the caller's RLS
--   2) adds authenticated policies to the 3 credit-card tables (RLS was already
--      enabled on them but policy-less, which would have blanked the CC views
--      for logged-in users after step 1)
--   3) revokes anon's SELECT grant on all views (defense in depth)
-- Idempotent: ALTER VIEW SET / REVOKE re-run harmlessly; policies are guarded.

-- ============================================================
-- Mandatory safety header
-- ============================================================
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ============================================================
-- 1) All views run with the CALLER's permissions => RLS applies through them
-- ============================================================
ALTER VIEW entities_active                 SET (security_invoker = true);
ALTER VIEW accounts_active                 SET (security_invoker = true);
ALTER VIEW counterparties_active           SET (security_invoker = true);
ALTER VIEW transactions_active             SET (security_invoker = true);
ALTER VIEW transaction_lines_active        SET (security_invoker = true);
ALTER VIEW audit_log_active                SET (security_invoker = true);
ALTER VIEW account_balances                SET (security_invoker = true);
ALTER VIEW credit_cards_active             SET (security_invoker = true);
ALTER VIEW cc_installments_active          SET (security_invoker = true);
ALTER VIEW cc_installment_schedule_active  SET (security_invoker = true);
ALTER VIEW credit_card_status              SET (security_invoker = true);
ALTER VIEW credit_card_over_limit          SET (security_invoker = true);
ALTER VIEW cc_due_reminders                SET (security_invoker = true);

-- ============================================================
-- 2) authenticated policies for the 3 CC tables (mirrors 0003;
--    no DELETE policy = soft-delete only)
-- ============================================================
DO $pol$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['credit_cards','cc_installments','cc_installment_schedule'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_auth_select') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t||'_auth_select', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_auth_insert') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)', t||'_auth_insert', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=t||'_auth_update') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)', t||'_auth_update', t);
    END IF;
  END LOOP;
END
$pol$;

-- ============================================================
-- 3) belt & suspenders: anon loses SELECT on the views entirely
-- ============================================================
REVOKE SELECT ON entities_active, accounts_active, counterparties_active,
  transactions_active, transaction_lines_active, audit_log_active,
  account_balances, credit_cards_active, cc_installments_active,
  cc_installment_schedule_active, credit_card_status, credit_card_over_limit,
  cc_due_reminders FROM anon;
