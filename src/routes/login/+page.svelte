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
    const { error } = await getSupabase().auth.signInWithPassword({ email, password });
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
