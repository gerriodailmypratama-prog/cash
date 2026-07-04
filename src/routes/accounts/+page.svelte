<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';
  import { selectedPot } from '$lib/pots';
  import { emojiFor } from '$lib/emoji';

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
    <div class="card">
      <div class="skeleton sk-head" style="width: 38%;"></div>
      <div class="skeleton sk-line" style="width: 100%;"></div>
      <div class="skeleton sk-line" style="width: 72%;"></div>
    </div>
  {:else if errorMsg}
    <div class="card"><p class="err">{errorMsg}</p></div>
  {:else if grouped.length === 0}
    <div class="card"><p class="muted">Belum ada akun.</p></div>
  {:else}
    {#each grouped as g}
      <div class="card group">
        <div class="group-head">
          <h2 class="section-h">{g.label}</h2>
          <span class="total num {g.total < 0 ? 'amount-neg' : 'amount-pos'}">Rp {rupiah(g.total)}</span>
        </div>
        <ul>
          {#each g.items as a}
            <li class="row">
              <span class="acc">{emojiFor(a)} {a.name}</span>
              <span class="bal num {a.balance < 0 ? 'amount-neg' : ''}">Rp {rupiah(a.balance)}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  {/if}
</section>

<style>
  h1 { font-size: 1.45rem; font-weight: 700; margin: 0 0 0.25rem; letter-spacing: -0.01em; }
  .lead { color: var(--text-muted); margin: 0 0 1.1rem; font-size: 0.9rem; }
  .muted { color: var(--text-muted); margin: 0; }
  .err { color: var(--danger); margin: 0; }

  /* loading skeletons */
  .sk-head { height: 0.8rem; margin-bottom: 0.9rem; }
  .sk-line { height: 0.95rem; }
  .sk-line + .sk-line { margin-top: 0.6rem; }

  .group { margin-bottom: 0.8rem; }
  .group-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.35rem;
  }
  .total { font-weight: 700; font-size: 0.95rem; }

  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .acc { color: var(--text); font-size: 0.9rem; min-width: 0; overflow-wrap: anywhere; }
  .bal { font-weight: 600; font-size: 0.9rem; }
  .bal:not(.amount-neg) { color: var(--text-muted); }
</style>
