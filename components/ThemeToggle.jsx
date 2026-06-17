'use client';

import { useEffect, useState } from 'react';

const OPTIONS = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

function applyTheme(theme) {
  const el = document.documentElement;
  if (theme === 'light' || theme === 'dark') el.dataset.theme = theme;
  else delete el.dataset.theme; // 'system' → follow prefers-color-scheme
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState('system');

  useEffect(() => {
    let saved = 'system';
    try {
      saved = localStorage.getItem('zb-theme') || 'system';
    } catch (e) {}
    setTheme(saved);
  }, []);

  const choose = (id) => {
    setTheme(id);
    try {
      localStorage.setItem('zb-theme', id);
    } catch (e) {}
    applyTheme(id);
  };

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          className={`theme-opt ${theme === o.id ? 'active' : ''}`}
          onClick={() => choose(o.id)}
          aria-pressed={theme === o.id}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
