import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

let _client = null;

export function getSupabase() {
  if (!url || !anonKey) {
    console.warn('[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
    throw new Error('Supabase belum dikonfigurasi (env vars belum di-set).');
  }
  if (!_client) {
    _client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
  }
  return _client;
}

// Lazy proxy: keeps `import { supabase }` working without creating the client at module load.
// The real client is only instantiated when a property is accessed at runtime.
export const supabase = new Proxy({}, {
  get(_target, prop) {
    const client = getSupabase();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  }
});
