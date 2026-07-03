<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { selectedPot } from '$lib/pots';

  let rows = [];        // from account_balances view
  let loading = true;
  let errorMsg = '';
  let ready = false;

  // Group definitions. Map account type/subtype -> a display group.
  const GROUPS = [
    { key: 'likuid',     label: 'Likuid' },
    { key: 'piutang',    label: 'Piutang' },
    { key: 'stok',       label: 'Stok' },
    { key: 'investasi',  label: 'Investasi' },
    { key: 'aset_tetap', label: 'Asset Tetap' },
    { key: 'liabilitas', label: 'Liabilitas' }
  ];

  function groupOf(r) {
    const sub = (r.subtype || '').toLowerCase();
    if (r.type === 'LIABILITY') return 'liabilitas';
    if (r.type === 'ASSET') {
      if (sub === 'cash') return 'likuid';
      if (sub === 'receivable') return 'piutang';
      if (sub === 'inventory') return 'stok';
      if (sub === 'investment') return 'investasi';
      if (sub === 'fixed' || sub === 'fixed_asset') return 'aset_tetap';
      return 'likuid'; // default assets to liquid
    }
    return null; // income/equity/expense not shown on the accounts balance page
  }

  async function load(pot) {
    loading = true;
    errorMsg = '';
    let q = supabase
      .from('account_balances')
      .select('account_id, entity_id, code, name, type, subtype, balance')
      .order('code');
    if (pot) q = q.eq('entity_id', pot);
    const { data, error } = await q;
    if (error) errorMsg = error.message;
    rows = data || [];
    loading = false;
  }

  onMount(() => { ready = true; });
  $: if (ready) load($selectedPot);

  $: grouped = GROUPS.map((g) => ({
    ...g,
    items: rows.filter((r) => groupOf(r) === g.key),
    total: rows.filter((r) => groupOf(r) === g.key)
              .reduce((s, r) => s + Number(r.balance || 0), 0)
  })).filter((g) => g.items.length > 0);

  function rupiah(n) {
    const v = Number(n || 0);
    return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(v);
  }
</script>

<svelte:head><title>Kas — Akun & Saldo</title></svelte:head>

<section>
  <h1>Akun &amp; Saldo</h1>
  <p class="lead">Saldo real-time dari ledger (view saldo).</p>

  {#if loading}
    <div class="card"><p class="muted">Memuat saldo…</p></div>
  {:else if errorMsg}
    <div class="card"><p class="err">{errorMsg}</p></div>
  {:else if grouped.length === 0}
    <div class="card"><p class="muted">Belum ada akun.</p></div>
  {:else}
    {#each grouped as g}
      <div class="card group">
        <div class="group-head">
          <h2>{g.label}</h2>
          <span class="total">Rp {rupiah(g.total)}</span>
        </div>
        <ul>
          {#each g.items as a}
            <li>
              <span class="acc">{a.code ? a.code + ' · ' : ''}{a.name}</span>
              <span class="bal">Rp {rupiah(a.balance)}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  {/if}
</section>

<style>
  h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.25rem; }
  .lead { color: var(--text-muted); margin: 0 0 1rem; }
  .muted { color: var(--text-muted); margin: 0; }
  .err { color: var(--danger); margin: 0; }
  .group { margin-bottom: 0.75rem; }
  .group-head { display: flex; justify-content: space-between; align-items: baseline;
                margin-bottom: 0.5rem; }
  .group-head h2 { font-size: 1rem; font-weight: 600; margin: 0; }
  .group-head .total { font-weight: 700; color: var(--primary); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  li { display: flex; justify-content: space-between; gap: 1rem;
       padding: 0.5rem 0; border-top: 1px solid var(--border); }
  li:first-child { border-top: none; }
  .acc { color: var(--text); }
  .bal { color: var(--text-muted); font-variant-numeric: tabular-nums; }
</style>
