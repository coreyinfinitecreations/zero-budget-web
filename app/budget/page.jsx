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
    const name = window.prompt('New category name');
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

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">Zero Budget</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="save-state">
              {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'All changes saved'}
            </span>
            <button className="btn link" onClick={signOut} title={email}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="container">
        <div className="monthbar">
          <button className="iconbtn" onClick={() => setCurrentMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
            ‹
          </button>
          <h2>{formatMonthLabel(currentMonth)}</h2>
          <button className="iconbtn" onClick={() => setCurrentMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
            ›
          </button>
        </div>

        <section className="summary">
          <div className="stat">
            <div className="label">Planned income</div>
            <div className="value pos">{formatMoney(totals.plannedIncome)}</div>
          </div>
          <div className="stat">
            <div className="label">Planned expenses</div>
            <div className="value">{formatMoney(totals.plannedExpenses)}</div>
          </div>
          <div className="stat">
            <div className="label">Left to budget</div>
            <div className={`value ${totals.remaining < 0 ? 'neg' : 'pos'}`}>
              {formatMoney(totals.remaining)}
            </div>
          </div>
        </section>

        {[...incomeCats, ...expenseCats].map((cat) => (
          <CategoryCard
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
          + Add category
        </button>
        <div style={{ height: 40 }} />
      </main>
    </>
  );
}

function CategoryCard({ cat, onRename, onDelete, onAddItem, onUpdateItem, onDeleteItem }) {
  const isIncome = cat.type === 'income';
  return (
    <div className="cat">
      <div className="cat-head">
        <input
          className="cat-name"
          value={cat.name}
          onChange={(e) => onRename(e.target.value)}
        />
        <span className={`pill ${isIncome ? '' : 'expense'}`}>{isIncome ? 'Income' : 'Expense'}</span>
        {cat.id !== 'income' && (
          <button className="del" onClick={onDelete} title="Delete category">
            ×
          </button>
        )}
      </div>

      {cat.items.length > 0 && (
        <div className="row" style={{ paddingTop: 6, paddingBottom: 6 }}>
          <span className="col-head" style={{ textAlign: 'left' }}>
            Item
          </span>
          <span className="col-head">Planned</span>
          <span className="col-head">{isIncome ? 'Received' : 'Spent'}</span>
          <span />
        </div>
      )}

      {cat.items.map((item) => (
        <div className="row" key={item.id}>
          <input
            className="name"
            placeholder="Name"
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
          <button className="del" onClick={() => onDeleteItem(item.id)} title="Remove">
            ×
          </button>
        </div>
      ))}

      <div className="cat-foot">
        <button className="linklike" onClick={onAddItem}>
          + Add line item
        </button>
      </div>
    </div>
  );
}
