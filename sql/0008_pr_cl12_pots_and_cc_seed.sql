-- 0008_pr_cl12_pots_and_cc_seed.sql
-- PR-CL12 :: POT restructure (multi-entity) + credit-card registry seed
-- Owner-approved in chat 2026-07-04 ("POT masing-masing": Pribadi, Goodgems,
-- Goodfinds, Saham) + card data supplied from the owner's tracking sheet.
--
-- 1) Rename entity 'GerrioFin' -> 'Goodgems' (the 0001 seed CoA is Goodgems'
--    live-commerce chart). Single-row backfill: _bak table kept ~7 days.
-- 2) Add entities: Pribadi (personal), Goodfinds (business), Saham (investment).
-- 3) Seed chart of accounts for the three new pots (additive, per-entity codes).
-- 4) Seed 13 credit cards as LIABILITY accounts under Pribadi + credit_cards
--    rows (limit / statement_day / due_day from the owner's sheet; missing
--    values stay NULL, flagged in memo).
--
-- Replay note: on a fresh DB, 0001 seeds entity 'GerrioFin' + CoA and this
-- migration renames it — order 0001..0008 replays cleanly. Re-running 0001 on
-- a DB where the rename already happened would re-create 'GerrioFin'; don't.
--
-- Idempotent: entity lookups by name, accounts ON CONFLICT (entity_id, code)
-- DO NOTHING, credit_cards guarded per account.

-- ============================================================
-- Mandatory safety header
-- ============================================================
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- ============================================================
-- 1) Backfill ritual: rename GerrioFin -> Goodgems
-- ============================================================
CREATE TABLE IF NOT EXISTS cash._bak_pr_cl12_entities AS
  SELECT * FROM cash.entities WHERE name = 'GerrioFin';

UPDATE cash.entities
   SET name = 'Goodgems',
       memo = COALESCE(memo || ' | ', '') || 'renamed from GerrioFin (PR-CL12)'
 WHERE name = 'GerrioFin';

-- ============================================================
-- 2) + 3) Entities + chart of accounts per pot
-- ============================================================
DO $seed$
DECLARE
  v_pribadi   uuid;
  v_goodfinds uuid;
  v_saham     uuid;
BEGIN
  -- ---- Pribadi ----
  SELECT id INTO v_pribadi FROM cash.entities WHERE name = 'Pribadi' AND deleted_at IS NULL LIMIT 1;
  IF v_pribadi IS NULL THEN
    INSERT INTO cash.entities(name, kind, currency, memo)
    VALUES ('Pribadi', 'personal', 'IDR', 'pot rumah tangga Gerrio + Steffie')
    RETURNING id INTO v_pribadi;
  END IF;

  INSERT INTO cash.accounts (entity_id, code, name, type, subtype) VALUES
    (v_pribadi,'1000','Cash & Bank','ASSET','cash'),
    (v_pribadi,'1100','E-Wallet','ASSET','cash'),
    (v_pribadi,'3000','Owner Equity','EQUITY','equity'),
    (v_pribadi,'4000','Pemasukan Lain','INCOME','other'),
    (v_pribadi,'4100','Gaji / Drawing dari Bisnis','INCOME','drawing'),
    -- fix cost rumah tangga (dipakai panel "Wajib Bayar")
    (v_pribadi,'6000','Sewa Rumah','EXPENSE','fixed'),
    (v_pribadi,'6100','Listrik','EXPENSE','fixed'),
    (v_pribadi,'6200','Air','EXPENSE','fixed'),
    (v_pribadi,'6300','WiFi / Internet','EXPENSE','fixed'),
    (v_pribadi,'6400','Gaji ART','EXPENSE','fixed'),
    -- variabel
    (v_pribadi,'7000','Kebutuhan Harian','EXPENSE','living'),
    (v_pribadi,'7100','Transport','EXPENSE','living'),
    (v_pribadi,'7200','Kesehatan','EXPENSE','living'),
    (v_pribadi,'7300','Hiburan & Jajan','EXPENSE','living'),
    (v_pribadi,'7900','Lain-lain','EXPENSE','other')
  ON CONFLICT (entity_id, code) WHERE code IS NOT NULL AND deleted_at IS NULL
  DO NOTHING;

  -- ---- Goodfinds ----
  SELECT id INTO v_goodfinds FROM cash.entities WHERE name = 'Goodfinds' AND deleted_at IS NULL LIMIT 1;
  IF v_goodfinds IS NULL THEN
    INSERT INTO cash.entities(name, kind, currency, memo)
    VALUES ('Goodfinds', 'business', 'IDR', 'pot bisnis Goodfinds')
    RETURNING id INTO v_goodfinds;
  END IF;

  INSERT INTO cash.accounts (entity_id, code, name, type, subtype) VALUES
    (v_goodfinds,'1000','Cash & Bank','ASSET','cash'),
    (v_goodfinds,'1100','E-Wallet / Marketplace Balance','ASSET','cash'),
    (v_goodfinds,'1200','Accounts Receivable','ASSET','receivable'),
    (v_goodfinds,'1300','Inventory','ASSET','inventory'),
    (v_goodfinds,'2000','Accounts Payable','LIABILITY','payable'),
    (v_goodfinds,'3000','Owner Equity','EQUITY','equity'),
    (v_goodfinds,'4000','Sales','INCOME','sales'),
    (v_goodfinds,'4100','Other Income','INCOME','other'),
    (v_goodfinds,'5000','COGS','EXPENSE','cogs'),
    (v_goodfinds,'5100','Shipping Cost','EXPENSE','cogs'),
    (v_goodfinds,'5200','Marketplace / Platform Fees','EXPENSE','cogs'),
    (v_goodfinds,'6000','Marketing & Ads','EXPENSE','opex'),
    (v_goodfinds,'6200','Salaries & Wages','EXPENSE','opex'),
    (v_goodfinds,'6300','Sewa Ruko & Utilities','EXPENSE','opex'),
    (v_goodfinds,'6400','Equipment & Supplies','EXPENSE','opex')
  ON CONFLICT (entity_id, code) WHERE code IS NOT NULL AND deleted_at IS NULL
  DO NOTHING;

  -- ---- Saham ----
  SELECT id INTO v_saham FROM cash.entities WHERE name = 'Saham' AND deleted_at IS NULL LIMIT 1;
  IF v_saham IS NULL THEN
    INSERT INTO cash.entities(name, kind, currency, memo)
    VALUES ('Saham', 'investment', 'IDR', 'pot investasi saham (modal terpisah)')
    RETURNING id INTO v_saham;
  END IF;

  INSERT INTO cash.accounts (entity_id, code, name, type, subtype) VALUES
    (v_saham,'1000','RDN Cash','ASSET','cash'),
    (v_saham,'1500','Portofolio Saham','ASSET','investment'),
    (v_saham,'3000','Owner Equity','EQUITY','equity'),
    (v_saham,'4000','Realized Gain','INCOME','investment'),
    (v_saham,'4100','Dividen','INCOME','investment'),
    (v_saham,'5000','Realized Loss','EXPENSE','investment'),
    (v_saham,'5100','Fee Broker','EXPENSE','investment')
  ON CONFLICT (entity_id, code) WHERE code IS NOT NULL AND deleted_at IS NULL
  DO NOTHING;
