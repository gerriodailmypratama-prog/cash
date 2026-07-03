// Shared formatting helpers (Kas).

/** Format a number as Indonesian Rupiah without the "Rp" prefix (caller adds it). */
export function rupiah(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(v);
}

/** "1000 · Cash & Bank" style label for an account-ish row (code optional). */
export function accountLabel(a) {
  if (!a) return '—';
  return (a.code ? a.code + ' · ' : '') + (a.name ?? '');
}

/** Local YYYY-MM-DD for a Date (avoids UTC off-by-one from toISOString). */
export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** First and last day (YYYY-MM-DD) of the month containing `ref` (default: today). */
export function monthRange(ref = new Date()) {
  const first = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const last = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return { first: ymd(first), last: ymd(last) };
}
