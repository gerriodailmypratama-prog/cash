<script>
  import { page } from '$app/stores';
  import { supabase } from '$lib/supabase';
  import { rupiah, accountLabel } from '$lib/format';

  let id = $derived($page.params.account_id);

  let card = $state(null);
  let rows = $state([]);        // transactions touching this card
  let accById = $state(new Map());
  let loading = $state(true);
  let errorMsg = $state('');

  const fmt = (n) => (n == null ? '—' : 'Rp ' + rupiah(n));

  async function load(cardId) {
    loading = true;
    errorMsg = '';
    const [c, acc] = await Promise.all([
      supabase.from('credit_card_status').select('*').eq('account_id', cardId).maybeSingle(),
      supabase.from('accounts_active').select('id, code, name')
    ]);
    if (c.error) { errorMsg = c.error.message; loading = false; return; }
    card = c.data;
    accById = new Map((acc.data ?? []).map((a) => [a.id, a]));

    // transactions where this card is either side (spend = from card, payment = to card)
    const { data, error } = await supabase
      .from('transactions_active')
      .select('id, date, amount, status, from_account_id, to_account_id, memo')
      .or(`from_account_id.eq.${cardId},to_account_id.eq.${cardId}`)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) { errorMsg = error.message; loading = false; return; }
    rows = (data ?? []).map((t) => {
      const spend = t.from_account_id === cardId; // money left the card = a charge
      const other = accById.get(spend ? t.to_account_id : t.from_account_id);
      return {
        ...t,
        spend,
        otherLabel: accountLabel(other) || '—',
        signed: spend ? Number(t.amount) : -Number(t.amount) // charge +, payment −
      };
    });
    loading = false;
  }

  $effect(() => {
    if (id) load(id);
  });

  // category breakdown of charges (non-void, spend only)
  let breakdown = $derived.by(() => {
    const m = new Map();
    for (const t of rows) {
      if (!t.spend || t.status === 'void') continue;
      const k = t.otherLabel;
      m.set(k, (m.get(k) || 0) + Number(t.amount));
    }
    // refunds reduce their category
    for (const t of rows) {
      if (t.spend || t.status === 'void') continue;
      if ((t.memo || '').toLowerCase().includes('refund')) {
        const k = t.otherLabel;
        if (m.has(k)) m.set(k, m.get(k) - Number(t.amount));
      }
    }
    const arr = [...m.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);
    const max = arr[0]?.total || 1;
    const grand = arr.reduce((s, x) => s + x.total, 0);
    return { arr, max, grand };
  });
</script>

<svelte:head><title>Kas — Detail Kartu</title></svelte:head>