END
$seed$;

-- ============================================================
-- 4) Credit cards: liability accounts (Pribadi) + credit_cards rows
--    Data from the owner's sheet (2026-07-04). Sheet columns:
--    Invoice = statement_day, Tempo = due_day. NULL = belum diisi di sheet.
-- ============================================================
DO $cc$
DECLARE
  v_pribadi uuid;
  r record;
  v_acc uuid;
BEGIN
  SELECT id INTO v_pribadi FROM cash.entities WHERE name = 'Pribadi' AND deleted_at IS NULL LIMIT 1;
  IF v_pribadi IS NULL THEN
    RAISE EXCEPTION 'entity Pribadi not found';
  END IF;

  FOR r IN SELECT * FROM (VALUES
    -- code , name              , issuer          , limit        , stmt, due , memo
    ('2401','BCA Gerrio'        ,'BCA'            , 50000000::numeric,  4::smallint, 18::smallint, NULL),
    ('2402','BCA Steffie'       ,'BCA'            , 10000000,  4, NULL, 'due_day belum diisi di sheet'),
    ('2403','BNI Gold JCB'      ,'BNI'            , 25000000, 14, NULL, 'due_day belum diisi di sheet'),
    ('2404','BNI Ultimate'      ,'BNI'            , 50000000, 18, NULL, 'due_day belum diisi di sheet'),
    ('2405','BRI Paper'         ,'BRI'            , 30000000, NULL, 15, 'statement_day belum diisi di sheet'),
    ('2406','BRI Tokopedia'     ,'BRI'            , 40000000, 17, NULL, 'due_day belum diisi di sheet'),
    ('2407','BRI Traveloka'     ,'BRI'            , 50000000,  3, 10, 'due_day dari sheet kurang jelas (10?) - konfirmasi'),
    ('2408','CIMB Niaga All'    ,'CIMB Niaga'     , 40000000, 25, NULL, 'due_day belum diisi di sheet'),
    ('2409','Jenius'            ,'BTPN (Jenius)'  , 50000000, 27, NULL, 'due_day belum diisi di sheet'),
    ('2410','Mandiri JCB'       ,'Mandiri'        , 18000000, 19, NULL, 'due_day belum diisi di sheet'),
    ('2411','Mandiri Shopee'    ,'Mandiri'        ,        0, 12,  1, 'limit Rp0 di sheet - share limit? update kalau ada angka'),
    ('2412','Mandiri Traveloka' ,'Mandiri'        ,        0, 16,  5, 'limit Rp0 di sheet - share limit? update kalau ada angka'),
    ('2413','Mega Platinum'     ,'Mega'           , 34000000, 27, 11, NULL)
  ) AS t(code, name, issuer, credit_limit, statement_day, due_day, memo)
  LOOP
    INSERT INTO cash.accounts (entity_id, code, name, type, subtype)
    VALUES (v_pribadi, r.code, r.name, 'LIABILITY', 'credit_card')
    ON CONFLICT (entity_id, code) WHERE code IS NOT NULL AND deleted_at IS NULL
    DO NOTHING;

    SELECT id INTO v_acc FROM cash.accounts
     WHERE entity_id = v_pribadi AND code = r.code AND deleted_at IS NULL;

    IF NOT EXISTS (SELECT 1 FROM cash.credit_cards WHERE account_id = v_acc) THEN
      INSERT INTO cash.credit_cards
        (account_id, issuer, credit_limit, statement_day, due_day, memo)
      VALUES (v_acc, r.issuer, r.credit_limit, r.statement_day, r.due_day, r.memo);
    END IF;
  END LOOP;
END
$cc$;
