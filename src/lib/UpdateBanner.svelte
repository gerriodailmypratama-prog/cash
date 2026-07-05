<svelte:options runes={true} />

<script>
  // Notifikasi update untuk PWA: app yang dipasang di home screen (iOS/Android)
  // nggak punya tombol refresh browser, jadi app sendiri yang mantau versi baru
  // (SvelteKit polling _app/version.json tiap 60s — lihat svelte.config.js) dan
  // nawarin reload sekali tap. Service worker pakai skipWaiting + clients.claim,
  // jadi reload langsung dapet versi terbaru.
  import { onMount } from 'svelte';
  import { updated } from '$app/stores';
  import { beforeNavigate } from '$app/navigation';

  // Update pending + user pindah halaman -> jadikan full reload biar langsung fresh.
  beforeNavigate(({ willUnload, to }) => {
    if ($updated && !willUnload && to?.url) {
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

{#if $updated}
  <div class="update-wrap" role="alert" aria-live="polite">
    <button type="button" class="update-toast" onclick={() => location.reload()}>
      <span class="ut-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          <path d="M3 21v-5h5" />
        </svg>
      </span>
      <span class="ut-text">
        <strong>Versi baru Kas tersedia</strong>
        <small>Tap untuk update sekarang</small>
      </span>
      <span class="ut-cta">Update</span>
    </button>
  </div>
{/if}

<style>
  .update-wrap {
    position: fixed;
    left: 0;
    right: 0;
    /* nangkring di atas floating bottom-nav */
    bottom: calc(env(safe-area-inset-bottom, 0px) + 5.25rem);
    z-index: 40;
    display: flex;
    justify-content: center;
    padding: 0 1rem;
    pointer-events: none;
  }

  .update-toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 0.8rem;
    width: 100%;
    max-width: 480px;
    text-align: left;
    padding: 0.7rem 0.8rem 0.7rem 0.7rem;
    border-radius: 1rem;
    color: var(--text);
    background: rgba(26, 26, 32, 0.82);
    -webkit-backdrop-filter: blur(16px);
    backdrop-filter: blur(16px);
    border: 1px solid var(--primary);
    box-shadow:
      0 10px 30px rgba(0, 0, 0, 0.55),
      0 0 0 4px var(--primary-soft);
    cursor: pointer;
    animation:
      ut-in 0.42s cubic-bezier(0.16, 1, 0.3, 1),
      ut-glow 2.4s ease-in-out 0.5s infinite;
  }
  .update-toast:active { transform: scale(0.98); }

  .ut-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 0.75rem;
    color: var(--primary-contrast);
    background: var(--grad-primary);
    box-shadow: 0 4px 12px var(--primary-glow);
  }
  .ut-icon svg {
    width: 1.35rem;
    height: 1.35rem;
    animation: ut-spin 3.2s linear infinite;
  }

  .ut-text {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
    min-width: 0;
    flex: 1;
  }
  .ut-text strong { font-size: 0.9rem; font-weight: 650; }
  .ut-text small { font-size: 0.76rem; color: var(--text-muted); margin-top: 1px; }

  .ut-cta {
    flex: none;
    padding: 0.5rem 0.95rem;
    border-radius: 999px;
    font-size: 0.82rem;
    font-weight: 700;
    color: var(--primary-contrast);
    background: var(--grad-primary);
    box-shadow: 0 4px 12px var(--primary-glow);
  }

  @keyframes ut-in {
    from { opacity: 0; transform: translateY(120%); }
    to   { opacity: 1; transform: none; }
  }
  @keyframes ut-glow {
    0%, 100% { box-shadow: 0 10px 30px rgba(0,0,0,0.55), 0 0 0 4px var(--primary-soft); }
    50%      { box-shadow: 0 10px 34px rgba(0,0,0,0.55), 0 0 0 7px var(--primary-soft); }
  }
  @keyframes ut-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .update-toast { animation: ut-in 0.3s ease both; }
    .ut-icon svg { animation: none; }
  }
</style>
