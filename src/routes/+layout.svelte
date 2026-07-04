<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { getSupabase, isSupabaseConfigured } from '$lib/supabase';
  import { selectedPot } from '$lib/pots';

  let { children } = $props();

  // undefined = still checking, null = logged out, object = logged in
  let session = $state(undefined);
  let pots = $state([]);

  async function loadPots() {
    const { data } = await getSupabase()
      .from('entities_active')
      .select('id, name, kind')
      .order('name');
    pots = data || [];
    // stale selection (deleted pot) -> back to Semua
    if ($selectedPot && !pots.some((p) => p.id === $selectedPot)) selectedPot.set('');
  }

  // inline SVG paths (24x24, stroke) — no icon lib needed
  const nav = [
    { href: '/', label: 'Home',
      d: 'M3 10.5 12 3l9 7.5M5 9.5V21h5v-6h4v6h5V9.5' },
    { href: '/quick-capture', label: 'Catat',
      d: 'M12 5v14M5 12h14' },
    { href: '/transactions', label: 'Transaksi',
      d: 'M4 7h13M13 3l4 4-4 4M20 17H7M11 13l-4 4 4 4' },
    { href: '/accounts', label: 'Akun',
      d: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm0 3h18M16.5 14.5h.01' },
    { href: '/credit-cards', label: 'Kartu',
      d: 'M2.5 8.5h19M2.5 7A1.5 1.5 0 0 1 4 5.5h16A1.5 1.5 0 0 1 21.5 7v10a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 17V7Zm3 7.5H10' }
  ];

  function isActive(href, current) {
    return href === '/' ? current === '/' : current.startsWith(href);
  }

  onMount(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js').catch((err) => {
        console.warn('[sw] registration failed', err);
      });
    }

    if (!isSupabaseConfigured) {
      session = null;
      return;
    }
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      session = data.session;
      if (data.session) loadPots();
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      const hadSession = !!session;
      session = s;
      if (s && !hadSession) loadPots();
    });
    return () => sub.subscription.unsubscribe();
  });

  // Route guard: app pages need a session; /login bounces logged-in users home.
  $effect(() => {
    const path = $page.url.pathname;
    if (session === null && path !== '/login') goto('/login');
    if (session && path === '/login') goto('/');
  });

  async function logout() {
    try {
      await getSupabase().auth.signOut();
    } catch (e) {
      console.warn('[auth] signOut failed', e);
    }
  }
</script>

<div class="app-shell">
  <header class="header">
    <div class="topbar">
      <a href="/" class="brand">
        <span class="brand-mark"></span>
        <span class="brand-name text-grad">Kas</span>
      </a>
      {#if session}
        <button class="logout btn-ghost" onclick={logout}>Keluar</button>
      {/if}
    </div>
    {#if session && pots.length}
      <div class="pot-bar">
        <button class="chip" class:on={$selectedPot === ''} onclick={() => selectedPot.set('')}>
          Semua
        </button>
        {#each pots as p}
          <button class="chip" class:on={$selectedPot === p.id} onclick={() => selectedPot.set(p.id)}>
            {p.name}
          </button>
        {/each}
      </div>
    {/if}
  </header>

  <main class="content">
    {#if $page.url.pathname === '/login' || session}
      {@render children()}
    {:else}
      <div class="card guard"><p>Memeriksa sesi…</p></div>
    {/if}
  </main>

  {#if session}
    <nav class="bottom-nav">
      {#each nav as item}
        <a
          href={item.href}
          class="nav-item"
          class:active={isActive(item.href, $page.url.pathname)}
          aria-label={item.label}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d={item.d} />
          </svg>
          <span>{item.label}</span>
        </a>
      {/each}
    </nav>
  {/if}
</div>

<style>
  .app-shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  /* ---- glass header ---- */
  .header {
    position: sticky;
    top: 0;
    z-index: 20;
    background: rgba(8, 8, 11, 0.72);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--border);
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 1rem;
    max-width: 720px;
    margin: 0 auto;
    width: 100%;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .brand-mark {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    background: var(--grad-primary);
    box-shadow: 0 0 12px var(--primary-glow);
    transform: rotate(45deg);
  }
  .brand-name {
    font-weight: 800;
    font-size: 1.15rem;
    letter-spacing: 0.02em;
  }
  .logout {
    padding: 0.3rem 0.8rem;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .pot-bar {
    display: flex;
    gap: 0.4rem;
    padding: 0 1rem 0.65rem;
    overflow-x: auto;
    scrollbar-width: none;
    max-width: 720px;
    margin: 0 auto;
    width: 100%;
  }
  .pot-bar::-webkit-scrollbar { display: none; }

  /* ---- content ---- */
  .content {
    flex: 1;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: 1.1rem 1rem;
    padding-bottom: 6.5rem;
  }
  .guard { color: var(--text-muted); }
  .guard p { margin: 0; }

  /* ---- floating glass bottom nav ---- */
  .bottom-nav {
    position: fixed;
    bottom: calc(0.75rem + env(safe-area-inset-bottom, 0px));
    left: 50%;
    transform: translateX(-50%);
    width: min(720px - 1.5rem, calc(100% - 1.5rem));
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.15rem;
    padding: 0.4rem;
    background: rgba(16, 16, 21, 0.82);
    -webkit-backdrop-filter: blur(18px);
    backdrop-filter: blur(18px);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
    z-index: 20;
  }
  .nav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.18rem;
    padding: 0.45rem 0.2rem 0.35rem;
    border-radius: calc(var(--radius-lg) - 6px);
    color: var(--text-dim);
    font-size: 0.62rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    transition: color 0.18s ease, background-color 0.18s ease, transform 0.18s ease;
  }
  .nav-item svg { width: 21px; height: 21px; }
  .nav-item:hover { color: var(--text-muted); }
  .nav-item:active { transform: scale(0.95); }
  .nav-item.active {
    color: var(--primary);
    background: var(--primary-soft);
  }
</style>
