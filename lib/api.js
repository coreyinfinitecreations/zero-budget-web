import { supabase } from './supabase';

const BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'https://zero-budget-api.vercel.app';

async function request(path, options = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
      ...(options.headers || {}),
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

// Per-user app state document (budgets / goals / prefs) — same store the app uses.
export const stateApi = {
  get: () => request('/api/state'),
  save: (data) => request('/api/state', { method: 'POST', body: { data } }),
};
