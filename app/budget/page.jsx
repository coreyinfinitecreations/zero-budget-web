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
  normalizeBudgets,
  normalizeVendor,
  reconcileTransactions,
  roundMoney,
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
  const amount = roundMoney(Math.abs(Number(t.amount) || 0));
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
  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [selectedItem, setSelectedItem] = useState(null); // { catId, itemId }
  const [confirmDeleteCat, setConfirmDeleteCat] = useState(null); // { id, name }
  const [txTab, setTxTab] = useState('new'); // 'new' | 'tracked'
  const [txStatus, setTxStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [txLoading, setTxLoading] = useState(true);
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
          const budgets = normalizeBudgets(remote?.budgets || {});
          setDoc({
            budgets,
            goals: remote?.goals || [],
            transactions: reconcileTransactions(budgets, remote?.transactions || []),
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
      if (active) setTxLoading(true);
      try {
        const { accounts } = await accountsApi.list();
        if (accounts?.length) {
          try {
            await plaidApi.syncTransactions();
          } catch (e) {
            if (active) setTxStatus(`Couldn’t sync from your bank: ${e.message}`);
          }
        }
        const { transactions } = await transactionsApi.list({ limit: 500 });
        if (active && Array.isArray(transactions)) {
          setPlaidTxns(transactions.filter((t) => t.source === 'plaid').map(fromPlaid));
        }
      } catch (e) {
        if (active) setTxStatus(`Couldn’t load bank transactions: ${e.message}`);
      } finally {
        if (active) setTxLoading(false);
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

  // Delete a category and release every transaction tracked to its items back
  // to the untracked (New) list — manual ones lose their assignment, Plaid ones
  // leave the assigned/dismissed set.
  const deleteCategory = (catId) => {
    setDoc((prev) => {
      const month = currentMonth;
      const budgets = { ...(prev.budgets || {}) };
      const current = budgets[month] || deriveCategories(prev.budgets, month);
      const cat = current.find((c) => c.id === catId);
      const releasedPlaid = new Set();
      (cat?.items || []).forEach((i) => (i.plaidTxIds || []).forEach((id) => releasedPlaid.add(id)));

      budgets[month] = current.filter((c) => c.id !== catId);

      const transactions = (prev.transactions || []).map((t) =>
        t.tracked && t.assignedTo && t.assignedTo.categoryId === catId
          ? { ...t, tracked: false, assignedTo: null }
          : t
      );
      const assignedPlaidTxIds = (prev.assignedPlaidTxIds || []).filter((id) => !releasedPlaid.has(id));

      return { ...prev, budgets, transactions, assignedPlaidTxIds };
    });
  };

  const addCategory = (name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    setCategories((cats) => [
      ...cats,
      { id: newId('cat'), name: trimmed, type: 'expense', targetPercent: 5, items: [] },
    ]);
  };

  const submitNewCategory = (e) => {
    e.preventDefault();
    addCategory(newCatName);
    setNewCatName('');
    setAddingCat(false);
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
                        spent: roundMoney((Number(i.spent) || 0) + tx.amount),
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
                t.id === tx.id
                  ? { ...t, tracked: true, deleted: false, assignedTo: { categoryId, itemId } }
                  : t
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
                          spent: Math.max(0, roundMoney((Number(i.spent) || 0) - tx.amount)),
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

  // Archive (soft-delete) a transaction. Manual → deleted; Plaid → dismissed
  // (added to assignedPlaidTxIds so it leaves the New tray). If it was assigned
  // to a budget item, its amount is removed from that item's Spent.
  const archiveTransaction = useCallback(
    (tx) => {
      setDoc((prev) => {
        if (tx.source === 'plaid') {
          return {
            ...prev,
            assignedPlaidTxIds: [...new Set([...(prev.assignedPlaidTxIds || []), tx.id])],
          };
        }
        const month = currentMonth;
        const budgets = { ...(prev.budgets || {}) };
        const t = (prev.transactions || []).find((x) => x.id === tx.id);
        if (t?.tracked && t.assignedTo) {
          const current = budgets[month] || deriveCategories(prev.budgets, month);
          budgets[month] = current.map((c) =>
            c.id === t.assignedTo.categoryId
              ? {
                  ...c,
                  items: c.items.map((i) =>
                    String(i.id) === String(t.assignedTo.itemId)
                      ? { ...i, spent: Math.max(0, roundMoney((Number(i.spent) || 0) - (Number(tx.amount) || 0))) }
                      : i
                  ),
                }
              : c
          );
        }
        const transactions = (prev.transactions || []).map((x) =>
          x.id === tx.id ? { ...x, deleted: true, tracked: false, assignedTo: null } : x
        );
        return { ...prev, budgets, transactions };
      });
    },
    [currentMonth]
  );

  const archiveMany = useCallback(
    (txList) => {
      txList.forEach((tx) => archiveTransaction(tx));
    },
    [archiveTransaction]
  );

  const restoreTransaction = useCallback((tx) => {
    setDoc((prev) => {
      if (tx.source === 'plaid') {
        return {
          ...prev,
          assignedPlaidTxIds: (prev.assignedPlaidTxIds || []).filter((id) => id !== tx.id),
        };
      }
      return {
        ...prev,
        transactions: (prev.transactions || []).map((x) =>
          x.id === tx.id ? { ...x, deleted: false } : x
        ),
      };
    });
  }, []);

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
      const { transactions } = await transactionsApi.list({ limit: 500 });
      setPlaidTxns((transactions || []).filter((t) => t.source === 'plaid').map(fromPlaid));
    } catch (e) {
      setTxStatus(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }, []);

  // ── Transaction lists for the panel ──────────────────────────────────────────
  // "Handled" Plaid ids (assigned to an item OR dismissed/archived).
  const assignedPlaidSet = useMemo(
    () => new Set(doc.assignedPlaidTxIds || []),
    [doc.assignedPlaidTxIds]
  );
  // Plaid ids actually assigned to a budget item (a subset of the above).
  const assignedItemTxIds = useMemo(() => {
    const s = new Set();
    categories.forEach((c) => c.items.forEach((i) => (i.plaidTxIds || []).forEach((id) => s.add(id))));
    return s;
  }, [categories]);

  const allManual = useMemo(
    () => (doc.transactions || []).map((t) => ({ ...t, source: 'manual' })),
    [doc.transactions]
  );
  const allTxns = useMemo(
    () => [...allManual, ...plaidTxns].sort((a, b) => new Date(b.date) - new Date(a.date)),
    [allManual, plaidTxns]
  );

  const newTxns = useMemo(
    () =>
      allTxns.filter((t) =>
        t.source === 'plaid' ? !assignedPlaidSet.has(t.id) : !t.tracked && !t.deleted
      ),
    [allTxns, assignedPlaidSet]
  );

  const trackedTxns = useMemo(
    () =>
      allTxns.filter((t) =>
        t.source === 'plaid' ? assignedItemTxIds.has(t.id) : t.tracked && !t.deleted
      ),
    [allTxns, assignedItemTxIds]
  );

  const archivedTxns = useMemo(
    () =>
      allTxns.filter((t) =>
        t.source === 'plaid' ? assignedPlaidSet.has(t.id) && !assignedItemTxIds.has(t.id) : t.deleted
      ),
    [allTxns, assignedPlaidSet, assignedItemTxIds]
  );

  // ── Selected budget item (detail view) ───────────────────────────────────────
  const detailItem = useMemo(() => {
    if (!selectedItem) return null;
    const cat = categories.find((c) => c.id === selectedItem.catId);
    const item = cat?.items.find((i) => String(i.id) === String(selectedItem.itemId));
    if (!cat || !item) return null;
    return { catId: cat.id, isIncome: cat.type === 'income', item };
  }, [selectedItem, categories]);

  const detailTxns = useMemo(() => {
    if (!detailItem) return [];
    const { catId, item } = detailItem;
    const manual = (doc.transactions || [])
      .filter(
        (t) =>
          t.tracked &&
          !t.deleted &&
          t.assignedTo &&
          t.assignedTo.categoryId === catId &&
          String(t.assignedTo.itemId) === String(item.id)
      )
      .map((t) => ({ ...t, source: 'manual' }));
    const plaid = (item.plaidTxIds || [])
      .map((id) => plaidTxns.find((t) => t.id === id))
      .filter(Boolean);
    return [...manual, ...plaid].sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [detailItem, doc.transactions, plaidTxns]);

  const updateDetailField = useCallback(
    (field, value) => {
      if (!selectedItem) return;
      updateItem(selectedItem.catId, selectedItem.itemId, field, value);
    },
    [selectedItem]
  );

  const deleteDetailItem = useCallback(() => {
    if (!selectedItem) return;
    if (window.confirm('Delete this budget item? This cannot be undone.')) {
      deleteItem(selectedItem.catId, selectedItem.itemId);
      setSelectedItem(null);
    }
  }, [selectedItem]);

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
              selectedItemKey={selectedItem ? `${selectedItem.catId}:${selectedItem.itemId}` : null}
              onSelectItem={(catId, itemId) => setSelectedItem({ catId, itemId })}
              onStartItemReorder={startReorder}
              onStartCategoryReorder={startReorder}
              onEndReorder={endReorder}
              onDropCategory={handleDropOnCategory}
              onDropItem={handleDropOnItem}
              onRename={(name) => renameCategory(cat.id, name)}
              onDelete={() => setConfirmDeleteCat({ id: cat.id, name: cat.name })}
              onAddItem={() => addItem(cat.id)}
              onUpdateItem={(itemId, field, value) => updateItem(cat.id, itemId, field, value)}
              onDeleteItem={(itemId) => deleteItem(cat.id, itemId)}
            />
          ))}

          {addingCat ? (
            <form className="addcat" onSubmit={submitNewCategory}>
              <input
                className="addcat-name"
                autoFocus
                placeholder="Category name (e.g. Insurance)"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setAddingCat(false);
                    setNewCatName('');
                  }
                }}
              />
              <button className="btn" type="submit" disabled={!newCatName.trim()}>
                Add
              </button>
              <button
                type="button"
                className="btn ghost addcat-cancel"
                onClick={() => {
                  setAddingCat(false);
                  setNewCatName('');
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button className="btn ghost" onClick={() => setAddingCat(true)}>
              + Add category
            </button>
          )}
        </div>
      </main>

      <TransactionPanel
        txTab={txTab}
        setTxTab={setTxTab}
        newTxns={newTxns}
        trackedTxns={trackedTxns}
        archivedTxns={archivedTxns}
        assignmentNameMap={assignmentNameMap}
        getVendorSuggestion={getVendorSuggestion}
        onQuickAssign={(tx, s) => assignTransaction(tx, s.categoryId, s.itemId)}
        onUnassign={unassignTransaction}
        onArchive={archiveTransaction}
        onArchiveMany={archiveMany}
        onRestore={restoreTransaction}
        onDragStartTx={startDrag}
        onDragEndTx={endDrag}
        draggingAssigned={!!dragInfo?.assigned}
        unassignOver={unassignOver}
        setUnassignOver={setUnassignOver}
        onUnassignDrop={handleUnassignDrop}
        onSync={syncNow}
        syncing={syncing}
        txLoading={txLoading}
        txStatus={txStatus}
        saveState={saveState}
        detailItem={detailItem}
        detailTxns={detailTxns}
        onCloseDetail={() => setSelectedItem(null)}
        onUpdateDetail={updateDetailField}
        onDeleteDetailItem={deleteDetailItem}
      />

      {confirmDeleteCat && (
        <ConfirmModal
          title="Delete category?"
          message={`“${confirmDeleteCat.name}” and all of its items will be removed. Any transactions tracked to those items will return to your Transactions list as untracked.`}
          confirmLabel="Delete category"
          onCancel={() => setConfirmDeleteCat(null)}
          onConfirm={() => {
            deleteCategory(confirmDeleteCat.id);
            if (selectedItem?.catId === confirmDeleteCat.id) setSelectedItem(null);
            setConfirmDeleteCat(null);
          }}
        />
      )}
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        <p className="modal-msg">{message}</p>
        <div className="modal-actions">
          <button className="btn ghost modal-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn modal-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
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
    onCommit(roundMoney(Number(draft) || 0));
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
        onClick={(e) => e.stopPropagation()}
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
      onClick={(e) => {
        e.stopPropagation();
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
  selectedItemKey,
  onSelectItem,
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
        const isSelected = selectedItemKey === key;
        return (
          <div
            className={`line clickable${isDragging ? ' droppable' : ''}${txOver ? ' dragover' : ''}${itemOver ? ' reorder-over' : ''}${isSelected ? ' selected' : ''}`}
            key={item.id}
            onClick={() => onSelectItem(cat.id, item.id)}
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
                onClick={(e) => e.stopPropagation()}
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
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onUpdateItem(item.id, 'name', e.target.value)}
              />
            </div>
            <EditableMoney value={item.planned ?? 0} onCommit={(v) => onUpdateItem(item.id, 'planned', v)} />
            <EditableMoney value={item.spent ?? 0} onCommit={(v) => onUpdateItem(item.id, 'spent', v)} />
            {isIncome && remaining < 0 ? (
              <span className="remaining pos">+{formatMoney(Math.abs(remaining))}</span>
            ) : (
              <span className={`remaining ${remaining < 0 ? 'neg' : ''}`}>{formatMoney(remaining)}</span>
            )}
            <button
              className="del"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteItem(item.id);
              }}
              title="Remove"
            >
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
        {isIncome && totalRemaining < 0 ? (
          <span className="foot-total pad pos">+{formatMoney(Math.abs(totalRemaining))}</span>
        ) : (
          <span className="foot-total pad">{formatMoney(totalRemaining)}</span>
        )}
        <span />
      </div>
    </div>
  );
}

