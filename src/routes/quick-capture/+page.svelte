<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { selectedPot } from '$lib/pots';
  import { accountLabel } from '$lib/format';
  import { emojiFor } from '$lib/emoji';

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
    // pot switcher (header) wins over the last-used entity
    if ($selectedPot) entityId = $selectedPot;
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

  // header pot change follows through while the page is open
  $: if ($selectedPot && entities.length && $selectedPot !== entityId) {
    entityId = $selectedPot;
    payAccId = '';
    categoryId = '';
  }

  $: entityById = new Map(entities.map((e) => [e.id, e]));
  function potName(id) {
    return entityById.get(id)?.name || '?';
  }
  function crossLabel(a) {
    return potName(a.entity_id) + ' · ' + accountLabel(a);
  }

  // Account pools scoped to the chosen pot. Credit cards are LIABILITY accounts,
  // valid to pay from. Transfer "Ke akun" spans ALL pots (cross-pot transfer).
  $: inPot = accounts.filter((a) => !entityId || a.entity_id === entityId);
  $: assetLiab = inPot.filter((a) => a.type === 'ASSET' || a.type === 'LIABILITY');
  $: expenses = inPot.filter((a) => a.type === 'EXPENSE');
  $: incomes = inPot.filter((a) => a.type === 'INCOME');
  $: assetLiabAll = accounts.filter((a) => a.type === 'ASSET' || a.type === 'LIABILITY');

  // Contextual labels + option pools for the two selects, per mode.
  $: cfg = {
    expense: { l1: 'Bayar dari', o1: assetLiab, l2: 'Kategori pengeluaran', o2: expenses, cross: false },
    income:  { l1: 'Masuk ke',   o1: assetLiab, l2: 'Sumber pemasukan',     o2: incomes,  cross: false },
    transfer:{ l1: 'Dari akun',  o1: assetLiab, l2: 'Ke akun (boleh beda pot)', o2: assetLiabAll, cross: true }
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

<svelte:head><title>Kas — Quick Capture</title></svelte:head>

<section>
  <h1>Quick Capture</h1>
  <p class="lead">Catat transaksi cepat.</p>

  {#if loading}
    <div class="card loading">
      <div class="skeleton" style="width: 42%; height: 0.9rem;"></div>
      <div class="skeleton" style="width: 100%; height: 2.9rem;"></div>
      <div class="skeleton" style="width: 68%; height: 0.9rem;"></div>
    </div>
  {:else}
    <h2 class="section-h sh">Jenis</h2>
    <div class="modes" role="group" aria-label="Jenis transaksi">
      <button class="seg" class:on={mode === 'expense'} on:click={() => setMode('expense')}>Pengeluaran</button>
      <button class="seg" class:on={mode === 'income'} on:click={() => setMode('income')}>Pemasukan</button>
      <button class="seg" class:on={mode === 'transfer'} on:click={() => setMode('transfer')}>Transfer</button>
    </div>

    <h2 class="section-h sh">Detail</h2>
    <div class="card form">
      <label>
        <span>Jumlah</span>
        <div class="amount-wrap">
          <span class="rp" aria-hidden="true">Rp</span>
          <input class="amount num" type="number" inputmode="decimal" min="0" step="any"
                 bind:value={amount} placeholder="0" />
        </div>
      </label>

      <label>
        <span>{cfg.l1}</span>
        <select bind:value={payAccId}>
          <option value="" disabled>Pilih akun</option>
          {#each cfg.o1 as a}<option value={a.id}>{emojiFor(a)} {accountLabel(a)}</option>{/each}
        </select>
      </label>

      <label>
        <span>{cfg.l2}</span>
        <select bind:value={categoryId}>
          <option value="" disabled>Pilih akun</option>
          {#each cfg.o2 as a}
            <option value={a.id}>{emojiFor(a)} {cfg.cross ? crossLabel(a) : accountLabel(a)}</option>
          {/each}
        </select>
      </label>

      {#if entities.length > 1}
        <label>
          <span>Pot</span>
          <select bind:value={entityId} on:change={() => { payAccId = ''; categoryId = ''; }}>
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
        <div class="ok-row">
          <span class="badge badge-primary">✓ {okMsg}</span>
          <a href="/transactions" class="link">Lihat transaksi →</a>
        </div>
      {/if}

      <button class="btn-primary submit" on:click={submit} disabled={saving}>
        {saving ? 'Menyimpan…' : 'Simpan transaksi'}
      </button>
    </div>
  {/if}
</section>

<style>
  h1 {
    font-size: 1.45rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0 0 0.25rem;
  }
  .lead { color: var(--text-muted); font-size: 0.9rem; margin: 0 0 1.1rem; }

  /* loading skeletons */
  .loading { display: flex; flex-direction: column; gap: 0.8rem; }

  /* section headers */
  .sh { display: flex; margin: 0 0 0.5rem; }

  /* segmented mode toggle — chip-style pills, gradient when active */
  .modes {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.45rem;
    margin-bottom: 1rem;
  }
  .seg {
    min-height: 42px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.5rem 0.25rem;
    font-size: 0.82rem;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.18s ease;
  }
  .seg:hover { border-color: var(--border-strong); color: var(--text); }
  .seg.on {
    color: var(--primary-contrast);
    background: var(--grad-primary);
    border-color: transparent;
    box-shadow: 0 2px 12px var(--primary-glow);
  }

  /* form */
  .form { display: flex; flex-direction: column; gap: 0.85rem; }
  label { display: flex; flex-direction: column; gap: 0.4rem; }
  label > span {
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--text-muted);
  }
  label small { color: var(--text-dim); font-weight: 400; }
  input, select { padding: 0.6rem 0.75rem; font-size: 1rem; width: 100%; min-height: 44px; }

  /* big centered amount with Rp prefix */
  .amount-wrap { position: relative; }
  .rp {
    position: absolute;
    left: 0.9rem;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-dim);
    pointer-events: none;
  }
  .amount {
    text-align: center;
    font-size: 1.6rem;
    font-weight: 700;
    padding: 0.45rem 3rem;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .amount::-webkit-outer-spin-button,
  .amount::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

  /* feedback */
  .err {
    color: var(--danger);
    background: var(--danger-bg);
    padding: 0.55rem 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    margin: 0;
  }
  .ok-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .link {
    color: var(--primary);
    font-size: 0.82rem;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .submit { width: 100%; min-height: 46px; font-size: 0.95rem; margin-top: 0.4rem; }
</style>
