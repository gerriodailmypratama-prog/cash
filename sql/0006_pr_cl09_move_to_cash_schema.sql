-- 0006_pr_cl09_move_to_cash_schema.sql
-- PR-CL09 :: move all GerrioFin objects out of `public` into their own `cash` schema
-- Owner-approved in chat 2026-07-04 ("gabung tapi aman" Lapis 2).
--
-- Why: this Supabase project is shared with the WMS app. Keeping Cash objects in
-- `public` risks name collisions and blurs ownership. Moving them to `cash`
-- isolates the two apps inside the one (free) project.
--
-- ALTER ... SET SCHEMA preserves data, constraints, indexes, RLS flags, policies
-- and grants; views/defaults keep working because they reference objects by OID.
-- Function bodies resolve table names at EXECUTION time via search_path, so each
-- moved function gets `SET search_path = cash` pinned.
--
-- ⚠️ Deployment is 3 steps, in this order (few minutes of API downtime while old
--    clients still point at `public`):
--   1. run this SQL
--   2. Dashboard > Project Settings > Data API > "Exposed schemas": add `cash`
--   3. deploy the client built with db: { schema: 'cash' } (same PR)
--
-- Idempotent: every move is guarded by a to_reg* / catalog existence check.

-- ============================================================
-- Mandatory safety header
-- ============================================================
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ============================================================
-- 1) schema + role access
-- ============================================================
CREATE SCHEMA IF NOT EXISTS cash;

-- API roles can enter the schema; object-level grants (moved with the objects)
-- still decide what each role can do. anon holds no view/table SELECT since 0005.
GRANT USAGE ON SCHEMA cash TO anon, authenticated, service_role;

-- future objects created in cash get sane grants automatically
ALTER DEFAULT PRIVILEGES IN SCHEMA cash
  GRANT ALL ON TABLES TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA cash
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

-- ============================================================
-- 2) move enums (columns keep referencing them by OID)
-- ============================================================
DO $mv$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['account_type','transaction_status'] LOOP
    IF EXISTS (SELECT 1 FROM pg_type ty JOIN pg_namespace n ON n.oid = ty.typnamespace
               WHERE n.nspname = 'public' AND ty.typname = t) THEN
      EXECUTE format('ALTER TYPE public.%I SET SCHEMA cash', t);
    END IF;
  END LOOP;
END
$mv$;

-- ============================================================
-- 3) move tables (data, PKs, FKs, CHECKs, indexes, RLS + policies travel along)
-- ============================================================
DO $mv$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'entities','accounts','counterparties','transactions','transaction_lines',
    'audit_log','credit_cards','cc_installments','cc_installment_schedule'
  ] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA cash', t);
    END IF;
  END LOOP;
END
$mv$;

-- ============================================================
-- 4) move views (OID references to the moved tables stay valid)
-- ============================================================
DO $mv$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'entities_active','accounts_active','counterparties_active',
    'transactions_active','transaction_lines_active','audit_log_active',
    'account_balances','credit_cards_active','cc_installments_active',
    'cc_installment_schedule_active','credit_card_status',
    'credit_card_over_limit','cc_due_reminders'
  ] LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NOT NULL THEN
      EXECUTE format('ALTER VIEW public.%I SET SCHEMA cash', t);
    END IF;
  END LOOP;
END
$mv$;

-- ============================================================
-- 5) move functions (signatures resolved from the catalog) and pin search_path
--    so unqualified table names inside their bodies resolve to cash at runtime
-- ============================================================
DO $mv$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('post_transaction','convert_to_installment','cc_days_until_due')
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET SCHEMA cash', r.proname, r.args);
  END LOOP;

  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'cash'
      AND p.proname IN ('post_transaction','convert_to_installment','cc_days_until_due')
  LOOP
    EXECUTE format('ALTER FUNCTION cash.%I(%s) SET search_path = cash', r.proname, r.args);
  END LOOP;
END
$mv$;
