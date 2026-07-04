-- 0010_pr_cl19_pribadi_expense_categories.sql
-- PR-CL19 :: four extra Pribadi expense categories needed by real CC-statement
-- data (first: Jenius June 2026 import). Additive seed, idempotent.

-- ============================================================
-- Mandatory safety header
-- ============================================================
SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $seed$
DECLARE
  v_pribadi uuid;
BEGIN
  SELECT id INTO v_pribadi FROM cash.entities WHERE name = 'Pribadi' AND deleted_at IS NULL LIMIT 1;
  IF v_pribadi IS NULL THEN
    RAISE EXCEPTION 'entity Pribadi not found';
  END IF;

  INSERT INTO cash.accounts (entity_id, code, name, type, subtype) VALUES
    (v_pribadi,'7400','Belanja Online','EXPENSE','living'),
    (v_pribadi,'7500','Langganan & Digital','EXPENSE','subscription'),
    (v_pribadi,'7600','Makan di Luar','EXPENSE','living'),
    (v_pribadi,'7700','Biaya & Bunga Kartu','EXPENSE','fee')
  ON CONFLICT (entity_id, code) WHERE code IS NOT NULL AND deleted_at IS NULL
  DO NOTHING;
END
$seed$;
