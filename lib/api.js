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

// ── Plaid (server-side endpoints keep Plaid secrets off the client) ──────────
export const plaidApi = {
  createLinkToken: () => request('/api/plaid/link-token', { method: 'POST' }),
  exchangePublicToken: (publicToken, institutionName) =>
    request('/api/plaid/exchange', {
      method: 'POST',
      body: { publicToken, institutionName },
    }),
  refreshBalances: () => request('/api/plaid/refresh', { method: 'POST' }),
  syncTransactions: (startDate, endDate) =>
    request('/api/plaid/transactions', {
      method: 'POST',
      body: { startDate, endDate },
    }),
};

// ── Connected (Plaid) accounts — access_token is never returned ──────────────
export const accountsApi = {
  list: () => request('/api/accounts'),
  remove: (id) => request(`/api/accounts?id=${id}`, { method: 'DELETE' }),
};

// ── Manual accounts ──────────────────────────────────────────────────────────
export const manualAccountsApi = {
  list: () => request('/api/manual-accounts'),
  upsert: (account) => request('/api/manual-accounts', { method: 'POST', body: account }),
  remove: (id) => request(`/api/manual-accounts?id=${id}`, { method: 'DELETE' }),
};

// ── Transactions (Plaid-synced + manual, stored server-side) ─────────────────
export const transactionsApi = {
  list: ({ accountId, month, limit, offset } = {}) => {
    const params = new URLSearchParams();
    if (accountId) params.set('account_id', accountId);
    if (month) params.set('month', month);
    if (limit) params.set('limit', String(limit));
    if (offset) params.set('offset', String(offset));
    const qs = params.toString();
    return request(`/api/transactions${qs ? `?${qs}` : ''}`);
  },
  upsert: (transactions) => request('/api/transactions', { method: 'POST', body: transactions }),
  remove: (id) => request(`/api/transactions?id=${id}`, { method: 'DELETE' }),
};
