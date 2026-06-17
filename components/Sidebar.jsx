'use client';

import { useRouter } from 'next/navigation';

function LogoMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className="mark">
      <rect x="3" y="14" width="26" height="9" rx="2.5" fill="#3d9140" />
      <rect x="3" y="9" width="26" height="9" rx="2.5" fill="#4caf50" />
      <rect x="3" y="4" width="26" height="9" rx="2.5" fill="#6cc24a" />
      <circle cx="16" cy="8.5" r="2.6" fill="#fff" opacity="0.9" />
    </svg>
  );
}

function BudgetIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 4v16" />
    </svg>
  );
}

function AccountsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

export default function Sidebar({ active, email, onSignOut }) {
  const router = useRouter();
  const initials = (email || '?').slice(0, 2).toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <LogoMark />
        <span className="wordmark">Zero Budget</span>
      </div>

      <nav className="nav">
        <button className={`nav-item ${active === 'budget' ? 'active' : ''}`} onClick={() => router.push('/budget')}>
          <BudgetIcon />
          Budget
        </button>
        <button className={`nav-item ${active === 'accounts' ? 'active' : ''}`} onClick={() => router.push('/accounts')}>
          <AccountsIcon />
          Accounts
        </button>
      </nav>

      <div className="sidebar-foot">
        <div className="avatar">{initials}</div>
        <div className="who">
          <div className="email" title={email}>
            {email}
          </div>
          <button className="signout" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </div>
    </aside>
  );
}
