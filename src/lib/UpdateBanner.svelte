<svelte:options runes={true} />

<script>
  // Banner update untuk PWA iOS: app yang dipasang di home screen nggak punya
  // tombol refresh, jadi app sendiri yang mantau versi baru (SvelteKit polling
  // _app/version.json — lihat svelte.config.js) dan nawarin reload sekali tap.
  import { onMount } from 'svelte';
  import { updated } from '$app/state';
  import { beforeNavigate } from '$app/navigation';

  // Update pending + user pindah halaman -> jadikan full reload biar langsung fresh.
  beforeNavigate(({ willUnload, to }) => {
    if (updated.current && !willUnload && to?.url) {
      location.href = to.url.href;
    }
  });

  onMount(() => {
    // iOS PWA nggak reload sendiri pas dibuka lagi dari background — cek manual.
    const onVisible = () => {
      if (document.visibilityState === 'visible') updated.check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });
</script>

{#if updated.current}
  <button type="button" class="update-banner" onclick={() => location.reload()}>
    Versi baru tersedia — tap untuk update
  </button>
{/if}

<style>
  .update-banner {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    /* nangkring di atas bottom-nav */
    bottom: calc(env(safe-area-inset-bottom, 0px) + 60px);
    z-index: 100;
    background: var(--surface-2, #1a1a1a);
    color: var(--text, #f3f3f3);
    border: 1px solid var(--primary, #4ade80);
    border-radius: 999px;
    padding: 0.7rem 1.1rem;
    font-size: 0.85rem;
    font-weight: 600;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
    cursor: pointer;
    white-space: nowrap;
    max-width: calc(100vw - 2rem);
  }
</style>