<section>
  <a href="/credit-cards" class="back">← Semua kartu</a>

  {#if loading}
    <div class="card"><p class="muted">Memuat…</p></div>
  {:else if errorMsg}
    <div class="card"><p class="err">{errorMsg}</p></div>
  {:else if !card}
    <div class="card"><p class="muted">Kartu tidak ditemukan.</p></div>
  {:else}
    <h1>{card.card_name}</h1>
    <p class="lead">{card.issuer ?? ''}</p>

    <div class="card summary" class:over={card.over_limit}>
      <div class="s-bill">
        <span class="muted">Tagihan berjalan</span>
        <span class="big">{fmt(card.current_balance)}</span>
      </div>
      <div class="s-grid">
        <div><span class="muted">Limit</span><span>{fmt(card.credit_limit)}</span></div>
        <div><span class="muted">Tersedia</span><span class:neg={Number(card.available) < 0}>{fmt(card.available)}</span></div>
        <div><span class="muted">Utilisasi</span><span>{card.util_pct == null ? '—' : card.util_pct + '%'}</span></div>
        <div><span class="muted">Invoice</span><span>tgl {card.statement_day ?? '—'}</span></div>
        <div><span class="muted">Jatuh tempo</span><span>tgl {card.due_day ?? '—'}</span></div>
        {#if card.over_limit}<div><span class="badge">OVER LIMIT</span></div>{/if}
      </div>
      <a class="manage" href="/credit-cards">Bayar / Samakan / Edit di halaman kartu →</a>
    </div>

    {#if breakdown.arr.length > 0}
      <h2>Kemana uang lari (kartu ini)</h2>
      <div class="card">
        <ul class="bd">
          {#each breakdown.arr as b}
            <li>
              <div class="bd-top">
                <span class="bd-label">{b.label}</span>
                <span class="bd-amt">Rp {rupiah(b.total)}
                  <span class="bd-pct">{Math.round((b.total / breakdown.grand) * 100)}%</span>
                </span>
              </div>
              <div class="bd-bar"><div class="bd-fill" style="width:{Math.max((b.total / breakdown.max) * 100, 2)}%"></div></div>
            </li>
          {/each}
        </ul>
        <p class="bd-total">Total pemakaian tercatat: <b>Rp {rupiah(breakdown.grand)}</b></p>
      </div>
    {/if}

    <h2>Rincian transaksi</h2>
    {#if rows.length === 0}
      <div class="card">
        <p class="muted">Belum ada transaksi tercatat untuk kartu ini. Gesekan yang kamu catat
        (dan pembayaran) akan muncul di sini. Riwayat lama bisa diisi lewat import statement nanti.</p>
      </div>
    {:else}
      <div class="card list">
        <ul>
          {#each rows as t}
            <li class:voided={t.status === 'void'}>
              <div class="t-main">
                <span class="t-desc">{t.memo || (t.spend ? 'Belanja' : 'Pembayaran')}</span>
                <span class="t-sub">{t.date} · {t.spend ? 'ke' : 'dari'} {t.otherLabel}
                  {#if t.status === 'void'}· <span class="v">void</span>{/if}</span>
              </div>
              <span class="t-amt" class:pay={!t.spend}>
                {t.spend ? '+' : '−'} Rp {rupiah(Math.abs(t.amount))}
              </span>
            </li>
          {/each}
        </ul>
      </div>
      <p class="hint">+ = pemakaian (nambah tagihan) · − = pembayaran (ngurangin tagihan)</p>
    {/if}
  {/if}
</section>

<style>
  .back { color: var(--text-muted); font-size: 0.85rem; }
  .back:hover { color: var(--primary); }
  h1 { font-size: 1.4rem; font-weight: 700; margin: 0.75rem 0 0.15rem; }
  h2 { font-size: 1rem; font-weight: 600; margin: 1.25rem 0 0.5rem; }
  .lead { color: var(--text-muted); margin: 0 0 1rem; }
  .muted { color: var(--text-muted); }
  .err { color: var(--danger); margin: 0; }
  .hint { color: var(--text-dim); font-size: 0.75rem; margin: 0.5rem 0 0; }

  .summary.over { border-color: var(--danger); }
  .s-bill { display: flex; flex-direction: column; margin-bottom: 0.75rem; }
  .s-bill .big { font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .s-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem 1rem; }
  .s-grid div { display: flex; justify-content: space-between; font-size: 0.9rem; }
  .s-grid .neg { color: var(--danger); }
  .badge { font-size: 0.7rem; font-weight: 700; color: var(--danger); border: 1px solid var(--danger);
           padding: 0.1rem 0.4rem; border-radius: 999px; }
  .manage { display: inline-block; margin-top: 0.75rem; color: var(--primary); font-size: 0.85rem; }

  .bd { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.65rem; }
  .bd-top { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.88rem; margin-bottom: 0.25rem; }
  .bd-label { color: var(--text); }
  .bd-amt { font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
  .bd-pct { color: var(--text-dim); font-weight: 400; font-size: 0.78rem; margin-left: 0.35rem; }
  .bd-bar { height: 6px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
  .bd-fill { height: 100%; background: var(--primary); border-radius: 999px; }
  .bd-total { margin: 0.85rem 0 0; padding-top: 0.6rem; border-top: 1px solid var(--border);
              color: var(--text-muted); font-size: 0.85rem; }
  .bd-total b { color: var(--text); }

  .list { padding: 0.25rem 1rem; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem;
       padding: 0.6rem 0; border-top: 1px solid var(--border); }
  li:first-child { border-top: none; }
  li.voided { opacity: 0.5; }
  li.voided .t-amt { text-decoration: line-through; }
  .t-main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
  .t-desc { color: var(--text); font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-sub { color: var(--text-dim); font-size: 0.76rem; }
  .t-sub .v { color: var(--danger); }
  .t-amt { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .t-amt.pay { color: var(--primary); }
</style>
