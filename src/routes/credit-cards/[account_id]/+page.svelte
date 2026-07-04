<script>
  import { page } from '$app/stores';
  import { supabase } from '$lib/supabase';
  import { rupiah, accountLabel } from '$lib/format';
  import { bankLogo } from '$lib/bank-logos';
  import { emojiFor } from '$lib/emoji';

  let id = $derived($page.params.account_id);

  let card = $state(null);
  let rows = $state([]);        // transactions touching this card
  let accById = $state(new Map());
  let loading = $state(true);
  let errorMsg = $state('');

  const fmt = (n) => (n == null ? '—' : 'Rp ' + rupiah(n));

  async function load(cardId) {
    loading = true;
    errorMsg = '';
    const [c, acc] = await Promise.all([
      supabase.from('credit_card_status').select('*').eq('account_id', cardId).maybeSingle(),
      supabase.from('accounts_active').select('id, code, name')
    ]);
    if (c.error) { errorMsg = c.error.message; loading = false; return; }
    card = c.data;
    accById = new Map((acc.data ?? []).map((a) => [a.id, a]));

    // transactions where this card is either side (spend = from card, payment = to card)
    const { data, error } = await supabase
      .from('transactions_active')
      .select('id, date, amount, status, from_account_id, to_account_id, memo')
      .or(`from_account_id.eq.${cardId},to_account_id.eq.${cardId}`)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) { errorMsg = error.message; loading = false; return; }
    rows = (data ?? []).map((t) => {
      const spend = t.from_account_id === cardId; // money left the card = a charge
      const other = accById.get(spend ? t.to_account_id : t.from_account_id);
      return {
        ...t,
        spend,
        otherLabel: accountLabel(other) || '—',
        signed: spend ? Number(t.amount) : -Number(t.amount) // charge +, payment −
      };
    });
    loading = false;
  }

  $effect(() => {
    if (id) load(id);
  });

  // category breakdown of charges (non-void, spend only)
  let breakdown = $derived.by(() => {
    const m = new Map();
    for (const t of rows) {
      if (!t.spend || t.status === 'void') continue;
      const k = t.otherLabel;
      m.set(k, (m.get(k) || 0) + Number(t.amount));
    }
    // refunds reduce their category
    for (const t of rows) {
      if (t.spend || t.status === 'void') continue;
      if ((t.memo || '').toLowerCase().includes('refund')) {
        const k = t.otherLabel;
        if (m.has(k)) m.set(k, m.get(k) - Number(t.amount));
      }
    }
    const arr = [...m.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);
    const max = arr[0]?.total || 1;
    const grand = arr.reduce((s, x) => s + x.total, 0);
    return { arr, max, grand };
  });
</script>

<svelte:head><title>Kas — Detail Kartu</title></svelte:head>

