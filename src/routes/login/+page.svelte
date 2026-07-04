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
  <div class="card-glass login-card">
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"></span>
      <span class="brand-name text-grad">Kas</span>
    </div>

    <h1>Masuk</h1>
    <p class="lead">Gunakan akun Kas kamu.</p>

    <form onsubmit={handleLogin}>
      <label for="email">Email</label>
      <input id="email" type="email" autocomplete="email" bind:value={email} required />

      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password" bind:value={password} required />

      {#if errorMsg}
        <p class="badge badge-danger error">{errorMsg}</p>
      {/if}

      <button class="btn-primary submit" type="submit" disabled={loading}>
        {loading ? 'Memuat…' : 'Masuk'}
      </button>
    </form>
  </div>
</section>

<style>
  .wrap {
    min-height: calc(100dvh - 12rem);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem 0;
  }
  .login-card {
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 1.5rem 1.35rem;
  }
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.65rem;
    margin-bottom: 0.9rem;
  }
  .brand-mark {
    width: 14px;
    height: 14px;
    border-radius: 4px;
    background: var(--grad-primary);
    box-shadow: 0 0 14px var(--primary-glow);
    transform: rotate(45deg);
  }
  .brand-name {
    font-weight: 800;
    font-size: 1.6rem;
    letter-spacing: 0.02em;
    line-height: 1;
  }
  h1 {
    margin: 0;
    font-size: 1.45rem;
    font-weight: 700;
  }
  .lead {
    margin: 0.15rem 0 1rem;
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  label {
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--text-muted);
    margin-top: 0.35rem;
  }
  input {
    width: 100%;
    min-height: 44px;
    padding: 0.6rem 0.8rem;
    font-size: 0.95rem;
  }
  .error {
    margin: 0.5rem 0 0;
    align-self: flex-start;
    white-space: normal;
    line-height: 1.4;
  }
  .submit {
    width: 100%;
    min-height: 46px;
    margin-top: 0.85rem;
    font-size: 0.95rem;
  }
</style>
