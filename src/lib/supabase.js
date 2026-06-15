import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

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

export const isSupabaseConfigured = Boolean(url && anonKey);
