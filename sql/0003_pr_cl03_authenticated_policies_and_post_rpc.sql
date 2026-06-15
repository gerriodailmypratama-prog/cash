-- 0003_pr_cl03_authenticated_policies_and_post_rpc.sql
-- PR-CL03 :: authenticated RLS policies + post_transaction RPC
-- GerrioFin Phase 0/1 UI enablement.
-- Owner-approved in chat (single-operator: owner + spouse). Model:
--   logged-in (authenticated) users get full read/write on the 6 base tables.
--   anon stays deny-all (no anon policies). service_role still bypasses.
-- Additive, idempotent.

-- ============================================================
-- Mandatory safety header
-- ============================================================
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ============================================================
-- RLS policies for role: authenticated
-- SELECT + INSERT + UPDATE on all 6 tables. No DELETE policy
-- (soft-delete via deleted_at + UPDATE instead of hard delete).
-- Guarded so re-running is harmless.
-- ============================================================
DO $pol$
DECLARE
  t text;
  tbls text[] := ARRAY['entities','accounts','counterparties',
                       'transactions','transaction_lines','audit_log'];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                     AND tablename=t AND policyname=t||'_auth_select') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
        t||'_auth_select', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                     AND tablename=t AND policyname=t||'_auth_insert') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true)',
        t||'_auth_insert', t);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                     AND tablename=t AND policyname=t||'_auth_update') THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true) WITH CHECK (true)',
        t||'_auth_update', t);
    END IF;
  END LOOP;
END
$pol$;

-- ============================================================
-- RPC: post_transaction
-- Quick Capture writes a posted transaction (amount > 0, from <> to,
-- both enforced by table CHECK constraints).
-- Defaults entity to the from-account's entity when p_entity_id is null.
-- SECURITY INVOKER so RLS (authenticated policies) still applies.
-- ============================================================
CREATE OR REPLACE FUNCTION public.post_transaction(
  p_amount              numeric,
  p_from_account_id     uuid,
  p_to_account_id       uuid,
  p_entity_id           uuid DEFAULT NULL,
  p_category_account_id uuid DEFAULT NULL,
  p_counterparty_id     uuid DEFAULT NULL,
  p_memo                text DEFAULT NULL,
  p_date                date DEFAULT NULL,
  p_currency            text DEFAULT 'IDR',
  p_fx_rate             numeric DEFAULT 1
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE
  v_entity uuid := p_entity_id;
  v_tx uuid;
BEGIN
  IF v_entity IS NULL THEN
    SELECT entity_id INTO v_entity FROM accounts_active WHERE id = p_from_account_id;
  END IF;
  IF v_entity IS NULL THEN
    SELECT entity_id INTO v_entity FROM accounts_active WHERE id = p_to_account_id;
  END IF;

  INSERT INTO transactions(
    entity_id, amount, from_account_id, to_account_id,
    counterparty_id, memo, date, currency, fx_rate, status)
  VALUES (
    v_entity, p_amount, p_from_account_id, p_to_account_id,
    p_counterparty_id, p_memo, COALESCE(p_date, current_date),
    COALESCE(p_currency,'IDR'), COALESCE(p_fx_rate,1), 'posted')
  RETURNING id INTO v_tx;

  IF p_category_account_id IS NOT NULL THEN
    INSERT INTO transaction_lines(transaction_id, account_id, amount, direction, memo)
    VALUES (v_tx, p_category_account_id, p_amount, 'category', p_memo);
  END IF;

  RETURN v_tx;
END
$fn$;
