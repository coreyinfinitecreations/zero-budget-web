import { createClient } from '@supabase/supabase-js';

// Browser Supabase client. Session is persisted in localStorage so the user
// stays signed in across reloads. The publishable key is meant to ship in the
// client; per-user data access is enforced by the API (not by hiding this key).
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  }
);
