-- 0009_pr_cl14_app_users_allowlist.sql
-- PR-CL14 :: lock Kas to an explicit user allowlist (RED lane, owner-approved
-- in chat 2026-07-04: "ya bro" + confirmed the 3 emails below).
--
-- Why: the Supabase project is shared with WMS, whose auth.users contains ~20
-- accounts (warehouse staff). Kas policies were `TO authenticated USING (true)`
-- so ANY project user could read/write the owner's personal finances. Now only
-- members of cash.app_users pass RLS; staff keep using WMS untouched.
--
-- Applied to prod first via SQL Editor, verified (3 members, 27 policies
-- flipped to cash.is_app_user(), anon still denied), then committed here.

-- ============================================================
-- Mandatory safety header
-- ============================================================
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ============================================================
-- allowlist table: only these auth users may touch Kas data
-- ============================================================
CREATE TABLE IF NOT EXISTS cash.app_users (
  user_id    uuid PRIMARY KEY,   -- auth.users.id
  email      text,               -- informational snapshot at insert time
  memo       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
-- RLS on, NO policies: deny-all via API. Only the definer fn below reads it.
ALTER TABLE cash.app_users ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- membership check; SECURITY DEFINER so it can read app_users despite RLS
-- ============================================================
CREATE OR REPLACE FUNCTION cash.is_app_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cash
AS $f$ SELECT EXISTS (SELECT 1 FROM app_users WHERE user_id = auth.uid() AND deleted_at IS NULL) $f$;
REVOKE ALL ON FUNCTION cash.is_app_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION cash.is_app_user() TO authenticated;

-- ============================================================
-- seed the 3 approved accounts (idempotent)
-- ============================================================
INSERT INTO cash.app_users(user_id, email, memo)
SELECT id, email, 'seeded PR-CL14 (owner-approved allowlist)'
FROM auth.users
WHERE email IN ('gerriodailmypratama@gmail.com','steffieerzamia@gmail.com','gerriomail@gmail.com')
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- tighten every existing authenticated policy from USING(true) to the allowlist
-- ============================================================
DO $pol$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename, policyname, cmd FROM pg_policies
    WHERE schemaname = 'cash' AND policyname LIKE '%_auth_%'
  LOOP
    IF r.cmd = 'SELECT' THEN
      EXECUTE format('ALTER POLICY %I ON cash.%I USING (cash.is_app_user())', r.policyname, r.tablename);
    ELSIF r.cmd = 'INSERT' THEN
      EXECUTE format('ALTER POLICY %I ON cash.%I WITH CHECK (cash.is_app_user())', r.policyname, r.tablename);
    ELSIF r.cmd = 'UPDATE' THEN
      EXECUTE format('ALTER POLICY %I ON cash.%I USING (cash.is_app_user()) WITH CHECK (cash.is_app_user())', r.policyname, r.tablename);
    END IF;
  END LOOP;
END
$pol$;

-- ============================================================
-- invariant_check: cron (postgres) only; project users must not RPC it
-- ============================================================
REVOKE EXECUTE ON FUNCTION cash.invariant_check() FROM authenticated;
