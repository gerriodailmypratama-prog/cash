-- 0002_pr_cl02_enable_rls_service_role.sql
-- PR-CL02 :: Enable Row Level Security (service-role-only model)
-- GerrioFin. Single-operator (owner + spouse, no end-user accounts yet).
--
-- Model: RLS ON for all 6 base tables, NO policies created.
--   => anon + authenticated roles get implicit DENY-ALL.
--   => service_role bypasses RLS (used by app/server + dashboard).
-- No roles/permission tables. Additive, idempotent.

-- ============================================================
-- Mandatory safety header
-- ============================================================
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ============================================================
-- Enable RLS (idempotent: ENABLE is harmless if already on)
-- ============================================================
ALTER TABLE entities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE counterparties    ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE transaction_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log         ENABLE ROW LEVEL SECURITY;

-- No CREATE POLICY statements on purpose:
-- with RLS enabled and zero policies, anon/authenticated see nothing
-- and cannot write. service_role bypasses RLS entirely.
-- When a multi-user model is approved, add per-entity policies in a later PR.
