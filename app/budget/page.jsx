'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { accountsApi, plaidApi, stateApi, transactionsApi } from '../../lib/api';
import Sidebar from '../../components/Sidebar';
import {
  DEFAULT_CATEGORIES,
  computeTotals,
  formatMoney,
  formatMoneyCents,
  formatMonthLabel,
  getMonthKey,
  latestMonthBefore,
  newId,
  normalizeVendor,
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
    items: (cat.items || []).map((i) => ({ ...i, spent: 0, plaidTxIds: [] })),
  }));
}

// Normalize a Plaid (server) transaction into the panel's common shape.
function fromPlaid(t) {
  const amount = Math.abs(Number(t.amount) || 0);
  return {
    id: t.id,
    vendor: t.merchant_name || t.name || 'Transaction',
    amount,
    type: Number(t.amount) < 0 ? 'income' : 'expense',
    date: t.date ? new Date(t.date).toISOString() : new Date().toISOString(),
    source: 'plaid',
  };
}

export default function BudgetPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [doc, setDoc] = useState({
    budgets: {},
    goals: [],
    transactions: [],
    assignedPlaidTxIds: [],
    vendorMemory: {},
  });
  const [plaidTxns, setPlaidTxns] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(getMonthKey(new Date()));
  const [saveState, setSaveState] = useState('saved'); // 'saved' | 'saving' | 'error'
  const [txTab, setTxTab] = useState('new'); // 'new' | 'tracked'
  const [txStatus, setTxStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [dragInfo, setDragInfo] = useState(null); // { assigned } while dragging — drives highlights
  const [unassignOver, setUnassignOver] = useState(false);
  const [reorderKind, setReorderKind] = useState(null); // 'cat' | 'item' | null
  const [reorderOver, setReorderOver] = useState(null); // catId or `${catId}:${itemId}` being hovered
  const draggingRef = useRef(null); // { tx, assigned } — read at drop time
  const reorderRef = useRef(null); // { kind, catId, itemId } — read at drop time
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
            assignedPlaidTxIds: remote?.assignedPlaidTxIds || [],
            vendorMemory: remote?.vendorMemory || {},
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
      // Pull server-stored (Plaid-synced) transactions; if banks are connected,
      // trigger a fresh sync first so newly-posted transactions appear.
      try {
        const { accounts } = await accountsApi.list();
        if (accounts?.length) {
          try {
            await plaidApi.syncTransactions();
          } catch (e) {
            if (active) setTxStatus(`Couldn’t sync from your bank: ${e.message}`);
          }
        }
        const { transactions } = await transactionsApi.list({ limit: 250 });
        if (active && Array.isArray(transactions)) {
          setPlaidTxns(transactions.filter((t) => t.source === 'plaid').map(fromPlaid));
        }
      } catch (e) {
        if (active) setTxStatus(`Couldn’t load bank transactions: ${e.message}`);
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

  // ── Category / item mutations ────────────────────────────────────────────────
  const updateItem = (catId, itemId, field, value) =>
    setCategories((cats) =>
      cats.map((c) =>
        c.id === catId
          ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, [field]: value } : i)) }
          : c
      )
    );

  const addItem = (catId) =>
    setCategories((cats) =>
      cats.map((c) =>
        c.id === catId
          ? { ...c, items: [...c.items, { id: newId(), name: '', planned: 0, spent: 0, plaidTxIds: [] }] }
          : c
      )
    );

  const deleteItem = (catId, itemId) =>
    setCategories((cats) =>
      cats.map((c) => (c.id === catId ? { ...c, items: c.items.filter((i) => i.id !== itemId) } : c))
    );

  const renameCategory = (catId, name) =>
    setCategories((cats) => cats.map((c) => (c.id === catId ? { ...c, name } : c)));

  const deleteCategory = (catId) => setCategories((cats) => cats.filter((c) => c.id !== catId));

  const addCategory = () => {
    const name = window.prompt('New group name');
    if (!name || !name.trim()) return;
    setCategories((cats) => [
      ...cats,
      { id: newId('cat'), name: name.trim(), type: 'expense', targetPercent: 5, items: [] },
    ]);
  };

  // Reorder items within a single category.
  const reorderItem = (catId, fromItemId, toItemId) => {
    if (String(fromItemId) === String(toItemId)) return;
    setCategories((cats) =>
      cats.map((c) => {
        if (c.id !== catId) return c;
        const items = [...c.items];
        const from = items.findIndex((i) => String(i.id) === String(fromItemId));
        if (from < 0) return c;
        const [moved] = items.splice(from, 1);
        const to = items.findIndex((i) => String(i.id) === String(toItemId));
        items.splice(to < 0 ? items.length : to, 0, moved);
        return { ...c, items };
      })
    );
  };

  // Reorder categories. Income is pinned — it can't be moved and can't be a drop target.
  const reorderCategory = (fromCatId, toCatId) => {
    if (fromCatId === toCatId) return;
    setCategories((cats) => {
      const moving = cats.find((c) => c.id === fromCatId);
      const target = cats.find((c) => c.id === toCatId);
      if (!moving || !target || moving.type === 'income' || target.type === 'income') return cats;
      const next = cats.filter((c) => c.id !== fromCatId);
      const to = next.findIndex((c) => c.id === toCatId);
      next.splice(to < 0 ? next.length : to, 0, moving);
      return next;
    });
  };

  // ── Transaction assignment (mirrors the mobile BudgetContext) ────────────────
  // Atomically updates budgets (item.spent / plaidTxIds), transactions
  // (tracked / assignedTo), assignedPlaidTxIds, and vendorMemory.
  const assignTransaction = useCallback(
    (tx, categoryId, itemId) => {
      setDoc((prev) => {
        const month = currentMonth;
        const budgets = { ...(prev.budgets || {}) };
        const current = budgets[month] || deriveCategories(prev.budgets, month);

        budgets[month] = current.map((c) =>
          c.id === categoryId
            ? {
                ...c,
                items: c.items.map((i) =>
                  String(i.id) === String(itemId)
                    ? {
                        ...i,
                        spent: (Number(i.spent) || 0) + tx.amount,
                        plaidTxIds:
                          tx.source === 'plaid'
                            ? [...(i.plaidTxIds || []), tx.id]
                            : i.plaidTxIds || [],
                      }
                    : i
                ),
              }
            : c
        );

        const transactions =
          tx.source === 'plaid'
            ? prev.transactions || []
            : (prev.transactions || []).map((t) =>
                t.id === tx.id ? { ...t, tracked: true, assignedTo: { categoryId, itemId } } : t
              );

        const assignedPlaidTxIds =
          tx.source === 'plaid'
            ? [...new Set([...(prev.assignedPlaidTxIds || []), tx.id])]
            : prev.assignedPlaidTxIds || [];

        const key = normalizeVendor(tx.vendor);
        const vendorMemory = key
          ? { ...(prev.vendorMemory || {}), [key]: { categoryId, itemId: String(itemId) } }
          : prev.vendorMemory || {};

        return { ...prev, budgets, transactions, assignedPlaidTxIds, vendorMemory };
      });
    },
    [currentMonth]
  );

  const unassignTransaction = useCallback(
    (tx) => {
      setDoc((prev) => {
        const month = currentMonth;
        const budgets = { ...(prev.budgets || {}) };
        const current = budgets[month] || deriveCategories(prev.budgets, month);

        // Find where it's assigned.
        let target = null;
        if (tx.source === 'plaid') {
          current.forEach((c) =>
            c.items.forEach((i) => {
              if ((i.plaidTxIds || []).includes(tx.id)) target = { categoryId: c.id, itemId: i.id };
            })
          );
        } else {
          const t = (prev.transactions || []).find((x) => x.id === tx.id);
          target = t?.assignedTo || null;
        }

        if (target) {
          budgets[month] = current.map((c) =>
            c.id === target.categoryId
              ? {
                  ...c,
                  items: c.items.map((i) =>
                    String(i.id) === String(target.itemId)
                      ? {
                          ...i,
                          spent: Math.max(0, (Number(i.spent) || 0) - tx.amount),
                          plaidTxIds: (i.plaidTxIds || []).filter((id) => id !== tx.id),
                        }
                      : i
                  ),
                }
              : c
          );
        }

        const transactions =
          tx.source === 'plaid'
            ? prev.transactions || []
            : (prev.transactions || []).map((t) =>
                t.id === tx.id ? { ...t, tracked: false, assignedTo: null } : t
              );

        const assignedPlaidTxIds =
          tx.source === 'plaid'
            ? (prev.assignedPlaidTxIds || []).filter((id) => id !== tx.id)
            : prev.assignedPlaidTxIds || [];

        return { ...prev, budgets, transactions, assignedPlaidTxIds };
      });
    },
    [currentMonth]
  );

  const getVendorSuggestion = useCallback(
    (vendor) => {
      const key = normalizeVendor(vendor);
      const m = doc.vendorMemory?.[key];
      if (!m) return null;
      const cat = categories.find((c) => c.id === m.categoryId);
      const item = cat?.items.find((i) => String(i.id) === String(m.itemId));
      if (!cat || !item) return null;
      return { categoryId: cat.id, itemId: item.id, itemName: item.name, categoryName: cat.name };
    },
    [doc.vendorMemory, categories]
  );

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

  // Manual "Sync" — pull the latest from connected banks, then refresh the list.
  const syncNow = useCallback(async () => {
    setSyncing(true);
    setTxStatus('');
    try {
      const { accounts } = await accountsApi.list();
      if (!accounts?.length) {
        setTxStatus('No banks connected yet — connect one on the Accounts page.');
        return;
      }
      await plaidApi.syncTransactions();
      const { transactions } = await transactionsApi.list({ limit: 250 });
      setPlaidTxns((transactions || []).filter((t) => t.source === 'plaid').map(fromPlaid));
    } catch (e) {
      setTxStatus(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }, []);

  // ── Transaction lists for the panel ──────────────────────────────────────────
  const assignedPlaidSet = useMemo(
    () => new Set(doc.assignedPlaidTxIds || []),
    [doc.assignedPlaidTxIds]
  );

  const manualTxns = useMemo(
    () => (doc.transactions || []).filter((t) => !t.deleted).map((t) => ({ ...t, source: 'manual' })),
    [doc.transactions]
  );

  const allPanelTxns = useMemo(
    () =>
      [...manualTxns, ...plaidTxns].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [manualTxns, plaidTxns]
  );

  const newTxns = useMemo(
    () =>
      allPanelTxns.filter((t) =>
        t.source === 'plaid' ? !assignedPlaidSet.has(t.id) : !t.tracked
      ),
    [allPanelTxns, assignedPlaidSet]
  );

  const trackedTxns = useMemo(
    () =>
      allPanelTxns.filter((t) => (t.source === 'plaid' ? assignedPlaidSet.has(t.id) : t.tracked)),
    [allPanelTxns, assignedPlaidSet]
  );

  // txId → assigned item name (for the Tracked tab labels)
  const assignmentNameMap = useMemo(() => {
    const map = {};
    categories.forEach((cat) =>
      cat.items.forEach((item) => {
        (item.plaidTxIds || []).forEach((txId) => {
          map[txId] = item.name || 'Untitled';
        });
      })
    );
    (doc.transactions || []).forEach((t) => {
      if (t.tracked && t.assignedTo) {
        const cat = categories.find((c) => c.id === t.assignedTo.categoryId);
        const item = cat?.items.find((i) => String(i.id) === String(t.assignedTo.itemId));
        if (item) map[t.id] = item.name || 'Untitled';
      }
    });
    return map;
  }, [categories, doc.transactions]);

  if (!ready) return <div className="center-note">Loading your budget…</div>;

  const incomeCats = categories.filter((c) => c.type === 'income');
  const expenseCats = categories.filter((c) => c.type === 'expense');
  const [monthName, yearNum] = formatMonthLabel(currentMonth).split(' ');

  const endDrag = () => {
    draggingRef.current = null;
    setDragInfo(null);
    setDragOverKey(null);
    setUnassignOver(false);
  };

  const startDrag = (tx, assigned) => {
    draggingRef.current = { tx, assigned };
    setDragInfo({ assigned });
  };

  const startReorder = (kind, catId, itemId) => {
    reorderRef.current = { kind, catId, itemId };
    setReorderKind(kind);
  };
  const endReorder = () => {
    reorderRef.current = null;
    setReorderKind(null);
    setReorderOver(null);
  };

  // Drop on a budget line item: reorder within the category, or assign/reassign a transaction.
  const handleDropOnItem = (catId, itemId) => {
    const r = reorderRef.current;
    if (r?.kind === 'item' && r.catId === catId) {
      endReorder();
      reorderItem(catId, r.itemId, itemId);
      return;
    }
    const d = draggingRef.current;
    endDrag();
    if (!d) return;
    if (d.assigned) unassignTransaction(d.tx); // remove from its old item first
    assignTransaction(d.tx, catId, itemId);
  };

  // Drop on a category card: reorder categories (Income excluded).
  const handleDropOnCategory = (targetCatId) => {
    const r = reorderRef.current;
    endReorder();
    if (r?.kind === 'cat') reorderCategory(r.catId, targetCatId);
  };

  // Drop back onto the transactions panel: unassign (only meaningful if tracked).
  const handleUnassignDrop = () => {
    const d = draggingRef.current;
    endDrag();
    if (d?.assigned) unassignTransaction(d.tx);
  };

  return (
    <div className="app-shell">
      <Sidebar active="budget" email={email} onSignOut={signOut} />

      <main className="main">
        <div className="content has-panel">
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
              dragOverKey={dragOverKey}
              setDragOverKey={setDragOverKey}
              isDragging={!!dragInfo}
              reorderKind={reorderKind}
              reorderOver={reorderOver}
              setReorderOver={setReorderOver}
              onStartItemReorder={startReorder}
              onStartCategoryReorder={startReorder}
              onEndReorder={endReorder}
              onDropCategory={handleDropOnCategory}
              onDropItem={handleDropOnItem}
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

      <TransactionPanel
        txTab={txTab}
        setTxTab={setTxTab}
        newTxns={newTxns}
        trackedTxns={trackedTxns}
        assignmentNameMap={assignmentNameMap}
        getVendorSuggestion={getVendorSuggestion}
        onQuickAssign={(tx, s) => assignTransaction(tx, s.categoryId, s.itemId)}
        onUnassign={unassignTransaction}
        onDragStartTx={startDrag}
        onDragEndTx={endDrag}
        draggingAssigned={!!dragInfo?.assigned}
        unassignOver={unassignOver}
        setUnassignOver={setUnassignOver}
        onUnassignDrop={handleUnassignDrop}
        onSync={syncNow}
        syncing={syncing}
        txStatus={txStatus}
        saveState={saveState}
      />
    </div>
  );
}

function Grip() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
      <g fill="currentColor">
        <circle cx="2" cy="3" r="1.3" />
        <circle cx="8" cy="3" r="1.3" />
        <circle cx="2" cy="8" r="1.3" />
        <circle cx="8" cy="8" r="1.3" />
        <circle cx="2" cy="13" r="1.3" />
        <circle cx="8" cy="13" r="1.3" />
      </g>
    </svg>
  );
}

