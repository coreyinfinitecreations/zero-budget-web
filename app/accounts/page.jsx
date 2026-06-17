'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePlaidLink } from 'react-plaid-link';
import { supabase } from '../../lib/supabase';
import { accountsApi, manualAccountsApi, plaidApi } from '../../lib/api';
import { formatMoneyCents } from '../../lib/budget';
import Sidebar from '../../components/Sidebar';

// Renders nothing visible — when given a link token it opens Plaid Link
// automatically and reports success/exit back to the parent.
function PlaidLauncher({ token, onSuccess, onExit }) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken, metadata) => onSuccess(publicToken, metadata),
    onExit: () => onExit(),
  });

  useEffect(() => {
    if (token && ready) open();
  }, [token, ready, open]);

  return null;
}

export default function AccountsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [connected, setConnected] = useState([]);
  const [manual, setManual] = useState([]);
  const [linkToken, setLinkToken] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  // Manual-account form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'checking', balance: '' });

  const loadAccounts = useCallback(async () => {
    try {
      const [c, m] = await Promise.all([accountsApi.list(), manualAccountsApi.list()]);
      setConnected(c?.accounts || []);
      setManual(m?.accounts || []);
    } catch (e) {
      console.warn('Load accounts failed:', e.message);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace('/login');
        return;
      }
      if (!active) return;
      setEmail(data.session.user?.email || '');
      await loadAccounts();
      if (active) setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [router, loadAccounts]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  // Step 1 — fetch a link token; PlaidLauncher then opens Plaid Link.
  async function connectBank() {
    setStatus('');
    setBusy(true);
    try {
      const { link_token } = await plaidApi.createLinkToken();
      setLinkToken(link_token);
    } catch (e) {
      setStatus(`Could not start bank connection: ${e.message}`);
      setBusy(false);
    }
  }

  // Step 2 — exchange the public token (server stores the accounts), then sync.
  const onPlaidSuccess = useCallback(
    async (publicToken, metadata) => {
      setLinkToken(null);
      try {
        const inst = metadata?.institution?.name;
        const { accounts } = await plaidApi.exchangePublicToken(publicToken, inst);
        await loadAccounts();
        setStatus(`Connected ${accounts?.length || 0} account(s)${inst ? ` from ${inst}` : ''}. Syncing transactions…`);
        try {
          const { synced } = await plaidApi.syncTransactions();
          setStatus(`Connected ${accounts?.length || 0} account(s). Synced ${synced || 0} transaction(s).`);
        } catch (e) {
          setStatus(`Connected, but transaction sync failed: ${e.message}`);
        }
      } catch (e) {
        setStatus(`Connection failed: ${e.message}`);
      } finally {
        setBusy(false);
      }
    },
    [loadAccounts]
  );

  const onPlaidExit = useCallback(() => {
    setLinkToken(null);
    setBusy(false);
  }, []);

  async function removeConnected(id) {
    if (!window.confirm('Disconnect this account? Its stored data will be removed.')) return;
    await accountsApi.remove(id);
    loadAccounts();
  }

  async function addManual(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await manualAccountsApi.upsert({
      name: form.name.trim(),
      type: form.type,
      balance: Number(form.balance) || 0,
    });
    setForm({ name: '', type: 'checking', balance: '' });
    setShowForm(false);
    loadAccounts();
  }

  async function removeManual(id) {
    if (!window.confirm('Remove this manual account?')) return;
    await manualAccountsApi.remove(id);
    loadAccounts();
  }

  if (!ready) return <div className="center-note">Loading your accounts…</div>;

  const totalBalance =
    connected.reduce((s, a) => s + (Number(a.balance) || 0), 0) +
    manual.reduce((s, a) => s + (Number(a.balance) || 0), 0);

  return (
    <div className="app-shell">
      <Sidebar active="accounts" email={email} onSignOut={signOut} />

      {linkToken && <PlaidLauncher token={linkToken} onSuccess={onPlaidSuccess} onExit={onPlaidExit} />}

      <main className="main">
        <div className="content">
          <div className="month-head">
            <div>
              <h1 className="month-title">
                <strong>Accounts</strong>
              </h1>
              <div className="left-to-budget">
                <span className="amt pos">{formatMoneyCents(totalBalance)}</span> total balance
              </div>
            </div>
            <button className="btn" onClick={connectBank} disabled={busy}>
              {busy ? 'Connecting…' : '+ Connect a bank'}
            </button>
          </div>

          {status && <div className="acct-status">{status}</div>}

          <div className="acct-section">
            <div className="acct-section-head">
              <span>Connected banks</span>
            </div>
            <div className="group">
              {connected.length === 0 ? (
                <div className="acct-empty">
                  No banks connected yet. Click “Connect a bank” to link an account through Plaid and
                  sync transactions automatically.
                </div>
              ) : (
                connected.map((a) => (
                  <div className="acct-row" key={a.id}>
                    <div className="acct-mark bank">{(a.institution || a.name || '?').slice(0, 1).toUpperCase()}</div>
                    <div className="acct-mid">
                      <div className="acct-name">{a.name}</div>
                      <div className="acct-sub">
                        {[a.institution, a.subtype || a.type, a.mask ? `••${a.mask}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </div>
                    <div className="acct-right">
                      <span className="acct-bal">{formatMoneyCents(a.balance)}</span>
                      <button className="txunassign" onClick={() => removeConnected(a.id)}>
                        Disconnect
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="acct-section">
            <div className="acct-section-head">
              <span>Manual accounts</span>
              <button className="add-line" onClick={() => setShowForm((s) => !s)}>
                {showForm ? 'Cancel' : '+ Add manual account'}
              </button>
            </div>

            {showForm && (
              <form className="group acct-form" onSubmit={addManual}>
                <input
                  className="field"
                  placeholder="Account name (e.g. Cash, Savings)"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                <div className="acct-form-row">
                  <select
                    className="field"
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                  >
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                    <option value="cash">Cash</option>
                    <option value="credit">Credit</option>
                    <option value="investment">Investment</option>
                  </select>
                  <input
                    className="field"
                    type="number"
                    inputMode="decimal"
                    placeholder="Balance"
                    value={form.balance}
                    onChange={(e) => setForm((f) => ({ ...f, balance: e.target.value }))}
                  />
                  <button className="btn" type="submit">
                    Add
                  </button>
                </div>
              </form>
            )}

            <div className="group">
              {manual.length === 0 ? (
                <div className="acct-empty">No manual accounts. Add cash, savings, or any account you track by hand.</div>
              ) : (
                manual.map((a) => (
                  <div className="acct-row" key={a.id}>
                    <div className="acct-mark manual">{(a.name || '?').slice(0, 1).toUpperCase()}</div>
                    <div className="acct-mid">
                      <div className="acct-name">{a.name}</div>
                      <div className="acct-sub">{a.type || 'Manual'}</div>
                    </div>
                    <div className="acct-right">
                      <span className="acct-bal">{formatMoneyCents(a.balance)}</span>
                      <button className="txunassign" onClick={() => removeManual(a.id)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
