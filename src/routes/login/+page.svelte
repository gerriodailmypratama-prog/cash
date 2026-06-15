<script>
  import { supabase } from '$lib/supabase';
  import { goto } from '$app/navigation';

  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let errorMsg = $state('');

  async function handleLogin(e) {
    e.preventDefault();
    errorMsg = '';
    loading = true;
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    loading = false;
    if (error) {
      errorMsg = error.message;
      return;
    }
    goto('/');
  }
</script>

<svelte:head><title>GerrioFin — Masuk</title></svelte:head>

<section class="wrap">
  <div class="card login-card">
    <h1>Masuk</h1>
    <p class="lead">Gunakan akun GerrioFin kamu.</p>

    <form onsubmit={handleLogin}>
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="email" bind:value={email} required />

      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password" bind:value={password} required />

      {#if errorMsg}
        <p class="error">{errorMsg}</p>
      {/if}

      <button class="btn-primary" type="submit" disabled={loading}>
        {loading ? 'Memproses…' : 'Masuk'}
      </button>
    </form>
  </div>
</section>

<style>
  .wrap { display: flex; justify-content: center; padding-top: 2rem; }
  .login-card { width: 100%; max-width: 360px; }
  h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.25rem; }
  .lead { color: var(--text-muted); margin: 0 0 1rem; }
  form { display: flex; flex-direction: column; gap: 0.5rem; }
  label { font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem; }
  input { padding: 0.5rem 0.75rem; }
  .btn-primary { margin-top: 1rem; }
  .error { color: var(--danger); background: var(--danger-bg); border-radius: var(--radius-sm); padding: 0.5rem 0.75rem; font-size: 0.85rem; }
</style>
