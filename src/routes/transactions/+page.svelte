<script>
  import { onMount } from 'svelte';
  import { getSupabase, supabase } from '$lib/supabase';
  import { rupiah, accountLabel } from '$lib/format';

  let rows = [];
  let loading = true;
  let errorMsg = '';
  let voidingId = '';

  async function load() {
    loading = true;
    errorMsg = '';
    const [txRes, accRes] = await Promise.all([
      supabase
        .from('transactions_active')
        .select('id, date, amount, status, from_account_id, to_account_id, memo')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100),
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

  onMount(load);

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

<svelte:head><title>GerrioFin — Transaksi</title></svelte:head>

<section>
  <h1>Transaksi</h1>
  <p class="lead">100 transaksi terakhir. Void untuk membatalkan (soft, tetap tercatat).</p>

  {#if loading}
    <div class="card"><p class="muted">Memuat transaksi…</p></div>
  {:else if errorMsg}
    <div class="card"><p class="err">{errorMsg}</p></div>
  {:else if rows.length === 0}
    <div class="card">
      <p class="muted">Belum ada transaksi. Mulai dari <a href="/quick-capture" class="link">Quick Capture</a>.</p>
    </div>
  {:else}
    {#if errorMsg}<p class="err">{errorMsg}</p>{/if}
    <div class="card list">
      <ul>
        {#each rows as t}
          <li class:voided={t.status === 'void'}>
            <div class="tx-main">
              <span class="tx-route">{t.fromLabel} → {t.toLabel}</span>
              <span class="tx-sub">
                {t.date}
                {#if t.status !== 'posted'}<span class="badge {t.status}">{t.status}</span>{/if}
                {#if t.memo}· {t.memo}{/if}
              </span>
            </div>
            <div class="tx-side">
              <span class="tx-amt">Rp {rupiah(t.amount)}</span>
              {#if t.status === 'posted'}
                <button class="void-btn" on:click={() => voidTx(t)} disabled={voidingId === t.id}>
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
  h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.25rem; }
  .lead { color: var(--text-muted); margin: 0 0 1rem; }
  .muted { color: var(--text-muted); margin: 0; }
  .err { color: var(--danger); background: var(--danger-bg); padding: 0.5rem 0.7rem;
         border-radius: var(--radius-sm); margin: 0 0 0.75rem; }
  .link { color: var(--primary); }
  .list { padding: 0.25rem 1rem; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem;
       padding: 0.7rem 0; border-top: 1px solid var(--border); }
  li:first-child { border-top: none; }
  li.voided .tx-route, li.voided .tx-amt { text-decoration: line-through; color: var(--text-dim); }
  .tx-main { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
  .tx-route { color: var(--text); font-size: 0.92rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tx-sub { color: var(--text-dim); font-size: 0.78rem; }
  .tx-side { display: flex; flex-direction: column; align-items: flex-end; gap: 0.3rem; white-space: nowrap; }
  .tx-amt { font-weight: 600; font-variant-numeric: tabular-nums; }
  .badge { text-transform: uppercase; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.04em;
           padding: 0.05rem 0.35rem; border-radius: 999px; }
  .badge.void { color: var(--danger); border: 1px solid var(--danger); }
  .badge.draft { color: var(--warning); border: 1px solid var(--warning); }
  .void-btn { background: transparent; color: var(--danger); border: 1px solid var(--border);
              border-radius: var(--radius-sm); padding: 0.2rem 0.6rem; font-size: 0.78rem; cursor: pointer; }
  .void-btn:hover { border-color: var(--danger); }
  .void-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