function ItemDetailPanel({ detailItem, detailTxns, onClose, onUpdate, onUnassign, onDelete }) {
  const { item, isIncome } = detailItem;
  const planned = Number(item.planned) || 0;
  const spent = Number(item.spent) || 0;
  const remaining = planned - spent;
  const dueValue = item.dueDate ? new Date(item.dueDate).toISOString().slice(0, 10) : '';

  return (
    <aside className="txpanel">
      <div className="detail-head">
        <button className="detail-back" onClick={onClose}>
          ‹ Budget
        </button>
      </div>
      <div className="detail-body">
        <input
          className="detail-title"
          value={item.name}
          placeholder="Item name"
          onChange={(e) => onUpdate('name', e.target.value)}
        />
        <div className="detail-remaining">
          {isIncome && remaining < 0 ? (
            <span className="amt pos">+{formatMoney(Math.abs(remaining))}</span>
          ) : (
            <span className={`amt ${remaining < 0 ? 'neg' : 'pos'}`}>{formatMoney(remaining)}</span>
          )}{' '}
          remaining
        </div>
        <div className="detail-sub">
          {formatMoneyCents(spent)} {isIncome ? 'received' : 'spent'} of {formatMoneyCents(planned)}
        </div>

        <label className="detail-label">Planned</label>
        <input
          className="detail-input"
          type="number"
          inputMode="decimal"
          value={item.planned ?? 0}
          onChange={(e) => onUpdate('planned', roundMoney(Number(e.target.value) || 0))}
        />

        <label className="detail-label">{isIncome ? 'Expected date' : 'Due date'}</label>
        <input
          className="detail-input"
          type="date"
          value={dueValue}
          onChange={(e) =>
            onUpdate('dueDate', e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null)
          }
        />

        <label className="detail-label">Note</label>
        <textarea
          className="detail-note"
          value={item.note || ''}
          placeholder="Add a note"
          onChange={(e) => onUpdate('note', e.target.value)}
        />

        <div className="detail-section-head">Assigned transactions ({detailTxns.length})</div>
        {detailTxns.length === 0 ? (
          <div className="txempty">Drag a transaction onto this item to track it here.</div>
        ) : (
          detailTxns.map((tx) => {
            const d = new Date(tx.date);
            const mon = d.toLocaleDateString('en-US', { month: 'short' });
            const day = d.getDate();
            const isInc = tx.type === 'income';
            return (
              <div className="txrow" key={`${tx.source}:${tx.id}`}>
                <div className={`txdate ${isInc ? 'income' : 'expense'}`}>
                  <span className="m">{mon}</span>
                  <span className="d">{day}</span>
                </div>
                <div className="txmid">
                  <div className="txvendor">{tx.vendor}</div>
                  <div className="txsub">{tx.source === 'plaid' ? 'Bank' : 'Manual'}</div>
                </div>
                <div className="txright">
                  <span className={`txamt ${isInc ? 'pos' : ''}`}>
                    {isInc ? '+' : '-'}
                    {formatMoneyCents(tx.amount)}
                  </span>
                  <button className="txunassign" onClick={() => onUnassign(tx)} title="Remove from this item">
                    Remove
                  </button>
                </div>
              </div>
            );
          })
        )}

        <button className="detail-delete" onClick={onDelete}>
          Delete budget item
        </button>
      </div>
    </aside>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

// Group transactions into month buckets, newest month first.
function groupByMonth(txns) {
  const map = {};
  txns.forEach((t) => {
    const d = new Date(t.date);
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (!map[label]) map[label] = { label, sort: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), items: [] };
    map[label].items.push(t);
  });
  return Object.values(map).sort((a, b) => b.sort - a.sort);
}

function TransactionPanel({
  txTab,
  setTxTab,
  newTxns,
  trackedTxns,
  archivedTxns,
  assignmentNameMap,
  getVendorSuggestion,
  onQuickAssign,
  onUnassign,
  onArchive,
  onArchiveMany,
  onRestore,
  onDragStartTx,
  onDragEndTx,
  draggingAssigned,
  unassignOver,
  setUnassignOver,
  onUnassignDrop,
  onSync,
  syncing,
  txLoading,
  txStatus,
  saveState,
  detailItem,
  detailTxns,
  onCloseDetail,
  onUpdateDetail,
  onDeleteDetailItem,
}) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  const list = txTab === 'new' ? newTxns : txTab === 'tracked' ? trackedTxns : archivedTxns;
  const groups = useMemo(() => groupByMonth(list), [list]);

  // Reset selection when switching tabs.
  useEffect(() => {
    setSelectMode(false);
    setSelected(new Set());
  }, [txTab]);

  // All hooks above this line — only return the detail view after they've run.
  if (detailItem) {
    return (
      <ItemDetailPanel
        detailItem={detailItem}
        detailTxns={detailTxns}
        onClose={onCloseDetail}
        onUpdate={onUpdateDetail}
        onUnassign={onUnassign}
        onDelete={onDeleteDetailItem}
      />
    );
  }

  const keyOf = (tx) => `${tx.source}:${tx.id}`;
  const toggleSel = (tx) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const k = keyOf(tx);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });
  const exitSelect = () => {
    setSelectMode(false);
    setSelected(new Set());
  };
  const archiveSelected = () => {
    onArchiveMany(list.filter((t) => selected.has(keyOf(t))));
    exitSelect();
  };
  const archiveMonth = (group) => {
    if (window.confirm(`Archive all ${group.items.length} transaction(s) in ${group.label}?`)) {
      onArchiveMany(group.items);
    }
  };

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
        <button className={`txtab ${txTab === 'archived' ? 'active' : ''}`} onClick={() => setTxTab('archived')}>
          Archived ({archivedTxns.length})
        </button>
      </div>

      {txTab === 'new' && (
        <div className="txtoolbar">
          {!selectMode ? (
            <>
              <span className="txhint inline">Drag onto a budget item, or use Quick assign.</span>
              {list.length > 0 && (
                <button className="txtool" onClick={() => setSelectMode(true)}>
                  Select
                </button>
              )}
            </>
          ) : (
            <>
              <button className="txtool" onClick={() => setSelected(new Set(list.map(keyOf)))}>
                Select all
              </button>
              <button className="txtool danger" disabled={selected.size === 0} onClick={archiveSelected}>
                Archive ({selected.size})
              </button>
              <button className="txtool" onClick={exitSelect}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}
      {txTab === 'tracked' && (
        <p className="txhint">Drag onto a different item to reassign, or back into this panel to unassign.</p>
      )}
      {txTab === 'archived' && (
        <p className="txhint">Drag onto a budget item to assign, or use Restore to send it back to New.</p>
      )}

      <div className="txlist">
        {txLoading && (
          <div className="txloading">
            <span className="spinner" aria-hidden="true" />
            Loading transactions…
          </div>
        )}
        {!txLoading && list.length === 0 && (
          <div className="txempty">
            {txTab === 'new'
              ? 'Nothing to assign. Connect a bank in Accounts or add a manual transaction.'
              : txTab === 'tracked'
                ? 'No assigned transactions yet.'
                : 'No archived transactions.'}
          </div>
        )}

        {groups.map((group) => (
          <div className="txgroup" key={group.label}>
            <div className="txgroup-head">
              <span className="txgroup-label">
                {group.label} · {group.items.length}
              </span>
              {txTab === 'new' && !selectMode && (
                <button className="txgroup-action" onClick={() => archiveMonth(group)}>
                  Archive all
                </button>
              )}
            </div>

            {group.items.map((tx) => {
              const suggestion = txTab === 'new' && !selectMode ? getVendorSuggestion(tx.vendor) : null;
              const d = new Date(tx.date);
              const mon = d.toLocaleDateString('en-US', { month: 'short' });
              const day = d.getDate();
              const k = keyOf(tx);
              const checked = selected.has(k);
              const isIncome = tx.type === 'income';
              return (
                <div
                  key={k}
                  className={`txrow${selectMode ? ' selectable' : ''}${checked ? ' selected' : ''}`}
                  draggable={!selectMode}
                  onDragStart={() => onDragStartTx(tx, txTab === 'tracked')}
                  onDragEnd={onDragEndTx}
                  onClick={selectMode ? () => toggleSel(tx) : undefined}
                >
                  {selectMode && <input type="checkbox" className="txcheck" checked={checked} readOnly />}
                  <div className={`txdate ${isIncome ? 'income' : 'expense'}`}>
                    <span className="m">{mon}</span>
                    <span className="d">{day}</span>
                  </div>
                  <div className="txmid">
                    <div className="txvendor">{tx.vendor}</div>
                    <div className="txsub">
                      {txTab === 'tracked'
                        ? `→ ${assignmentNameMap[tx.id] || 'Tracked'}`
                        : txTab === 'archived'
                          ? 'Archived'
                          : tx.source === 'plaid'
                            ? 'Bank · Unassigned'
                            : 'Manual · Unassigned'}
                    </div>
                    {suggestion && (
                      <button
                        className="quick-assign"
                        onClick={(e) => {
                          e.stopPropagation();
                          onQuickAssign(tx, suggestion);
                        }}
                      >
                        Quick assign → {suggestion.itemName || suggestion.categoryName}
                      </button>
                    )}
                  </div>
                  <div className="txright">
                    <span className={`txamt ${isIncome ? 'pos' : ''}`}>
                      {isIncome ? '+' : '-'}
                      {formatMoneyCents(tx.amount)}
                    </span>
                    {!selectMode && txTab === 'new' && (
                      <button
                        className="txicon"
                        title="Archive"
                        onClick={(e) => {
                          e.stopPropagation();
                          onArchive(tx);
                        }}
                      >
                        <TrashIcon />
                      </button>
                    )}
                    {!selectMode && txTab === 'tracked' && (
                      <button
                        className="txunassign"
                        onClick={(e) => {
                          e.stopPropagation();
                          onUnassign(tx);
                        }}
                        title="Unassign"
                      >
                        Unassign
                      </button>
                    )}
                    {!selectMode && txTab === 'archived' && (
                      <button
                        className="txunassign"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRestore(tx);
                        }}
                        title="Restore"
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
