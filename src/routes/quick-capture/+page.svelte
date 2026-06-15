<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';

  let accounts = [];
  let entities = [];
  let loading = true;
  let saving = false;
  let errorMsg = '';
  let okMsg = '';

  // form state
  let amount = '';
  let fromId = '';
  let toId = '';
  let categoryId = '';
  let entityId = '';
  let memo = '';

  const LAST = 'gfin_qc_last';

  function loadLast() {
    try {
      const j = JSON.parse(localStorage.getItem(LAST) || '{}');
      fromId = j.fromId || '';
      toId = j.toId || '';
      categoryId = j.categoryId || '';
      entityId = j.entityId || '';
    } catch (e) { /* ignore */ }
  }
  function saveLast() {
    try {
      localStorage.setItem(LAST, JSON.stringify({ fromId, toId, categoryId, entityId }));
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

  // category options = INCOME/EXPENSE accounts
  $: categoryAccounts = accounts.filter((a) => a.type === 'INCOME' || a.type === 'EXPENSE');

  async function submit() {
    errorMsg = ''; okMsg = '';
    const amt = Number(amount);
    if (!amt || amt <= 0) { errorMsg = 'Jumlah harus lebih dari 0.'; return; }
    if (!fromId || !toId) { errorMsg = 'Pilih akun asal dan tujuan.'; return; }
    if (fromId === toId) { errorMsg = 'Akun asal dan tujuan tidak boleh sama.'; return; }

    saving = true;
    const { data, error } = await supabase.rpc('post_transaction', {
      p_amount: amt,
      p_from_account_id: fromId,
      p_to_account_id: toId,
      p_entity_id: entityId || null,
      p_category_account_id: categoryId || null,
      p_memo: memo || null
    });
    saving = false;
    if (error) { errorMsg = error.message; return; }
    saveLast();
    okMsg = 'Tersimpan.';
    amount = '';
    memo = '';
  }

  function fmt(a) {
    return (a.code ? a.code + ' · ' : '') + a.name;
  }
</script>

<svelte:head><title>GerrioFin — Quick Capture</title></svelte:head>

<section>
  <h1>Quick Capture</h1>
  <p class="lead">Catat transaksi cepat. Default ke akun terakhir dipakai.</p>

  {#if loading}
    <div class="card"><p class="muted">Memuat akun…</p></div>
  {:else}
    <div class="card form">
      <label>
        <span>Jumlah</span>
        <input type="number" inputmode="decimal" min="0" step="any"
               bind:value={amount} placeholder="0" />
      </label>

      <label>
        <span>Dari akun</span>
        <select bind:value={fromId}>
          <option value="" disabled>Pilih akun asal</option>
          {#each accounts as a}<option value={a.id}>{fmt(a)}</option>{/each}
        </select>
      </label>

      <label>
        <span>Ke akun</span>
        <select bind:value={toId}>
          <option value="" disabled>Pilih akun tujuan</option>
          {#each accounts as a}<option value={a.id}>{fmt(a)}</option>{/each}
        </select>
      </label>

      <label>
        <span>Kategori <small>(opsional)</small></span>
        <select bind:value={categoryId}>
          <option value="">— tanpa kategori —</option>
          {#each categoryAccounts as a}<option value={a.id}>{fmt(a)}</option>{/each}
        </select>
      </label>

      <label>
        <span>Entity</span>
        <select bind:value={entityId}>
          {#each entities as e}<option value={e.id}>{e.name}</option>{/each}
        </select>
      </label>

      <label>
        <span>Memo <small>(opsional)</small></span>
        <input type="text" bind:value={memo} placeholder="catatan singkat" />
      </label>

      {#if errorMsg}<p class="err">{errorMsg}</p>{/if}
      {#if okMsg}<p class="ok">{okMsg}</p>{/if}

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
  .form { display: flex; flex-direction: column; gap: 0.75rem; }
  label { display: flex; flex-direction: column; gap: 0.35rem; }
  label span { font-size: 0.85rem; color: var(--text-muted); }
  label small { color: var(--text-dim); }
  input, select { padding: 0.6rem 0.7rem; font-size: 1rem; width: 100%; }
  .btn-primary { margin-top: 0.5rem; }
  .err { color: var(--danger); background: var(--danger-bg); padding: 0.5rem 0.7rem;
         border-radius: var(--radius-sm); margin: 0; }
  .ok { color: var(--primary); margin: 0; }
</style>
