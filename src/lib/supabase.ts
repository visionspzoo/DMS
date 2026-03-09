import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: 'implicit',
    detectSessionInUrl: true,
    autoRefreshToken: true,
    persistSession: true,
  },
});

export async function getValidSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) throw new Error('Brak aktywnej sesji - zaloguj się ponownie');

  const expiresAt = session.expires_at ?? 0;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const REFRESH_THRESHOLD = 300;

  if (expiresAt - nowSeconds < REFRESH_THRESHOLD) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    if (refreshed.session) return refreshed.session;
  }

  return session;
}
