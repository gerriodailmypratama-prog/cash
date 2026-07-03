<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';

  let cards = $state([]);
  let installments = $state([]);
  let reminders = $state([]);
  let loading = $state(true);
  let errorMsg = $state('');

  const fmt = (n) =>
    n == null ? '—' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);

  function plansFor(accountId) {
    return installments.filter((i) => i.card_account_id === accountId && i.remaining > 0);
  }
  function reminderFor(accountId) {
    return reminders.find((r) => r.account_id === accountId);
  }
  function utilClass(util) {
    if (util == null) return '';
    if (util >= 90) return 'bad';
    if (util >= 50) return 'warn';
    return 'ok';
  }

  onMount(async () => {
    try {
      const [c, i, r] = await Promise.all([
        supabase.from('credit_card_status').select('*').order('card_name'),
        supabase.from('cc_installments_active').select('*'),
        supabase.from('cc_due_reminders').select('*')
      ]);
      if (c.error) throw c.error;
      cards = c.data ?? [];
      installments = i.data ?? [];
      reminders = r.data ?? [];
    } catch (e) {
      errorMsg = e?.message ?? 'Gagal memuat data kartu.';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head><title>Kas — Credit Cards</title></svelte:head>

<section>
  <h1>Credit Cards</h1>
  <p class="lead">Limit, tagihan, jatuh tempo, dan cicilan jalan.</p>

  {#if loading}
    <div class="card"><p class="muted">Memuat…</p></div>
  {:else if errorMsg}
    <div class="card err"><p>{errorMsg}</p></div>
  {:else if cards.length === 0}
    <div class="card"><p class="muted">Belum ada kartu kredit. Tambahkan kartu sebagai akun LIABILITY lalu daftarkan di tabel credit_cards.</p></div>
  {:else}
    <div class="stack">
      {#each cards as card (card.account_id)}
        {@const rem = reminderFor(card.account_id)}
        {@const plans = plansFor(card.account_id)}
        <div class="card cc" class:over={card.over_limit}>
          <div class="cc-head">
            <div>
              <span class="cc-name">{card.card_name}</span>
              {#if card.issuer}<span class="cc-issuer">{card.issuer}</span>{/if}
            </div>
            {#if card.over_limit}
              <span class="badge bad">OVER LIMIT</span>
            {:else if rem}
              <span class="badge warn">Jatuh tempo {rem.days_until_due} hari lagi</span>
            {/if}
          </div>

          <div class="cc-balance">
            <span class="muted">Tagihan berjalan</span>
            <span class="big">{fmt(card.current_balance)}</span>
          </div>

          <div class="util-row">
            <div class="util-bar">
              <div class="util-fill {utilClass(card.util_pct)}" style="width:{Math.min(card.util_pct ?? 0, 100)}%"></div>
            </div>
            <span class="util-pct {utilClass(card.util_pct)}">{card.util_pct == null ? '—' : card.util_pct + '%'}</span>
          </div>

          <div class="cc-meta">
            <div><span class="muted">Limit</span><span>{fmt(card.credit_limit)}</span></div>
            <div><span class="muted">Tersedia</span><span>{fmt(card.available)}</span></div>
            <div><span class="muted">Due day</span><span>{card.due_day ?? '—'}</span></div>
            <div><span class="muted">Statement</span><span>{card.statement_day ?? '—'}</span></div>
          </div>

          {#if plans.length > 0}
            <div class="installments">
              <span class="muted small">Cicilan jalan</span>
              {#each plans as p (p.id)}
                <div class="inst-row">
                  <span>{fmt(p.monthly_amount)}/bln</span>
                  <span class="muted">sisa {p.remaining}/{p.tenor}×</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.25rem; }
  .lead { color: var(--text-muted); margin: 0 0 1rem; }
  .muted { color: var(--text-muted); }
  .small { font-size: 0.8rem; }
  .err { border-color: var(--danger); color: var(--danger); }

  .stack { display: flex; flex-direction: column; gap: 0.75rem; }
  .cc.over { border-color: var(--danger); }

  .cc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
  .cc-name { font-weight: 700; }
  .cc-issuer { color: var(--text-muted); margin-left: 0.5rem; font-size: 0.85rem; }

  .badge { font-size: 0.72rem; font-weight: 600; padding: 0.15rem 0.5rem; border-radius: 999px; white-space: nowrap; }
  .badge.warn { background: color-mix(in srgb, var(--warning) 18%, transparent); color: var(--warning); }
  .badge.bad { background: var(--danger-bg); color: var(--danger); }

  .cc-balance { display: flex; flex-direction: column; margin: 0.75rem 0 0.5rem; }
  .cc-balance .big { font-size: 1.6rem; font-weight: 700; }

  .util-row { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.75rem; }
  .util-bar { flex: 1; height: 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; overflow: hidden; }
  .util-fill { height: 100%; background: var(--primary); transition: width 0.3s ease; }
  .util-fill.warn { background: var(--warning); }
  .util-fill.bad { background: var(--danger); }
  .util-pct { font-size: 0.85rem; font-weight: 600; color: var(--primary); min-width: 3ch; text-align: right; }
  .util-pct.warn { color: var(--warning); }
  .util-pct.bad { color: var(--danger); }

  .cc-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem 1rem; }
  .cc-meta div { display: flex; justify-content: space-between; font-size: 0.9rem; }

  .installments { margin-top: 0.75rem; padding-top: 0.6rem; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 0.3rem; }
  .inst-row { display: flex; justify-content: space-between; font-size: 0.88rem; }
</style>
