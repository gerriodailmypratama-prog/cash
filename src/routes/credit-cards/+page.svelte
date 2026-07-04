<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase';

  let cards = $state([]);
  let installments = $state([]);
  let reminders = $state([]);
  let memos = $state(new Map());
  let equityByEntity = $state(new Map()); // entity_id -> Owner Equity (3000) account id
  let loading = $state(true);
  let errorMsg = $state('');

  // inline forms
  let adjustId = $state('');     // card being reconciled
  let adjustValue = $state('');
  let editId = $state('');       // card being edited
  let editLimit = $state('');
  let editStmt = $state('');
  let editDue = $state('');
  let formBusy = $state(false);
  let formMsg = $state('');

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

  // ---- float strategy: card whose NEXT statement close is furthest away wins ----
  function daysInMonth(y, m) {
    return new Date(y, m + 1, 0).getDate();
  }
  function daysUntilNextStatement(statementDay, today = new Date()) {
    if (!statementDay) return null;
    const d = today.getDate();
    const dim = daysInMonth(today.getFullYear(), today.getMonth());
    const sd = Math.min(statementDay, dim);
    if (sd > d) return sd - d;                      // closes later this month
    const dimNext = daysInMonth(today.getFullYear(), today.getMonth() + 1);
    return (dim - d) + Math.min(statementDay, dimNext); // wraps to next month
  }

  let summary = $derived({
    limit: cards.reduce((s, c) => s + Number(c.credit_limit || 0), 0),
    owing: cards.reduce((s, c) => s + Number(c.current_balance || 0), 0),
    available: cards.reduce((s, c) => s + Number(c.available || 0), 0)
  });

  // search + quick filters (list only; totals/ranking stay on ALL cards)
  let search = $state('');
  let filterMode = $state('all'); // 'all' | 'owing' | 'incomplete'
  function isIncomplete(c) {
    return c.due_day == null || c.statement_day == null || !Number(c.credit_limit || 0);
  }
  let visibleCards = $derived(
    cards.filter((c) => {
      const q = search.trim().toLowerCase();
      if (q && !(`${c.card_name} ${c.issuer || ''}`.toLowerCase().includes(q))) return false;
      if (filterMode === 'owing') return Number(c.current_balance || 0) > 0;
      if (filterMode === 'incomplete') return isIncomplete(c);
      return true;
    })
  );

  let ranking = $derived(
    cards
      .map((c) => ({ ...c, floatDays: daysUntilNextStatement(c.statement_day) }))
      .filter((c) => c.floatDays != null && !c.over_limit && Number(c.credit_limit || 0) > 0)
      .sort((a, b) => b.floatDays - a.floatDays)
  );
  let bestCard = $derived(ranking[0] ?? null);

  async function load() {
    try {
      const [c, i, r, m, eq] = await Promise.all([
        supabase.from('credit_card_status').select('*').order('card_name'),
        supabase.from('cc_installments_active').select('*'),
        supabase.from('cc_due_reminders').select('*'),
        supabase.from('credit_cards_active').select('account_id, memo'),
        supabase.from('accounts_active').select('id, entity_id').eq('code', '3000')
      ]);
      if (c.error) throw c.error;
      cards = c.data ?? [];
      installments = i.data ?? [];
      reminders = r.data ?? [];
      memos = new Map((m.data ?? []).filter((x) => x.memo).map((x) => [x.account_id, x.memo]));
      equityByEntity = new Map((eq.data ?? []).map((a) => [a.entity_id, a.id]));
    } catch (e) {
      errorMsg = e?.message ?? 'Gagal memuat data kartu.';
    } finally {
      loading = false;
    }
  }
  onMount(load);

  function toggleAdjust(card) {
    formMsg = '';
    editId = '';
    if (adjustId === card.account_id) { adjustId = ''; return; }
    adjustId = card.account_id;
    adjustValue = String(Math.round(card.current_balance || 0));
  }
  function toggleEdit(card) {
    formMsg = '';
    adjustId = '';
    if (editId === card.account_id) { editId = ''; return; }
    editId = card.account_id;
    editLimit = card.credit_limit == null ? '' : String(Math.round(card.credit_limit));
    editStmt = card.statement_day == null ? '' : String(card.statement_day);
    editDue = card.due_day == null ? '' : String(card.due_day);
  }

  // Reconcile: post ONE adjustment transaction so ledger outstanding == real bill.
  // more owed  -> card -> Owner Equity (spend recorded as opening balance)
  // less owed  -> Owner Equity -> card (treated like a payment)
  async function submitAdjust(card) {
    formMsg = '';
    const target = Number(adjustValue);
    if (Number.isNaN(target) || target < 0) { formMsg = 'Isi angka tagihan yang benar.'; return; }
    const delta = Math.round(target - Number(card.current_balance || 0));
    if (delta === 0) { formMsg = 'Sudah pas — tidak ada yang perlu disesuaikan.'; adjustId = ''; return; }
    const equity = equityByEntity.get(card.entity_id);
    if (!equity) { formMsg = 'Akun Owner Equity (3000) pot ini tidak ketemu.'; return; }
    formBusy = true;
    const { error } = await supabase.rpc('post_transaction', {
      p_amount: Math.abs(delta),
      p_from_account_id: delta > 0 ? card.account_id : equity,
      p_to_account_id: delta > 0 ? equity : card.account_id,
      p_entity_id: card.entity_id,
      p_memo: 'penyesuaian tagihan kartu (saldo awal)'
    });
    formBusy = false;
    if (error) { formMsg = error.message; return; }
    adjustId = '';
    loading = true;
    await load();
  }

  async function submitEdit(card) {
    formMsg = '';
    const lim = editLimit === '' ? null : Number(editLimit);
    const st = editStmt === '' ? null : Number(editStmt);
    const du = editDue === '' ? null : Number(editDue);
    if (lim != null && (Number.isNaN(lim) || lim < 0)) { formMsg = 'Limit tidak valid.'; return; }
    for (const d of [st, du]) {
      if (d != null && (Number.isNaN(d) || d < 1 || d > 31)) { formMsg = 'Tanggal harus 1–31.'; return; }
    }
    formBusy = true;
    const { error } = await supabase
      .from('credit_cards')
      .update({ credit_limit: lim, statement_day: st, due_day: du, updated_at: new Date().toISOString() })
      .eq('account_id', card.account_id);
    formBusy = false;
    if (error) { formMsg = error.message; return; }
    editId = '';
    loading = true;
    await load();
  }
