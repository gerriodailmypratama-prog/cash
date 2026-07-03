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

  const nav = [
    { href: '/', label: 'Dashboard' },
    { href: '/quick-capture', label: 'Capture' },
    { href: '/transactions', label: 'Transaksi' },
    { href: '/accounts', label: 'Akun' },
    { href: '/credit-cards', label: 'Kartu' }
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
      <a href="/" class="brand">Kas</a>
      {#if session}
        <button class="logout" onclick={logout}>Keluar</button>
      {/if}
    </div>
    {#if session && pots.length}
      <div class="pot-bar">
        <button class="pot" class:active={$selectedPot === ''} onclick={() => selectedPot.set('')}>
          Semua
        </button>
        {#each pots as p}
          <button class="pot" class:active={$selectedPot === p.id} onclick={() => selectedPot.set(p.id)}>
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
        >
          {item.label}
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
  .header {
    position: sticky;
    top: 0;
    z-index: 10;
    background-color: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
  }
  .pot-bar {
    display: flex;
    gap: 0.4rem;
    padding: 0 1rem 0.6rem;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .pot-bar::-webkit-scrollbar { display: none; }
  .pot {
    flex: 0 0 auto;
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.25rem 0.75rem;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .pot.active {
    color: var(--primary-contrast);
    background: var(--primary);
    border-color: var(--primary);
  }
  .brand {
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--primary);
  }
  .logout {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.25rem 0.7rem;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .logout:hover { color: var(--text); border-color: var(--text-dim); }
  .content {
    flex: 1;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: 1rem;
    padding-bottom: 5rem;
  }
  .guard { color: var(--text-muted); }
  .guard p { margin: 0; }
  .bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    background-color: var(--surface);
    border-top: 1px solid var(--border);
  }
  .nav-item {
    text-align: center;
    padding: 0.75rem 0.25rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    border-top: 2px solid transparent;
  }
  .nav-item.active {
    color: var(--primary);
    border-top-color: var(--primary);
  }
</style>
