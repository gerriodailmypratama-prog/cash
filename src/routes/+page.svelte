<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { rupiah, accountLabel, monthRange } from '$lib/format';

  let loading = true;
  let errorMsg = '';

  let totalLikuid = 0;      // ASSET / subtype cash
  let expenseMonth = 0;     // money flowing INTO EXPENSE accounts this month
  let recent = [];          // latest transactions with resolved account labels

  onMount(async () => {
    const { first, last } = monthRange();

    const [accRes, balRes, monthRes, recentRes] = await Promise.all([
      supabase.from('accounts_active').select('id, code, name, type, subtype'),
      supabase.from('account_balances').select('account_id, type, subtype, balance'),
      supabase
        .from('transactions_active')
        .select('amount, fx_rate, to_account_id')
        .eq('status', 'posted')
        .gte('date', first)
        .lte('date', last),
      supabase
        .from('transactions_active')
        .select('id, date, amount, status, from_account_id, to_account_id, memo')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(5)
    ]);

    const firstErr = accRes.error || balRes.error || monthRes.error || recentRes.error;
    if (firstErr) { errorMsg = firstErr.message; loading = false; return; }

    const accById = new Map((accRes.data || []).map((a) => [a.id, a]));

    totalLikuid = (balRes.data || [])
      .filter((r) => r.type === 'ASSET' && (r.subtype || '').toLowerCase() === 'cash')
      .reduce((s, r) => s + Number(r.balance || 0), 0);

    expenseMonth = (monthRes.data || [])
      .filter((t) => accById.get(t.to_account_id)?.type === 'EXPENSE')
      .reduce((s, t) => s + Number(t.amount || 0) * Number(t.fx_rate || 1), 0);

    recent = (recentRes.data || []).map((t) => ({
      ...t,
      fromLabel: accountLabel(accById.get(t.from_account_id)),
      toLabel: accountLabel(accById.get(t.to_account_id))
    }));

    loading = false;
  });
</script>

<svelte:head><title>Kas — Dashboard</title></svelte:head>

<section>
  <h1>Dashboard</h1>
  <p class="lead">Ringkasan saldo, arus kas, dan kartu kredit kamu.</p>

  {#if loading}
    <div class="card"><p class="muted">Memuat ringkasan…</p></div>
  {:else if errorMsg}
    <div class="card"><p class="err">{errorMsg}</p></div>
  {:else}
    <div class="grid">
      <div class="card">
        <span class="card-label">Total Saldo Likuid</span>
        <span class="card-value">Rp {rupiah(totalLikuid)}</span>
      </div>
      <div class="card">
        <span class="card-label">Pengeluaran Bulan Ini</span>
        <span class="card-value">Rp {rupiah(expenseMonth)}</span>
      </div>
    </div>

    <div class="card">
      <div class="head">
        <h2>Transaksi Terakhir</h2>
        <a href="/transactions" class="link">Lihat semua</a>
      </div>
      {#if recent.length === 0}
        <p class="muted">
          Belum ada transaksi. Mulai dari
          <a href="/quick-capture" class="link">Quick Capture</a>.
        </p>
      {:else}
        <ul>
          {#each recent as t}
            <li>
              <div class="tx-main">
                <span class="tx-route">{t.fromLabel} → {t.toLabel}</span>
                {#if t.memo}<span class="tx-memo">{t.memo}</span>{/if}
              </div>
              <div class="tx-side">
                <span class="tx-amt" class:void={t.status === 'void'}>Rp {rupiah(t.amount)}</span>
                <span class="tx-date">{t.date}</span>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.25rem; }
  .lead { color: var(--text-muted); margin: 0 0 1rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.75rem; }
  .card-label { display: block; font-size: 0.8rem; color: var(--text-muted); }
  .card-value { display: block; font-size: 1.35rem; font-weight: 700; margin-top: 0.25rem;
                font-variant-numeric: tabular-nums; }
  .muted { color: var(--text-muted); margin: 0; }
  .err { color: var(--danger); margin: 0; }
  .link { color: var(--primary); }
  .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.5rem; }
  .head h2 { font-size: 1rem; font-weight: 600; margin: 0; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; justify-content: space-between; gap: 0.75rem;
       padding: 0.6rem 0; border-top: 1px solid var(--border); }
  li:first-child { border-top: none; }
  .tx-main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
  .tx-route { color: var(--text); font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tx-memo { color: var(--text-dim); font-size: 0.78rem; }
  .tx-side { display: flex; flex-direction: column; align-items: flex-end; gap: 0.15rem; white-space: nowrap; }
  .tx-amt { font-weight: 600; font-variant-numeric: tabular-nums; }
  .tx-amt.void { text-decoration: line-through; color: var(--text-dim); }
  .tx-date { color: var(--text-dim); font-size: 0.78rem; }
</style>