// Shows the value as plain text; turns into an editable input only when clicked.
function EditableMoney({ value, onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    onCommit(Number(draft) || 0);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="money editing"
        type="number"
        inputMode="decimal"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') setEditing(false);
        }}
      />
    );
  }

  return (
    <button
      type="button"
      className="moneycell"
      onClick={() => {
        setDraft(String(value ?? 0));
        setEditing(true);
      }}
    >
      {formatMoney(value)}
    </button>
  );
}

function GroupCard({
  cat,
  onRename,
  onDelete,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onDropItem,
  onDropCategory,
  onStartItemReorder,
  onStartCategoryReorder,
  onEndReorder,
  dragOverKey,
  setDragOverKey,
  isDragging,
  reorderKind,
  reorderOver,
  setReorderOver,
}) {
  const isIncome = cat.type === 'income';
  const middleLabel = isIncome ? 'Received' : 'Spent';
  const catReorderTarget = reorderKind === 'cat' && !isIncome;
  const catOver = catReorderTarget && reorderOver === cat.id;

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
    <div
      className={`group${catOver ? ' cat-over' : ''}`}
      onDragOver={(e) => {
        if (catReorderTarget) {
          e.preventDefault();
          if (reorderOver !== cat.id) setReorderOver(cat.id);
        }
      }}
      onDrop={(e) => {
        if (reorderKind === 'cat') {
          e.preventDefault();
          onDropCategory(cat.id);
        }
      }}
    >
      <div className="group-head">
        <div className="group-name">
          {isIncome ? (
            <span className="grip-spacer" />
          ) : (
            <span
              className="grip"
              draggable
              onDragStart={() => onStartCategoryReorder('cat', cat.id)}
              onDragEnd={onEndReorder}
              title="Drag to reorder"
            >
              <Grip />
            </span>
          )}
          <input value={cat.name} onChange={(e) => onRename(e.target.value)} />
          {!isIncome && (
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

      {cat.items.map((item) => {
        const remaining = (Number(item.planned) || 0) - (Number(item.spent) || 0);
        const key = `${cat.id}:${item.id}`;
        const txOver = isDragging && dragOverKey === key;
        const itemReorderTarget = reorderKind === 'item';
        const itemOver = itemReorderTarget && reorderOver === key;
        return (
          <div
            className={`line${isDragging ? ' droppable' : ''}${txOver ? ' dragover' : ''}${itemOver ? ' reorder-over' : ''}`}
            key={item.id}
            onDragOver={(e) => {
              if (itemReorderTarget) {
                e.preventDefault();
                if (reorderOver !== key) setReorderOver(key);
              } else if (isDragging) {
                e.preventDefault();
                if (dragOverKey !== key) setDragOverKey(key);
              }
            }}
            onDragLeave={(e) => {
              if (e.currentTarget !== e.target) return;
              if (dragOverKey === key) setDragOverKey(null);
              if (reorderOver === key) setReorderOver(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDropItem(cat.id, item.id);
            }}
          >
            <div className="line-name">
              <span
                className="grip"
                draggable
                onDragStart={() => onStartItemReorder('item', cat.id, item.id)}
                onDragEnd={onEndReorder}
                title="Drag to reorder"
              >
                <Grip />
              </span>
              <input
                className="name"
                placeholder="Add item name"
                value={item.name}
                onChange={(e) => onUpdateItem(item.id, 'name', e.target.value)}
              />
            </div>
            <EditableMoney value={item.planned ?? 0} onCommit={(v) => onUpdateItem(item.id, 'planned', v)} />
            <EditableMoney value={item.spent ?? 0} onCommit={(v) => onUpdateItem(item.id, 'spent', v)} />
            <span className={`remaining ${remaining < 0 ? 'neg' : ''}`}>{formatMoney(remaining)}</span>
            <button className="del" onClick={() => onDeleteItem(item.id)} title="Remove">
              ×
            </button>
          </div>
        );
      })}

      <div className="group-foot">
        <button className="add-line" onClick={onAddItem}>
          + {isIncome ? 'Add income' : 'Add item'}
        </button>
        <span className="foot-total">{formatMoney(totals.planned)}</span>
        <span className="foot-total">{formatMoney(totals.spent)}</span>
        <span className="foot-total pad">{formatMoney(totalRemaining)}</span>
        <span />
      </div>
    </div>
  );
}

function TransactionPanel({
  txTab,
  setTxTab,
  newTxns,
  trackedTxns,
  assignmentNameMap,
  getVendorSuggestion,
  onQuickAssign,
  onUnassign,
  onDragStartTx,
  onDragEndTx,
  draggingAssigned,
  unassignOver,
  setUnassignOver,
  onUnassignDrop,
  onSync,
  syncing,
  txStatus,
  saveState,
}) {
  const list = txTab === 'new' ? newTxns : trackedTxns;
  return (
    <aside
      className="txpanel"
      onDragOver={(e) => {
        if (draggingAssigned) {
          e.preventDefault();
          if (!unassignOver) setUnassignOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setUnassignOver(false);
      }}
      onDrop={(e) => {
        if (draggingAssigned) {
          e.preventDefault();
          onUnassignDrop();
        }
      }}
    >
      {draggingAssigned && (
        <div className={`txdropzone ${unassignOver ? 'over' : ''}`}>Drop here to unassign</div>
      )}
      <div className="txpanel-head">
        <span className="txpanel-title">Transactions</span>
        <button className="txsync" onClick={onSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync'}
        </button>
      </div>
      <div className="txpanel-sub">
        <span className="save-state">
          {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'All changes saved'}
        </span>
      </div>

      {txStatus && <div className="txstatus">{txStatus}</div>}

      <div className="txtabs">
        <button className={`txtab ${txTab === 'new' ? 'active' : ''}`} onClick={() => setTxTab('new')}>
          New ({newTxns.length})
        </button>
        <button className={`txtab ${txTab === 'tracked' ? 'active' : ''}`} onClick={() => setTxTab('tracked')}>
          Tracked ({trackedTxns.length})
        </button>
      </div>

      {txTab === 'new' ? (
        <p className="txhint">Drag a transaction onto a budget item to assign it, or use Quick assign.</p>
      ) : (
        <p className="txhint">Drag onto a different item to reassign, or back into this panel to unassign.</p>
      )}

      <div className="txlist">
        {list.length === 0 && (
          <div className="txempty">
            {txTab === 'new'
              ? 'Nothing to assign. Connect a bank in Accounts or add a manual transaction.'
              : 'No assigned transactions yet.'}
          </div>
        )}

        {list.map((tx) => {
          const suggestion = txTab === 'new' ? getVendorSuggestion(tx.vendor) : null;
          const d = new Date(tx.date);
          const mon = d.toLocaleDateString('en-US', { month: 'short' });
          const day = d.getDate();
          return (
            <div
              key={`${tx.source}:${tx.id}`}
              className="txrow"
              draggable
              onDragStart={() => onDragStartTx(tx, txTab === 'tracked')}
              onDragEnd={onDragEndTx}
            >
              <div className={`txdate ${tx.source === 'plaid' ? 'bank' : 'manual'}`}>
                <span className="m">{mon}</span>
                <span className="d">{day}</span>
              </div>
              <div className="txmid">
                <div className="txvendor">{tx.vendor}</div>
                <div className="txsub">
                  {txTab === 'tracked'
                    ? `→ ${assignmentNameMap[tx.id] || 'Tracked'}`
                    : tx.source === 'plaid'
                      ? 'Bank · Unassigned'
                      : 'Manual · Unassigned'}
                </div>
                {suggestion && (
                  <button className="quick-assign" onClick={() => onQuickAssign(tx, suggestion)}>
                    Quick assign → {suggestion.itemName || suggestion.categoryName}
                  </button>
                )}
              </div>
              <div className="txright">
                <span className={`txamt ${tx.type === 'income' ? 'pos' : ''}`}>
                  {tx.type === 'income' ? '+' : '-'}
                  {formatMoneyCents(tx.amount)}
                </span>
                {txTab === 'tracked' && (
                  <button className="txunassign" onClick={() => onUnassign(tx)} title="Unassign">
                    Unassign
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
