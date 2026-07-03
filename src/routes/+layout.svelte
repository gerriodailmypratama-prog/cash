<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';

  let { children } = $props();

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
  });
</script>

<div class="app-shell">
  <header class="topbar">
    <a href="/" class="brand">GerrioFin</a>
  </header>

  <main class="content">
    {@render children()}
  </main>

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
</div>

<style>
  .app-shell {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  .topbar {
    position: sticky;
    top: 0;
    z-index: 10;
    display: flex;
    align-items: center;
    padding: 0.75rem 1rem;
    background-color: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    font-weight: 700;
    letter-spacing: 0.02em;
    color: var(--primary);
  }
  .content {
    flex: 1;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: 1rem;
    padding-bottom: 5rem;
  }
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
