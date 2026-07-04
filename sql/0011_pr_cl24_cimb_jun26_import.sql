-- 0011_pr_cl24_cimb_jun26_import.sql
-- PR-CL24 :: import the CIMB Niaga (MC Plat Accor) June-2026 statement that
-- arrived via the email pipe (statements@gerriolab.com -> R2, DOB-unlocked PDF),
-- and correct the card metadata to the real cycle (statement day 24, due day 10).
--
-- Lane: YELLOW (data backfill + UPDATE on prod data). Applied to prod first and
-- verified: outstanding = 15,152,548.37 (matches statement to the cent),
-- stmt/due = 24/10, 28 rows imported.
--
-- Idempotent: re-running is a no-op (guarded by the CIMB-JUN26 memo tag).
-- Double-entry mapping per row `kind`:
--   open  card  -> equity(3000)   opening balance carried from last statement
--   chg   card  -> category       a purchase/fee posted to the card
--   ref   category -> card        a refund/credit back to the card
--   pay   equity(3000) -> card     a payment that reduces the outstanding

-- ============================================================
-- Mandatory safety header
-- ============================================================
SET lock_timeout = '5s';
SET statement_timeout = '120s';

DO $imp$
DECLARE
  v_pribadi uuid; v_card uuid; v_equity uuid; r record; v_cat uuid;
  v_from uuid; v_to uuid; n int := 0;
BEGIN
  SELECT id INTO v_pribadi FROM cash.entities_active WHERE name = 'Pribadi';
  SELECT id INTO v_card FROM cash.accounts_active WHERE entity_id = v_pribadi AND name = 'CIMB Niaga All';
  SELECT id INTO v_equity FROM cash.accounts_active WHERE entity_id = v_pribadi AND code = '3000';
  IF v_card IS NULL OR v_equity IS NULL THEN RAISE EXCEPTION 'akun tidak ketemu'; END IF;

  IF EXISTS (SELECT 1 FROM cash.transactions WHERE memo LIKE 'CIMB-JUN26:%' AND deleted_at IS NULL) THEN
    RAISE NOTICE 'sudah diimport, skip'; RETURN;
  END IF;

  -- correct card metadata from the real statement (stmt day 24, due 10)
  UPDATE cash.credit_cards SET statement_day = 24, due_day = 10,
         memo = 'MC Plat Accor; limit gabungan CIMB; data dari statement Jun26',
         updated_at = now()
   WHERE account_id = v_card;

  FOR r IN SELECT * FROM (VALUES
      ('2026-05-24'::date,'open',NULL,9774833.37,'CIMB-JUN26: saldo awal (last balance)'),
      ('2026-05-25'::date,'chg','7400',4291500,'CIMB-JUN26: CILTAP ECOMM cicilan 6/6'),
      ('2026-05-25'::date,'chg','7900',5075000,'CIMB-JUN26: PAPER.ID cicilan 2/6'),
      ('2026-05-28'::date,'chg','7600',99000,'CIMB-JUN26: Runchise Cafe'),
      ('2026-05-29'::date,'chg','7600',15000,'CIMB-JUN26: Cotti Coffee'),
      ('2026-05-29'::date,'chg','7300',130000,'CIMB-JUN26: Bolsena Family'),
      ('2026-05-31'::date,'chg','7700',10000,'CIMB-JUN26: Administration Fee May'),
      ('2026-06-04'::date,'chg','7600',140000,'CIMB-JUN26: Delima'),
      ('2026-06-11'::date,'pay',NULL,1000000,'CIMB-JUN26: Pembayaran (payment-thank you)'),
      ('2026-06-14'::date,'ref','7400',5550000,'CIMB-JUN26: Shopee refund'),
      ('2026-06-14'::date,'chg','7400',1254000,'CIMB-JUN26: Tokopedia'),
      ('2026-06-14'::date,'chg','7400',1385240,'CIMB-JUN26: Tokopedia'),
      ('2026-06-14'::date,'chg','7400',5550000,'CIMB-JUN26: Shopee'),
      ('2026-06-14'::date,'pay',NULL,8800000,'CIMB-JUN26: Pembayaran (payment-thank you)'),
      ('2026-06-15'::date,'chg','7400',1456000,'CIMB-JUN26: Tokopedia'),
      ('2026-06-16'::date,'chg','7300',45000,'CIMB-JUN26: Cinema XXI'),
      ('2026-06-16'::date,'chg','7300',98000,'CIMB-JUN26: TIX ID'),
      ('2026-06-18'::date,'chg','7600',15000,'CIMB-JUN26: Cotti Coffee'),
      ('2026-06-20'::date,'chg','7400',925000,'CIMB-JUN26: Shopee cicilan 1/6'),
      ('2026-06-20'::date,'chg','7700',50000,'CIMB-JUN26: Handling Charges'),
      ('2026-06-23'::date,'chg','7300',28000,'CIMB-JUN26: Endorphins'),
      ('2026-06-23'::date,'chg','7900',45000,'CIMB-JUN26: Mall@Alsut'),
      ('2026-06-23'::date,'chg','7300',135000,'CIMB-JUN26: Bolsena Family'),
      ('2026-06-23'::date,'chg','7600',222300,'CIMB-JUN26: Gion The Sushi'),
      ('2026-06-23'::date,'pay',NULL,500000,'CIMB-JUN26: Pembayaran (payment-thank you)'),
      ('2026-06-09'::date,'chg','7700',97748,'CIMB-JUN26: Late Charge'),
      ('2026-06-24'::date,'chg','7700',150927,'CIMB-JUN26: Interest'),
      ('2026-06-24'::date,'chg','7700',10000,'CIMB-JUN26: Bea Meterai')
  ) AS t(d, kind, cat, amt, memo)
  LOOP
    v_cat := NULL;
    IF r.cat IS NOT NULL THEN
      SELECT id INTO v_cat FROM cash.accounts_active WHERE entity_id = v_pribadi AND code = r.cat;
      IF v_cat IS NULL THEN RAISE EXCEPTION 'kategori % tidak ketemu', r.cat; END IF;
    END IF;
    IF r.kind = 'chg' THEN      v_from := v_card;   v_to := v_cat;
    ELSIF r.kind = 'ref' THEN   v_from := v_cat;    v_to := v_card;
    ELSIF r.kind = 'pay' THEN   v_from := v_equity; v_to := v_card;
    ELSIF r.kind = 'open' THEN  v_from := v_card;   v_to := v_equity;
    END IF;
    INSERT INTO cash.transactions(entity_id, date, amount, from_account_id, to_account_id, status, currency, fx_rate, memo)
    VALUES (v_pribadi, r.d, r.amt, v_from, v_to, 'posted', 'IDR', 1, r.memo);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'imported % rows', n;
END
$imp$;

-- Verification (evidence pasted into PR-CL24):
--   outstanding CIMB (expect 15152548.37) -> 15152548.370000000000
--   stmt/due day                          -> 24/10
--   rows imported                         -> 28
SELECT 'outstanding CIMB (expect 15152548.37)' AS what, current_balance::text AS val
  FROM cash.credit_card_status WHERE card_name = 'CIMB Niaga All'
UNION ALL SELECT 'stmt/due day', statement_day||'/'||due_day FROM cash.credit_cards_active c
  JOIN cash.accounts_active a ON a.id=c.account_id WHERE a.name='CIMB Niaga All'
UNION ALL SELECT 'rows imported', count(*)::text FROM cash.transactions_active WHERE memo LIKE 'CIMB-JUN26:%';