<section>
  <a href="/credit-cards" class="back">← Semua kartu</a>

  {#if loading}
    <div class="card loading" aria-busy="true">
      <div class="skeleton" style="width: 42%; height: 0.9rem;"></div>
      <div class="skeleton" style="width: 68%; height: 1.7rem;"></div>
      <div class="skeleton" style="width: 55%; height: 0.9rem;"></div>
    </div>
  {:else if errorMsg}
    <div class="card"><p class="err">{errorMsg}</p></div>
  {:else if !card}
    <div class="card"><p class="muted">Kartu tidak ditemukan.</p></div>
  {:else}
    {@const bank = bankLogo(card.issuer, card.card_name)}
    <div class="head-id">
      <span class="bank-chip" style={bank.src ? '' : `background:${bank.bg};color:${bank.fg}`}>
        {#if bank.src}<img src={bank.src} alt={bank.alt} />{:else}{bank.initials}{/if}
      </span>
      <div>
        <h1>{card.card_name}</h1>
        <p class="lead">{card.issuer ?? ''}</p>
      </div>
    </div>

    <div class="card-hero summary" class:over={card.over_limit}>
      <div class="s-bill">
        <span class="s-label">Tagihan berjalan</span>
        <span class="big num">{fmt(card.current_balance)}</span>
        {#if card.over_limit}<span class="badge badge-danger">OVER LIMIT</span>{/if}
      </div>
      <div class="s-grid">
        <div><span class="muted">Limit</span><span class="num">{fmt(card.credit_limit)}</span></div>
        <div><span class="muted">Tersedia</span><span class="num" class:amount-neg={Number(card.available) < 0}>{fmt(card.available)}</span></div>
        <div><span class="muted">Utilisasi</span><span class="num">{card.util_pct == null ? '—' : card.util_pct + '%'}</span></div>
        <div><span class="muted">Invoice</span><span class="num">tgl {card.statement_day ?? '—'}</span></div>
        <div><span class="muted">Jatuh tempo</span><span class="num">tgl {card.due_day ?? '—'}</span></div>
      </div>
      <a class="manage" href="/credit-cards">Bayar / Samakan / Edit di halaman kartu →</a>
    </div>

    {#if breakdown.arr.length > 0}
      <h2 class="section-h">Kemana uang lari (kartu ini)</h2>
      <div class="card">
        <ul class="bd">
          {#each breakdown.arr as b}
            <li>
              <div class="bd-top">
                <span class="bd-label">{emojiFor(b.label)} {b.label}</span>
                <span class="bd-amt num">Rp {rupiah(b.total)}
                  <span class="bd-pct">{Math.round((b.total / breakdown.grand) * 100)}%</span>
                </span>
              </div>
              <div class="bd-bar"><div class="bd-fill" style="width:{Math.max((b.total / breakdown.max) * 100, 2)}%"></div></div>
            </li>
          {/each}
        </ul>
        <p class="bd-total">Total pemakaian tercatat: <b class="num">Rp {rupiah(breakdown.grand)}</b></p>
      </div>
    {/if}

    <h2 class="section-h">Rincian transaksi</h2>
    {#if rows.length === 0}
      <div class="card">
        <p class="muted">Belum ada transaksi tercatat untuk kartu ini. Gesekan yang kamu catat
        (dan pembayaran) akan muncul di sini. Riwayat lama bisa diisi lewat import statement nanti.</p>
      </div>
    {:else}
      <div class="card list">
        <ul>
          {#each rows as t}
            <li class="row" class:voided={t.status === 'void'}>
              <div class="t-main">
                <span class="t-desc">{t.memo || (t.spend ? 'Belanja' : 'Pembayaran')}</span>
                <span class="t-sub">{t.date} · {t.spend ? 'ke' : 'dari'} {emojiFor(t.otherLabel)} {t.otherLabel}
                  {#if t.status === 'void'}· <span class="v">void</span>{/if}</span>
              </div>
              <span class="t-amt num" class:amount-pos={!t.spend}>
                {t.spend ? '+' : '−'} Rp {rupiah(Math.abs(t.amount))}
              </span>
            </li>
          {/each}
        </ul>
      </div>
      <p class="hint">+ = pemakaian (nambah tagihan) · − = pembayaran (ngurangin tagihan)</p>
    {/if}
  {/if}
</section>

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.55rem 0;
    color: var(--text-muted);
    font-size: 0.85rem;
    font-weight: 600;
    transition: color 0.18s ease;
  }
  .back:hover { color: var(--primary); }

  .head-id { display: flex; align-items: center; gap: 0.75rem; margin: 0.5rem 0 1rem; }
  .head-id .bank-chip { width: 46px; height: 46px; border-radius: 12px; }
  h1 {
    font-size: 1.45rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    margin: 0 0 0.1rem;
  }
  .lead { color: var(--text-muted); font-size: 0.9rem; margin: 0; }
  h2.section-h { display: flex; margin: 1.5rem 0 0.6rem; }

  .muted { color: var(--text-muted); }
  .err { color: var(--danger); margin: 0; }
  .hint { color: var(--text-dim); font-size: 0.75rem; margin: 0.5rem 0 0; }

  /* loading skeletons */
  .loading { display: flex; flex-direction: column; gap: 0.6rem; }

  /* ---- summary hero ---- */
  .summary { margin-top: 0.25rem; }
  .summary.over { border-color: var(--danger); }
  .s-bill {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.2rem;
    margin-bottom: 0.95rem;
  }
  .s-label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    font-weight: 700;
    color: var(--text-muted);
  }
  .big { font-size: 1.9rem; font-weight: 800; line-height: 1.15; }
  .s-bill .badge { margin-top: 0.4rem; }
  .s-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.45rem 1.25rem;
  }
  .s-grid > div {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.88rem;
  }
  .s-grid .muted { font-size: 0.8rem; }
  .manage {
    display: inline-flex;
    align-items: center;
    margin-top: 0.75rem;
    padding: 0.3rem 0;
    color: var(--primary);
    font-size: 0.85rem;
    font-weight: 600;
    transition: filter 0.18s ease;
  }
  .manage:hover { filter: brightness(1.15); }

  /* ---- breakdown bars ---- */
  .bd { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
  .bd-top { display: flex; justify-content: space-between; gap: 0.5rem; font-size: 0.88rem; margin-bottom: 0.3rem; }
  .bd-label { color: var(--text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bd-amt { font-weight: 600; white-space: nowrap; }
  .bd-pct { color: var(--text-dim); font-weight: 400; font-size: 0.78rem; margin-left: 0.35rem; }
  .bd-bar { height: 7px; background: var(--surface-2); border-radius: 999px; overflow: hidden; }
  .bd-fill {
    height: 100%;
    background: var(--grad-primary);
    border-radius: 999px;
    box-shadow: 0 0 8px var(--primary-glow);
    transition: width 0.18s ease;
  }
  .bd-total {
    margin: 0.85rem 0 0;
    padding-top: 0.65rem;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .bd-total b { color: var(--text); }

  /* ---- transactions ---- */
  .list { padding: 0.35rem 1.1rem; }
  ul { list-style: none; margin: 0; padding: 0; }
  li.voided { opacity: 0.5; }
  li.voided .t-amt { text-decoration: line-through; }
  .t-main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
  .t-desc { color: var(--text); font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-sub { color: var(--text-dim); font-size: 0.76rem; }
  .t-sub .v { color: var(--danger); font-weight: 600; }
  .t-amt { font-weight: 600; font-size: 0.9rem; white-space: nowrap; }
</style>
