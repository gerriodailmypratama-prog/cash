<script>
  import { onMount } from 'svelte';
  import { getSupabase, supabase } from '$lib/supabase';
  import { selectedPot } from '$lib/pots';
  import { rupiah, accountLabel } from '$lib/format';

  let rows = [];
  let loading = true;
  let errorMsg = '';
  let voidingId = '';
  let ready = false;

  async function load(pot) {
    loading = true;
    errorMsg = '';
    let txQ = supabase
      .from('transactions_active')
      .select('id, date, amount, status, from_account_id, to_account_id, memo')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);
    if (pot) txQ = txQ.eq('entity_id', pot);
    const [txRes, accRes] = await Promise.all([
      txQ,
      // labels unfiltered so cross-pot transfers still resolve
      supabase.from('accounts_active').select('id, code, name, type, subtype')
    ]);
    if (txRes.error || accRes.error) {
      errorMsg = (txRes.error || accRes.error).message;
      loading = false;
      return;
    }
    const accById = new Map((accRes.data || []).map((a) => [a.id, a]));
    rows = (txRes.data || []).map((t) => ({
      ...t,
      fromLabel: accountLabel(accById.get(t.from_account_id)),
      toLabel: accountLabel(accById.get(t.to_account_id))
    }));
    loading = false;
  }

  onMount(() => { ready = true; });
  $: if (ready) load($selectedPot);

  // Void = accounting cancel: set status='void'. The row stays visible (struck
  // through) and drops out of account_balances (that view only counts 'posted').
  // Requires an authenticated session (base-table RLS UPDATE policy).
  async function voidTx(t) {
    if (t.status !== 'posted') return;
    if (!confirm(`Void transaksi ini?\n${t.fromLabel} → ${t.toLabel}\nRp ${rupiah(t.amount)}`)) return;
    voidingId = t.id;
    errorMsg = '';
    const { error } = await getSupabase()
      .from('transactions')
      .update({ status: 'void' })
      .eq('id', t.id)
      .eq('status', 'posted');
    voidingId = '';
    if (error) {
      errorMsg = error.message.includes('row-level security') || error.message.includes('permission')
        ? 'Tidak bisa void — kamu harus login dulu.'
        : error.message;
      return;
    }
    rows = rows.map((r) => (r.id === t.id ? { ...r, status: 'void' } : r));
  }
</script>

<svelte:head><title>Kas — Transaksi</title></svelte:head>

<section>
  <h1>Transaksi</h1>
  <p class="lead">100 transaksi terakhir. Void untuk membatalkan (soft, tetap tercatat).</p>

  {#if loading}
    <div class="card">
      <div class="skeleton" style="width: 72%"></div>
      <div class="skeleton" style="width: 46%"></div>
      <div class="skeleton" style="width: 61%"></div>
    </div>
  {:else if errorMsg}
    <div class="card"><p class="err">{errorMsg}</p></div>
  {:else if rows.length === 0}
    <div class="card">
      <p class="muted">Belum ada transaksi. Mulai dari <a href="/quick-capture" class="link">Quick Capture</a>.</p>
    </div>
  {:else}
    {#if errorMsg}<p class="err">{errorMsg}</p>{/if}
    <h2 class="section-h list-h">Riwayat</h2>
    <div class="card list">
      <ul>
        {#each rows as t}
          <li class="row" class:voided={t.status === 'void'}>
            <div class="tx-main">
              <span class="tx-title">{t.memo || `${t.fromLabel} → ${t.toLabel}`}</span>
              <span class="tx-sub">
                {t.date} · {t.fromLabel} → {t.toLabel}
                {#if t.status !== 'posted'}
                  <span class="badge {t.status === 'void' ? 'badge-danger' : 'badge-warning'}">{t.status}</span>
                {/if}
              </span>
            </div>
            <div class="tx-side">
              <span class="tx-amt num">Rp {rupiah(t.amount)}</span>
              {#if t.status === 'posted'}
                <button class="void-btn btn-ghost" on:click={() => voidTx(t)} disabled={voidingId === t.id}>
                  {voidingId === t.id ? '…' : 'Void'}
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>

<style>
  h1 { font-size: 1.45rem; font-weight: 700; margin: 0 0 0.25rem; letter-spacing: -0.01em; }
  .lead { color: var(--text-muted); margin: 0 0 1.1rem; font-size: 0.88rem; }
  .muted { color: var(--text-muted); margin: 0; }

  .err {
    color: var(--danger);
    background: var(--danger-bg);
    padding: 0.5rem 0.7rem;
    border-radius: var(--radius-sm);
    margin: 0 0 0.75rem;
  }
  .card > .err { margin: 0; }
  .link { color: var(--primary); font-weight: 600; }

  /* loading skeletons */
  .card > .skeleton { height: 0.95rem; }
  .card > .skeleton + .skeleton { margin-top: 0.8rem; }

  .list-h { display: flex; margin: 0 0 0.55rem; }
  .list { padding: 0.35rem 1.1rem; }
  ul { list-style: none; margin: 0; padding: 0; }

  li.voided { opacity: 0.6; }
  li.voided .tx-title,
  li.voided .tx-amt { text-decoration: line-through; color: var(--text-dim); }

  .tx-main { display: flex; flex-direction: column; gap: 0.22rem; min-width: 0; }
  .tx-title {
    color: var(--text);
    font-size: 0.92rem;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tx-sub {
    color: var(--text-dim);
    font-size: 0.76rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .tx-side { display: flex; align-items: center; gap: 0.6rem; white-space: nowrap; }
  .tx-amt { font-weight: 650; font-size: 0.92rem; }

  /* ghost mini-button, danger accent */
  .void-btn {
    color: var(--danger);
    padding: 0.3rem 0.75rem;
    min-height: 2.5rem;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .void-btn:hover:not(:disabled) {
    background-color: var(--danger-bg);
    border-color: var(--danger);
  }
  .void-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
