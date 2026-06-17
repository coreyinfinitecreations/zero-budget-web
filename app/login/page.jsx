'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // If already signed in, go straight to the budget.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace('/budget');
    });
  }, [router]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!email || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (err) throw err;
        router.replace('/budget');
      } else {
        const { data, error: err } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (err) throw err;
        if (data.session) {
          router.replace('/budget');
        } else {
          setNotice('Check your email to confirm your account, then sign in.');
          setMode('signin');
        }
      }
    } catch (err) {
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-logo">
          <svg width="34" height="34" viewBox="0 0 32 32" fill="none">
            <rect x="3" y="14" width="26" height="9" rx="2.5" fill="#3d9140" />
            <rect x="3" y="9" width="26" height="9" rx="2.5" fill="#4caf50" />
            <rect x="3" y="4" width="26" height="9" rx="2.5" fill="#6cc24a" />
            <circle cx="16" cy="8.5" r="2.6" fill="#fff" opacity="0.9" />
          </svg>
          <span className="wordmark">Zero Budget</span>
        </div>
        <p className="sub">
          {mode === 'signin' ? 'Sign in to your budget' : 'Create your account'}
        </p>

        {error && <div className="error">{error}</div>}
        {notice && (
          <div className="error" style={{ background: '#eef9f0', color: '#3d9140' }}>
            {notice}
          </div>
        )}

        <input
          className="field"
          type="email"
          placeholder="Email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="field"
          type="password"
          placeholder="Password"
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button className="btn" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <p className="muted">
          {mode === 'signin' ? (
            <>
              Don&apos;t have an account?{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setMode('signup');
                  setError('');
                }}
              >
                Sign up
              </a>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setMode('signin');
                  setError('');
                }}
              >
                Sign in
              </a>
            </>
          )}
        </p>
      </form>
    </div>
  );
}
