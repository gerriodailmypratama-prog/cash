<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { selectedPot } from '$lib/pots';
  import { rupiah, accountLabel, monthRange } from '$lib/format';

  let loading = true;
  let errorMsg = '';

  let totalLikuid = 0;      // ASSET / subtype cash (filtered by pot)
  let expenseMonth = 0;     // money flowing INTO EXPENSE accounts this month
  let recent = [];          // latest transactions with resolved account labels

  let ready = false;

  async function load(pot) {
    loading = true;
    errorMsg = '';
    const { first, last } = monthRange();

    // labels/type lookup stays unfiltered so cross-pot transfers still resolve
    let balQ = supabase.from('account_balances').select('account_id, entity_id, type, subtype, balance');
    let monthQ = supabase
      .from('transactions_active')
      .select('amount, fx_rate, to_account_id')
      .eq('status', 'posted')
      .gte('date', first)
      .lte('date', last);
    let recentQ = supabase
      .from('transactions_active')
      .select('id, date, amount, status, from_account_id, to_account_id, memo')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(5);
    if (pot) {
      balQ = balQ.eq('entity_id', pot);
      monthQ = monthQ.eq('entity_id', pot);
      recentQ = recentQ.eq('entity_id', pot);
    }

    const [accRes, balRes, monthRes, recentRes] = await Promise.all([
      supabase.from('accounts_active').select('id, code, name, type, subtype'),
      balQ, monthQ, recentQ
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
  }

  onMount(() => { ready = true; });
  $: if (ready) load($selectedPot);
</script>

<svelte:head><title>Kas — Dashboard</title></svelte:head>

<section>
  <h1>Dashboard</h1>
  <p class="lead">Ringkasan saldo, arus kas, dan kartu kredit kamu.</p>

  {#if loading}
    <div class="card" aria-busy="true">
      <div class="skeleton" style="width: 45%;"></div>
      <div class="skeleton sk-big" style="width: 72%;"></div>
      <div class="skeleton" style="width: 58%;"></div>
    </div>
  {:else if errorMsg}
    <div class="card"><p class="err">{errorMsg}</p></div>
  {:else}
    <div class="stat-grid">
      <div class="card-hero hero">
        <span class="stat-label">Total Saldo Likuid</span>
        <span class="hero-value num">Rp {rupiah(totalLikuid)}</span>
        <span class="live"><span class="pulse-dot"></span> live dari ledger</span>
      </div>
      <div class="card stat">
        <span class="stat-label">Pengeluaran Bulan Ini</span>
        <span class="stat-value num">Rp {rupiah(expenseMonth)}</span>
      </div>
    </div>

    <div class="list-head">
      <h2 class="section-h">Transaksi Terakhir</h2>
      <a href="/transactions" class="link">Lihat semua</a>
    </div>
    <div class="card">
      {#if recent.length === 0}
        <p class="muted">
          Belum ada transaksi. Mulai dari
          <a href="/quick-capture" class="link">Quick Capture</a>.
        </p>
      {:else}
        <ul>
          {#each recent as t}
            <li class="row">
              <span class="tx-glyph" aria-hidden="true">↗</span>
              <div class="tx-main">
                <span class="tx-route">{t.fromLabel} → {t.toLabel}</span>
                {#if t.memo}<span class="tx-memo">{t.memo}</span>{/if}
              </div>
              <div class="tx-side">
                <span class="tx-amt num" class:void={t.status === 'void'}>Rp {rupiah(t.amount)}</span>
                <span class="tx-date num">{t.date}</span>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  h1 { font-size: 1.45rem; font-weight: 700; margin: 0 0 0.25rem; }
  .lead { color: var(--text-muted); margin: 0 0 1.1rem; font-size: 0.9rem; }

  /* loading skeletons */
  .skeleton { margin: 0.45rem 0; }
  .skeleton:first-child { margin-top: 0; }
  .skeleton:last-child { margin-bottom: 0; }
  .sk-big { min-height: 1.9rem; }

  /* ---- stat cards ---- */
  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 1.25rem;
  }
  .hero {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .stat-label {
    display: block;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    font-weight: 700;
    color: var(--text-muted);
  }
  .hero-value {
    display: block;
    font-size: 1.9rem;
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: -0.01em;
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    font-size: 0.72rem;
    font-weight: 600;
    color: var(--text-dim);
  }
  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    justify-content: center;
  }
  .stat-value {
    display: block;
    font-size: 1.3rem;
    font-weight: 700;
    line-height: 1.2;
  }
  @media (max-width: 480px) {
    .stat-grid { grid-template-columns: 1fr; }
  }

  /* ---- recent transactions ---- */
  .list-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin: 0 0.15rem 0.55rem;
  }
  .link {
    color: var(--primary);
    font-size: 0.8rem;
    font-weight: 600;
    transition: filter 0.18s ease;
  }
  .link:hover { filter: brightness(1.15); }

  .muted { color: var(--text-muted); margin: 0; font-size: 0.88rem; }
  .err { color: var(--danger); margin: 0; }

  ul { list-style: none; margin: 0; padding: 0; }
  .row { min-height: 40px; }
  .tx-glyph {
    flex: 0 0 auto;
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 700;
  }
  .tx-main {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1;
  }
  .tx-route {
    color: var(--text);
    font-size: 0.88rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tx-memo {
    color: var(--text-dim);
    font-size: 0.76rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tx-side {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.15rem;
    white-space: nowrap;
  }
  .tx-amt { font-weight: 700; font-size: 0.9rem; }
  .tx-amt.void { text-decoration: line-through; color: var(--text-dim); }
  .tx-date { color: var(--text-dim); font-size: 0.74rem; }
</style>
