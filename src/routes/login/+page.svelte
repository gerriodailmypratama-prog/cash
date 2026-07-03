<script>
  import { getSupabase } from '$lib/supabase';
  import { goto } from '$app/navigation';

  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let errorMsg = $state('');

  async function handleLogin(e) {
    e.preventDefault();
    errorMsg = '';
    loading = true;
    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email, password });
      if (error) {
        errorMsg = error.message;
        return;
      }
      goto('/');
    } catch (err) {
      errorMsg = err.message ?? 'Gagal masuk.';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head><title>Kas — Masuk</title></svelte:head>

<section class="wrap">
  <div class="card login-card">
    <h1>Masuk</h1>
    <p class="lead">Gunakan akun Kas kamu.</p>

    <form onsubmit={handleLogin}>
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="email" bind:value={email} required />

      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password" bind:value={password} required />

      {#if errorMsg}
        <p class="error">{errorMsg}</p>
      {/if}

      <button class="btn-primary" type="submit" disabled={loading}>
        {loading ? 'Memuat…' : 'Masuk'}
      </button>
    </form>
  </div>
</section>

<style>
  .wrap {
    display: flex;
    justify-content: center;
    padding: 3rem 1rem;
  }
  .login-card {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  h1 { margin: 0; font-size: 1.5rem; }
  .lead { margin: 0 0 0.5rem; color: var(--text-muted); }
  label { font-size: 0.85rem; color: var(--text-muted); }
  input {
    width: 100%;
    padding: 0.6rem 0.75rem;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface-2);
    color: var(--text);
  }
  .error { color: var(--danger, #f87171); font-size: 0.85rem; margin: 0; }
</style>
