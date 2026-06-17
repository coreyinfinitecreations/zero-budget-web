'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { stateApi } from '../../lib/api';
import {
  DEFAULT_CATEGORIES,
  computeTotals,
  formatMoney,
  formatMonthLabel,
  getMonthKey,
  latestMonthBefore,
  newId,
  shiftMonth,
} from '../../lib/budget';

// Stacked-bills logo mark (EveryDollar-style).
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

// Derive the categories to show for a month: its saved budget, else carry the
// most recent prior month forward (spent reset), else the default template.
function deriveCategories(budgets, month) {
  if (budgets?.[month]) return budgets[month];
  const prevKey = latestMonthBefore(budgets, month);
  const source = prevKey ? budgets[prevKey] : DEFAULT_CATEGORIES;
  return source.map((cat) => ({
    ...cat,
    items: (cat.items || []).map((i) => ({ ...i, spent: 0 })),
  }));
}

export default function BudgetPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [doc, setDoc] = useState({ budgets: {}, goals: [] });
  const [currentMonth, setCurrentMonth] = useState(getMonthKey(new Date()));
  const [saveState, setSaveState] = useState('saved'); // 'saved' | 'saving' | 'error'
  const loadedRef = useRef(false);

  // ── Auth + initial load ────────────────────────────────────────────────────
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
      try {
        const { data: remote } = await stateApi.get();
        if (active) {
          setDoc({
            budgets: remote?.budgets || {},
            goals: remote?.goals || [],
            transactions: remote?.transactions || [],
            userName: remote?.userName || '',
            showPercentages: remote?.showPercentages ?? true,
          });
        }
      } catch (e) {
        console.warn('Load failed:', e.message);
      } finally {
        if (active) {
          loadedRef.current = true;
          setReady(true);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  // ── Debounced cloud save whenever the document changes ──────────────────────
  useEffect(() => {
    if (!loadedRef.current) return;
    setSaveState('saving');
    const handle = setTimeout(() => {
      stateApi
        .save(doc)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 800);
    return () => clearTimeout(handle);
  }, [doc]);

  const categories = doc.budgets?.[currentMonth] || deriveCategories(doc.budgets, currentMonth);
  const totals = useMemo(() => computeTotals(categories, doc.goals), [categories, doc.goals]);

  // Write an update to the current month's categories (materializing the month).
  const setCategories = useCallback(
    (updater) => {
      setDoc((prev) => {
        const budgets = { ...(prev.budgets || {}) };
        const current = budgets[currentMonth] || deriveCategories(prev.budgets, currentMonth);
        budgets[currentMonth] = typeof updater === 'function' ? updater(current) : updater;
        return { ...prev, budgets };
      });
    },
    [currentMonth]
  );

  // ── Mutations ───────────────────────────────────────────────────────────────
  const updateItem = (catId, itemId, field, value) =>
    setCategories((cats) =>
      cats.map((c) =>
        c.id === catId
          ? {
              ...c,
              items: c.items.map((i) =>
                i.id === itemId ? { ...i, [field]: value } : i
              ),
            }
          : c
      )
    );

  const addItem = (catId) =>
    setCategories((cats) =>
      cats.map((c) =>
        c.id === catId
          ? { ...c, items: [...c.items, { id: newId(), name: '', planned: 0, spent: 0 }] }
          : c
      )
    );

  const deleteItem = (catId, itemId) =>
    setCategories((cats) =>
      cats.map((c) =>
        c.id === catId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c
      )
    );

  const renameCategory = (catId, name) =>
    setCategories((cats) => cats.map((c) => (c.id === catId ? { ...c, name } : c)));

  const deleteCategory = (catId) =>
    setCategories((cats) => cats.filter((c) => c.id !== catId));

  const addCategory = () => {
    const name = window.prompt('New group name');
    if (!name || !name.trim()) return;
    setCategories((cats) => [
      ...cats,
      { id: newId('cat'), name: name.trim(), type: 'expense', targetPercent: 5, items: [] },
    ]);
  };

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  if (!ready) return <div className="center-note">Loading your budget…</div>;

  const incomeCats = categories.filter((c) => c.type === 'income');
  const expenseCats = categories.filter((c) => c.type === 'expense');
  const initials = (email || '?').slice(0, 2).toUpperCase();
  const [monthName, yearNum] = formatMonthLabel(currentMonth).split(' ');

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <LogoMark />
          <span className="wordmark">Zero Budget</span>
        </div>

        <nav className="nav">
          <button className="nav-item active">
            <BudgetIcon />
            Budget
          </button>
        </nav>

        <div className="sidebar-foot">
          <div className="avatar">{initials}</div>
          <div className="who">
            <div className="email" title={email}>
              {email}
            </div>
            <button className="signout" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="content">
          <div className="month-head">
            <div>
              <h1 className="month-title">
                <strong>{monthName}</strong> {yearNum}
              </h1>
              <div className="left-to-budget">
                <span className={`amt ${totals.remaining < 0 ? 'neg' : 'pos'}`}>
                  {formatMoney(totals.remaining)}
                </span>{' '}
                left to budget
              </div>
            </div>
            <div className="month-nav">
              <button className="navbtn" onClick={() => setCurrentMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
                ‹
              </button>
              <button className="navbtn" onClick={() => setCurrentMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
                ›
              </button>
            </div>
          </div>

          {[...incomeCats, ...expenseCats].map((cat) => (
            <GroupCard
              key={cat.id}
              cat={cat}
              onRename={(name) => renameCategory(cat.id, name)}
              onDelete={() => deleteCategory(cat.id)}
              onAddItem={() => addItem(cat.id)}
              onUpdateItem={(itemId, field, value) => updateItem(cat.id, itemId, field, value)}
              onDeleteItem={(itemId) => deleteItem(cat.id, itemId)}
            />
          ))}

          <button className="btn ghost" onClick={addCategory}>
            + Add group
          </button>
        </div>
      </main>
    </div>
  );
}

function GroupCard({ cat, onRename, onDelete, onAddItem, onUpdateItem, onDeleteItem }) {
  const [open, setOpen] = useState(true);
  const isIncome = cat.type === 'income';
  const middleLabel = isIncome ? 'Received' : 'Spent';

  const totals = (cat.items || []).reduce(
    (acc, i) => {
      acc.planned += Number(i.planned) || 0;
      acc.spent += Number(i.spent) || 0;
      return acc;
    },
    { planned: 0, spent: 0 }
  );
  const totalRemaining = totals.planned - totals.spent;

  return (
    <div className="group">
      <div className="group-head">
        <div className="group-name">
          <button className="chev" onClick={() => setOpen((o) => !o)} aria-label={open ? 'Collapse' : 'Expand'}>
            {open ? '▾' : '▸'}
          </button>
          <input value={cat.name} onChange={(e) => onRename(e.target.value)} />
          {cat.id !== 'income' && (
            <button className="del" onClick={onDelete} title="Delete group">
              ×
            </button>
          )}
        </div>
        <span className="col-head">Planned</span>
        <span className="col-head">{middleLabel}</span>
        <span className="col-head">Remaining</span>
        <span />
      </div>

      {open &&
        cat.items.map((item) => {
          const remaining = (Number(item.planned) || 0) - (Number(item.spent) || 0);
          return (
            <div className="line" key={item.id}>
              <input
                className="name"
                placeholder="Add item name"
                value={item.name}
                onChange={(e) => onUpdateItem(item.id, 'name', e.target.value)}
              />
              <input
                className="money"
                type="number"
                inputMode="decimal"
                value={item.planned ?? 0}
                onChange={(e) => onUpdateItem(item.id, 'planned', Number(e.target.value) || 0)}
              />
              <input
                className="money"
                type="number"
                inputMode="decimal"
                value={item.spent ?? 0}
                onChange={(e) => onUpdateItem(item.id, 'spent', Number(e.target.value) || 0)}
              />
              <span className={`remaining ${remaining < 0 ? 'neg' : ''}`}>
                {formatMoney(remaining)}
              </span>
              <button className="del" onClick={() => onDeleteItem(item.id)} title="Remove">
                ×
              </button>
            </div>
          );
        })}

      {open && (
        <div className="group-foot">
          <button className="add-line" onClick={onAddItem}>
            + {isIncome ? 'Add income' : 'Add item'}
          </button>
          <span className="foot-total">{formatMoney(totals.planned)}</span>
          <span className="foot-total">{formatMoney(totals.spent)}</span>
          <span className="foot-total pad">{formatMoney(totalRemaining)}</span>
          <span />
        </div>
      )}
    </div>
  );
}
