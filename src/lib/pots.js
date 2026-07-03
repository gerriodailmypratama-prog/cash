// Selected POT (entity) — shared across pages, persisted per device.
// '' means "Semua" (all pots).
import { writable } from 'svelte/store';

const KEY = 'kas_pot';

function initial() {
  try {
    return localStorage.getItem(KEY) || '';
  } catch (e) {
    return ''; // SSR / storage unavailable
  }
}

export const selectedPot = writable(initial());

selectedPot.subscribe((v) => {
  try {
    localStorage.setItem(KEY, v);
  } catch (e) { /* ignore */ }
});
