import { createClient } from '@supabase/supabase-js';

/** Supabase as nobody in particular, for endpoints that check a key or token themselves. Null when Supabase isn't set up. */
export function anonSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
