<script>
  const title = 'Dashboard';
</script>

<svelte:head><title>GerrioFin — Dashboard</title></svelte:head>

<section>
  <h1>{title}</h1>
  <p class="lead">Ringkasan saldo, arus kas, dan kartu kredit kamu.</p>

  <div class="grid">
    <div class="card">
      <span class="card-label">Total Saldo</span>
      <span class="card-value">—</span>
    </div>
    <div class="card">
      <span class="card-label">Pengeluaran Bulan Ini</span>
      <span class="card-value">—</span>
    </div>
  </div>

  <div class="card placeholder">
    <p>Belum ada data. Mulai dari <a href="/quick-capture" class="link">Quick Capture</a> untuk mencatat transaksi pertama.</p>
  </div>
</section>

<style>
  h1 { font-size: 1.5rem; font-weight: 700; margin: 0 0 0.25rem; }
  .lead { color: var(--text-muted); margin: 0 0 1rem; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.75rem; }
  .card-label { display: block; font-size: 0.8rem; color: var(--text-muted); }
  .card-value { display: block; font-size: 1.5rem; font-weight: 700; margin-top: 0.25rem; }
  .placeholder { color: var(--text-muted); }
  .link { color: var(--primary); }
</style>