</script>

<svelte:head><title>Kas — Kartu Kredit</title></svelte:head>

<section>
  <h1>Kartu Kredit</h1>
  <p class="lead">Limit, tagihan, jatuh tempo, dan cicilan jalan.</p>

  {#if loading}
    <div class="card"><p class="muted">Memuat…</p></div>
  {:else if errorMsg}
    <div class="card err"><p>{errorMsg}</p></div>
  {:else if cards.length === 0}
    <div class="card"><p class="muted">Belum ada kartu kredit. Tambahkan kartu sebagai akun LIABILITY lalu daftarkan di tabel credit_cards.</p></div>
  {:else}
    {#if bestCard}
      <div class="card best">
        <span class="best-label">💳 Gesek hari ini</span>
        <div class="best-row">
          <span class="best-name">{bestCard.card_name}</span>
          <span class="best-float">invoice berikutnya <b>{bestCard.floatDays} hari</b> lagi</span>
        </div>
        {#if ranking.length > 1}
          <div class="runner-up">
            {#each ranking.slice(1, 3) as r}
              <span>{r.card_name} · {r.floatDays}h</span>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <div class="card totals">
      <div><span class="muted">Total limit</span><span class="tot">{fmt(summary.limit)}</span></div>
      <div><span class="muted">Tagihan</span><span class="tot">{fmt(summary.owing)}</span></div>
      <div><span class="muted">Tersedia</span><span class="tot ok-text">{fmt(summary.available)}</span></div>
    </div>

    <div class="filter-bar">
      <input class="search" type="search" placeholder="Cari kartu / bank…" bind:value={search} />
      <div class="chips">
        <button class="chip" class:on={filterMode === 'all'} onclick={() => (filterMode = 'all')}>Semua</button>
        <button class="chip" class:on={filterMode === 'owing'} onclick={() => (filterMode = 'owing')}>Ada tagihan</button>
        <button class="chip" class:on={filterMode === 'incomplete'} onclick={() => (filterMode = 'incomplete')}>Belum lengkap</button>
      </div>
    </div>

    {#if visibleCards.length === 0}
      <div class="card"><p class="muted">Tidak ada kartu yang cocok dengan filter.</p></div>
    {/if}

    <div class="stack">
      {#each visibleCards as card (card.account_id)}
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

          {#if memos.get(card.account_id)}
            <p class="memo-flag">⚠ {memos.get(card.account_id)}</p>
          {/if}

          <div class="actions">
            <button class="act" onclick={() => toggleAdjust(card)}>Samakan tagihan</button>
            <button class="act" onclick={() => toggleEdit(card)}>Edit kartu</button>
          </div>

          {#if adjustId === card.account_id}
            <div class="inline-form">
              <label>
                <span>Tagihan real sekarang (Rp) — cek app bank / sheet lo</span>
                <input type="number" inputmode="numeric" min="0" step="1" bind:value={adjustValue} placeholder="0" />
              </label>
              <p class="hint">Sistem akan mencatat 1 transaksi penyesuaian supaya tagihan di app = angka ini.</p>
              {#if formMsg}<p class="form-err">{formMsg}</p>{/if}
              <button class="btn-primary" onclick={() => submitAdjust(card)} disabled={formBusy}>
                {formBusy ? 'Menyimpan…' : 'Sesuaikan'}
              </button>
            </div>
          {/if}

          {#if editId === card.account_id}
            <div class="inline-form">
              <label>
                <span>Limit (Rp)</span>
                <input type="number" inputmode="numeric" min="0" step="1" bind:value={editLimit} placeholder="kosongkan jika tidak tahu" />
              </label>
              <div class="two">
                <label>
                  <span>Tgl invoice (1–31)</span>
                  <input type="number" inputmode="numeric" min="1" max="31" bind:value={editStmt} placeholder="—" />
                </label>
                <label>
                  <span>Tgl tempo (1–31)</span>
                  <input type="number" inputmode="numeric" min="1" max="31" bind:value={editDue} placeholder="—" />
                </label>
              </div>
              {#if formMsg}<p class="form-err">{formMsg}</p>{/if}
              <button class="btn-primary" onclick={() => submitEdit(card)} disabled={formBusy}>
                {formBusy ? 'Menyimpan…' : 'Simpan kartu'}
              </button>
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

  .best { border-color: var(--primary); margin-bottom: 0.75rem; }
  .best-label { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; color: var(--primary); }
  .best-row { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; margin-top: 0.3rem; }
  .best-name { font-size: 1.2rem; font-weight: 700; }
  .best-float { color: var(--text-muted); font-size: 0.85rem; }
  .best-float b { color: var(--text); }
  .runner-up { display: flex; gap: 1rem; margin-top: 0.4rem; font-size: 0.78rem; color: var(--text-dim); }

  .totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; margin-bottom: 0.75rem; }
  .totals div { display: flex; flex-direction: column; gap: 0.15rem; }
  .totals .muted { font-size: 0.75rem; }
  .tot { font-weight: 700; font-size: 0.95rem; font-variant-numeric: tabular-nums; }
  .ok-text { color: var(--primary); }

  .memo-flag { margin: 0.6rem 0 0; font-size: 0.78rem; color: var(--warning); }

  .actions { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
  .act { background: transparent; color: var(--text-muted); border: 1px solid var(--border);
         border-radius: var(--radius-sm); padding: 0.3rem 0.7rem; font-size: 0.8rem; cursor: pointer; }
  .act:hover { color: var(--text); border-color: var(--text-dim); }

  .inline-form { margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px dashed var(--border);
                 display: flex; flex-direction: column; gap: 0.6rem; }
  .inline-form label { display: flex; flex-direction: column; gap: 0.3rem; }
  .inline-form label span { font-size: 0.8rem; color: var(--text-muted); }
  .inline-form input { padding: 0.55rem 0.7rem; font-size: 1rem; width: 100%; }
  .inline-form .two { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
  .hint { margin: 0; font-size: 0.75rem; color: var(--text-dim); }
  .form-err { margin: 0; font-size: 0.8rem; color: var(--danger); }

  .filter-bar { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; }
  .search { padding: 0.55rem 0.75rem; font-size: 0.95rem; width: 100%; }
  .chips { display: flex; gap: 0.4rem; overflow-x: auto; scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .chip { flex: 0 0 auto; background: transparent; color: var(--text-muted); border: 1px solid var(--border);
          border-radius: 999px; padding: 0.25rem 0.7rem; font-size: 0.78rem; font-weight: 600; cursor: pointer;
          white-space: nowrap; }
  .chip.on { color: var(--primary-contrast); background: var(--primary); border-color: var(--primary); }
</style>
