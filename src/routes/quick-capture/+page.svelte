<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { accountLabel } from '$lib/format';

  let accounts = [];
  let entities = [];
  let loading = true;
  let saving = false;
  let errorMsg = '';
  let okMsg = '';

  // form state
  let mode = 'expense';          // 'expense' | 'income' | 'transfer'
  let amount = '';
  let payAccId = '';             // expense: pay from · transfer: from
  let categoryId = '';           // expense: expense acct · income: income acct · transfer: to
  let entityId = '';
  let memo = '';

  const LAST = 'gfin_qc_last';

  function loadLast() {
    try {
      const j = JSON.parse(localStorage.getItem(LAST) || '{}');
      mode = j.mode || 'expense';
      entityId = j.entityId || '';
    } catch (e) { /* ignore */ }
  }
  function saveLast() {
    try {
      localStorage.setItem(LAST, JSON.stringify({ mode, entityId }));
    } catch (e) { /* ignore */ }
  }

  onMount(async () => {
    loadLast();
    const [{ data: acc, error: e1 }, { data: ent, error: e2 }] = await Promise.all([
      supabase.from('accounts_active').select('id, code, name, type, subtype, entity_id').order('code'),
      supabase.from('entities_active').select('id, name').order('name')
    ]);
    if (e1) errorMsg = e1.message;
    if (e2) errorMsg = e2.message;
    accounts = acc || [];
    entities = ent || [];
    if (!entityId && entities.length) entityId = entities[0].id;
    loading = false;
  });

  // Account pools by type. Credit cards are LIABILITY accounts, valid to pay from.
  $: assetLiab = accounts.filter((a) => a.type === 'ASSET' || a.type === 'LIABILITY');
  $: expenses = accounts.filter((a) => a.type === 'EXPENSE');
  $: incomes = accounts.filter((a) => a.type === 'INCOME');

  // Contextual labels + option pools for the two selects, per mode.
  $: cfg = {
    expense: { l1: 'Bayar dari', o1: assetLiab, l2: 'Kategori pengeluaran', o2: expenses },
    income:  { l1: 'Masuk ke',   o1: assetLiab, l2: 'Sumber pemasukan',     o2: incomes },
    transfer:{ l1: 'Dari akun',  o1: assetLiab, l2: 'Ke akun',              o2: assetLiab }
  }[mode];

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    // account meanings change between modes, so reset the picks
    payAccId = '';
    categoryId = '';
    errorMsg = ''; okMsg = '';
  }

  // Map (mode, payAccId, categoryId) -> from/to for the from->to ledger.
  function resolveRoute() {
    if (mode === 'expense')  return { from: payAccId, to: categoryId };   // asset -> expense
    if (mode === 'income')   return { from: categoryId, to: payAccId };   // income -> asset
    return { from: payAccId, to: categoryId };                            // transfer: asset -> asset
  }

  async function submit() {
    errorMsg = ''; okMsg = '';
    const amt = Number(amount);
    if (!amt || amt <= 0) { errorMsg = 'Jumlah harus lebih dari 0.'; return; }
    if (!payAccId || !categoryId) { errorMsg = 'Pilih kedua akun dulu.'; return; }
    const { from, to } = resolveRoute();
    if (from === to) { errorMsg = 'Akun asal dan tujuan tidak boleh sama.'; return; }

    saving = true;
    const { error } = await supabase.rpc('post_transaction', {
      p_amount: amt,
      p_from_account_id: from,
      p_to_account_id: to,
      p_entity_id: entityId || null,
      p_memo: memo || null
    });
    saving = false;
    if (error) {
      errorMsg = error.message.includes('row-level security') || error.message.includes('permission')
        ? 'Tidak bisa menyimpan — kamu harus login dulu.'
        : error.message;
      return;
    }
    saveLast();
    okMsg = 'Tersimpan.';
    amount = '';
    memo = '';
  }
</script>

<svelte:head><title>GerrioFin — Quick Capture</title></svelte:head>

<section>
  <h1>Quick Capture</h1>
  <p class="lead">Catat transaksi cepat.</p>

  {#if loading}
    <div class="card"><p class="muted">Memuat akun…</p></div>
  {:else}
    <div class="modes">
      <button class="mode" class:active={mode === 'expense'} on:click={() => setMode('expense')}>Pengeluaran</button>
      <button class="mode" class:active={mode === 'income'} on:click={() => setMode('income')}>Pemasukan</button>
      <button class="mode" class:active={mode === 'transfer'} on:click={() => setMode('transfer')}>Transfer</button>
    </div>

    <div class="card form">
      <label>
        <span>Jumlah</span>
        <input type="number" inputmode="decimal" min="0" step="any"
               bind:value={amount} placeholder="0" />
      </label>

      <label>
        <span>{cfg.l1}</span>
        <select bind:value={payAccId}>
          <option value="" disabled>Pilih akun</option>
          {#each cfg.o1 as a}<option value={a.id}>{accountLabel(a)}</option>{/each}
        </select>
      </label>

      <label>
        <span>{cfg.l2}</span>
        <select bind:value={categoryId}>
          <option value="" disabled>Pilih akun</option>
          {#each cfg.o2 as a}<option value={a.id}>{accountLabel(a)}</option>{/each}
        </select>
      </label>

      {#if entities.length > 1}
        <label>
          <span>Entity</span>
          <select bind:value={entityId}>
            {#each entities as e}<option value={e.id}>{e.name}</option>{/each}
          </select>
        </label>
      {/if}

      <label>
        <span>Memo <small>(opsional)</small></span>
        <input type="text" bind:value={memo} placeholder="catatan singkat" />
      </label>

      {#if errorMsg}<p class="err">{errorMsg}</p>{/if}
      {#if okMsg}
        <p class="ok">{okMsg} <a href="/transactions" class="link">Lihat transaksi</a></p>
      {/if}

      <button class="btn-primary" on:click={submit} disabled={saving}>
        {saving ? 'Menyimpan…' : 'Simpan transaksi'}
      </button>
    </div>
  {/if}
</section>

<style>
  h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.25rem; }
  .lead { color: var(--text-muted); margin: 0 0 1rem; }
  .muted { color: var(--text-muted); margin: 0; }
  .modes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.4rem; margin-bottom: 0.75rem; }
  .mode { background: var(--surface); color: var(--text-muted); border: 1px solid var(--border);
          border-radius: var(--radius-sm); padding: 0.5rem 0.25rem; font-size: 0.85rem; font-weight: 600;
          cursor: pointer; }
  .mode.active { color: var(--primary-contrast); background: var(--primary); border-color: var(--primary); }
  .form { display: flex; flex-direction: column; gap: 0.75rem; }
  label { display: flex; flex-direction: column; gap: 0.35rem; }
  label span { font-size: 0.85rem; color: var(--text-muted); }
  label small { color: var(--text-dim); }
  input, select { padding: 0.6rem 0.7rem; font-size: 1rem; width: 100%; }
  .btn-primary { margin-top: 0.5rem; }
  .err { color: var(--danger); background: var(--danger-bg); padding: 0.5rem 0.7rem;
         border-radius: var(--radius-sm); margin: 0; }
  .ok { color: var(--primary); margin: 0; }
  .link { color: var(--primary); text-decoration: underline; }
</style>
