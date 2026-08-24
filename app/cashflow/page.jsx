'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { accountsApi, manualAccountsApi, stateApi } from '../../lib/api';
import Sidebar from '../../components/Sidebar';
import TopLoadingBar from '../../components/TopLoadingBar';
import CalendarPicker from '../../components/CalendarPicker';
import {
  buildCashflowEvents,
  deriveCategories,
  formatMoney,
  formatMonthLabel,
  getMonthKey,
  normalizeBudgets,
  projectCashflow,
  rescheduleCashflowDay,
  roundMoney,
  sanitizeMoneyDraft,
  shiftMonth,
} from '../../lib/budget';

const START_KEY = 'zb-cashflow-start';

// Compact form for tight spaces (e.g. $1.2k)
function formatMoneyShort(amount) {
  const abs = Math.abs(amount);
  if (abs >= 10000) return `${amount < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`;
  return formatMoney(amount);
}

function dayLabel(year, month, day) {
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
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

export default function CashflowPage() {
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
  const [accountsNetWorth, setAccountsNetWorth] = useState(0);
  const [currentMonth, setCurrentMonth] = useState(() => getMonthKey(new Date()));
  const [saveState, setSaveState] = useState('saved'); // 'saved' | 'saving' | 'error'
  const loadedRef = useRef(false);

  const [customStart, setCustomStart] = useState(null); // null = use accountsNetWorth
  const [startModal, setStartModal] = useState(false);
  const [startInput, setStartInput] = useState('');

  // Drag state for rescheduling a line item onto a different day.
  const draggingRef = useRef(null); // { catId, itemId, day } — day is a number or null (unscheduled)
  const [dragOverId, setDragOverId] = useState(null);
  const [unscheduledOver, setUnscheduledOver] = useState(false);

  // Click-to-edit: which item's title/planned/schedule the modal is showing.
  const [editing, setEditing] = useState(null); // { catId, itemId } | null
  const [editPlannedDraft, setEditPlannedDraft] = useState('');

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
        const [{ data: remote }, connected, manual] = await Promise.all([
          stateApi.get(),
          accountsApi.list().catch(() => ({ accounts: [] })),
          manualAccountsApi.list().catch(() => ({ accounts: [] })),
        ]);
        if (!active) return;
        setDoc({
          budgets: normalizeBudgets(remote?.budgets || {}),
          goals: remote?.goals || [],
          transactions: remote?.transactions || [],
          assignedPlaidTxIds: remote?.assignedPlaidTxIds || [],
          vendorMemory: remote?.vendorMemory || {},
          userName: remote?.userName || '',
          showPercentages: remote?.showPercentages ?? true,
        });
        const netWorth = [...(connected?.accounts || []), ...(manual?.accounts || [])].reduce((sum, a) => {
          const isCredit = a.type === 'credit' || a.subtype === 'credit_card';
          const bal = Number(a.balance) || 0;
          return sum + (isCredit ? -bal : bal);
        }, 0);
        setAccountsNetWorth(netWorth);
      } catch (e) {
        console.warn('Load cashflow failed:', e.message);
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

  // Load any saved starting-balance override for the month being viewed.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem(`${START_KEY}-${currentMonth}`);
    setCustomStart(raw !== null ? Number(raw) : null);
  }, [currentMonth]);

  async function signOut() {
    await supabase.auth.signOut();
    router.replace('/login');
  }

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

  const rescheduleItem = useCallback(
    (catId, itemId, fromDay, toDay) => {
      setCategories((cats) =>
        cats.map((c) =>
          c.id !== catId
            ? c
            : {
                ...c,
                items: c.items.map((i) =>
                  i.id !== itemId ? i : { ...i, ...rescheduleCashflowDay(i, fromDay, toDay, currentMonth) }
                ),
              }
        )
      );
    },
    [setCategories, currentMonth]
  );

  const updateEditingItem = useCallback(
    (field, value) => {
      if (!editing) return;
      setCategories((cats) =>
        cats.map((c) =>
          c.id !== editing.catId
            ? c
            : { ...c, items: c.items.map((i) => (i.id !== editing.itemId ? i : { ...i, [field]: value })) }
        )
      );
    },
    [setCategories, editing]
  );

  const startingBalance = customStart !== null ? customStart : accountsNetWorth;

  function openStartEditor() {
    setStartInput(String(Math.round(startingBalance)));
    setStartModal(true);
  }
  function saveStart() {
    const val = Number(startInput) || 0;
    setCustomStart(val);
    window.localStorage.setItem(`${START_KEY}-${currentMonth}`, String(val));
    setStartModal(false);
  }
  function resetStart() {
    setCustomStart(null);
    window.localStorage.removeItem(`${START_KEY}-${currentMonth}`);
    setStartModal(false);
  }

  const monthInitialized = ready && !!doc.budgets?.[currentMonth];
  const categories = doc.budgets?.[currentMonth] || [];

  const editingItem = useMemo(() => {
    if (!editing) return null;
    const cat = categories.find((c) => c.id === editing.catId);
    const item = cat?.items.find((i) => i.id === editing.itemId);
    return item ? { cat, item } : null;
  }, [editing, categories]);

  // Reset the planned-amount draft only when switching to a different item
  // (or opening the modal) — not on every keystroke, or a trailing "." would
  // get clobbered by the very update it just triggered.
  useEffect(() => {
    if (!editing) return;
    const cat = categories.find((c) => c.id === editing.catId);
    const item = cat?.items.find((i) => i.id === editing.itemId);
    if (item) setEditPlannedDraft(String(item.planned ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.catId, editing?.itemId]);

  const [year, month] = currentMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const realNow = new Date();
  const isCurrentMonth = realNow.getFullYear() === year && realNow.getMonth() + 1 === month;
  const todayDay = isCurrentMonth ? realNow.getDate() : null;

  const { events, undated } = useMemo(
    () => (monthInitialized ? buildCashflowEvents(categories, currentMonth) : { events: [], undated: [] }),
    [monthInitialized, categories, currentMonth]
  );

  const { lowest, lowestDay, endBalance, eventsWithBalance } = useMemo(
    () => projectCashflow(events, startingBalance, daysInMonth),
    [events, startingBalance, daysInMonth]
  );

  const totalIncome = events.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const totalExpense = events.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const goesNegative = lowest < 0;
  const safeToSpend = Math.max(0, lowest);

  // Reference point for each row's green/red level bar: the best balance
  // reached this month, so every row's fill is relative to the same "how
  // full is the tank" scale rather than to itself.
  const peakBalance = Math.max(1, startingBalance, ...eventsWithBalance.map((e) => e.balanceAfter));
  function levelBar(balance) {
    const negative = balance < 0;
    const pct = negative ? 100 : Math.max(0, Math.min(100, (balance / peakBalance) * 100));
    return <div className={`cf-row-bar ${negative ? 'neg' : 'pos'}`} style={{ width: `${pct}%` }} />;
  }

  function endDrag() {
    draggingRef.current = null;
    setDragOverId(null);
    setUnscheduledOver(false);
  }
  function startDragRow(catId, itemId, day) {
    draggingRef.current = { catId, itemId, day };
  }
  function dropOnRow(targetDay) {
    const d = draggingRef.current;
    endDrag();
    if (!d || d.day === targetDay) return;
    rescheduleItem(d.catId, d.itemId, d.day, targetDay);
  }
  function dropOnUnscheduled() {
    const d = draggingRef.current;
    endDrag();
    if (!d || d.day == null) return;
    rescheduleItem(d.catId, d.itemId, d.day, null);
  }

  return (
    <div className="app-shell">
      <Sidebar active="cashflow" email={email} onSignOut={signOut} />

      <main className="main">
        <div className="content">
          {!ready ? (
            <TopLoadingBar />
          ) : (
            <>
              <div className="month-head">
                <div>
                  <h1 className="month-title">
                    <strong>Cashflow</strong>
                  </h1>
                  {monthInitialized && (
                    <div className="left-to-budget">
                      {formatMonthLabel(currentMonth)}
                      <span className="cf-savestate">
                        {' · '}
                        {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'All changes saved'}
                      </span>
                    </div>
                  )}
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

              {!monthInitialized ? (
                <div className="cf-empty">
                  <p>
                    {formatMonthLabel(currentMonth)} doesn’t have a budget yet. Set one up on the{' '}
                    <a href="/budget">Budget</a> page to see its cashflow projection here.
                  </p>
                </div>
              ) : (
                <>
                  <div className="cf-hero">
                    <div className="cf-hero-label">
                      {goesNegative ? 'Lowest projected balance' : 'Safe to spend this month'}
                    </div>
                    <div className={`cf-hero-figure ${goesNegative ? 'neg' : 'pos'}`}>
                      {formatMoney(goesNegative ? lowest : safeToSpend)}
                    </div>
                    <div className="cf-hero-sub">
                      {goesNegative
                        ? `Dips below $0 around ${dayLabel(year, month, lowestDay)}`
                        : lowestDay > 0
                          ? `Tightest on ${dayLabel(year, month, lowestDay)}`
                          : 'Based on your planned dates'}
                    </div>

                    {goesNegative && (
                      <div className="cf-warning">
                        Expenses come due before enough income arrives. Drag a bill to a later day, or earlier if a
                        paycheck lands sooner, to stay positive.
                      </div>
                    )}

                    <div className="cf-stats">
                      <button className="cf-stat editable" onClick={openStartEditor}>
                        <span className="cf-stat-label">Starting ✎</span>
                        <span className="cf-stat-value">{formatMoneyShort(startingBalance)}</span>
                      </button>
                      <div className="cf-stat">
                        <span className="cf-stat-label">Income</span>
                        <span className="cf-stat-value pos">+{formatMoneyShort(totalIncome)}</span>
                      </div>
                      <div className="cf-stat">
                        <span className="cf-stat-label">Expenses</span>
                        <span className="cf-stat-value neg">-{formatMoneyShort(totalExpense)}</span>
                      </div>
                      <div className="cf-stat">
                        <span className="cf-stat-label">End of mo.</span>
                        <span className={`cf-stat-value ${endBalance < 0 ? 'neg' : ''}`}>
                          {formatMoneyShort(endBalance)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="cf-section-title">All line items</div>
                  <div className="cf-timeline">
                    <div className="cf-row nodrag editable" onClick={openStartEditor}>
                      {levelBar(startingBalance)}
                      <span className="cf-datebadge muted">START</span>
                      <div className="cf-row-mid">
                        <div className="cf-row-title">Starting balance ✎</div>
                        <div className="cf-row-sub">Cash on hand — tap to change</div>
                      </div>
                      <div className="cf-row-end">
                        <span className={`cf-row-balance ${startingBalance < 0 ? 'neg' : ''}`}>
                          {formatMoney(startingBalance)}
                        </span>
                      </div>
                    </div>

                    {eventsWithBalance.map((e) => {
                      const isIncome = e.type === 'income';
                      const isOver = dragOverId === e.id;
                      return (
                        <div
                          key={e.id}
                          className={`cf-row draggable editable${isOver ? ' dragover' : ''}`}
                          onClick={() => setEditing({ catId: e.catId, itemId: e.itemId })}
                          onDragOver={(ev) => {
                            ev.preventDefault();
                            if (dragOverId !== e.id) setDragOverId(e.id);
                          }}
                          onDragLeave={(ev) => {
                            if (ev.currentTarget !== ev.target) return;
                            if (dragOverId === e.id) setDragOverId(null);
                          }}
                          onDrop={(ev) => {
                            ev.preventDefault();
                            dropOnRow(e.day);
                          }}
                        >
                          {levelBar(e.balanceAfter)}
                          <span
                            className="grip"
                            draggable
                            onClick={(ev) => ev.stopPropagation()}
                            onDragStart={() => startDragRow(e.catId, e.itemId, e.day)}
                            onDragEnd={endDrag}
                            title="Drag to reschedule"
                          >
                            <Grip />
                          </span>
                          <span className={`cf-datebadge ${e.day === todayDay ? 'today' : ''}`}>{e.day}</span>
                          <div className="cf-row-mid">
                            <div className="cf-row-title">{e.name}</div>
                            <div className="cf-row-sub">{e.category}</div>
                          </div>
                          <div className="cf-row-end">
                            <span className={`cf-row-amount ${isIncome ? 'pos' : ''}`}>
                              {isIncome ? '+' : '-'}
                              {formatMoney(e.amount)}
                            </span>
                            <span className={`cf-row-balance ${e.balanceAfter < 0 ? 'neg' : ''}`}>
                              {formatMoney(e.balanceAfter)}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {undated.length > 0 && (
                      <>
                        <div
                          className={`cf-unscheduled-zone${unscheduledOver ? ' over' : ''}`}
                          onDragOver={(ev) => {
                            ev.preventDefault();
                            if (!unscheduledOver) setUnscheduledOver(true);
                          }}
                          onDragLeave={(ev) => {
                            if (ev.currentTarget !== ev.target) return;
                            setUnscheduledOver(false);
                          }}
                          onDrop={(ev) => {
                            ev.preventDefault();
                            dropOnUnscheduled();
                          }}
                        >
                          Unscheduled — drag here to clear a date, or drag one of these onto a dated item above to
                          schedule it
                        </div>
                        {undated.map((e) => {
                          const isIncome = e.type === 'income';
                          return (
                            <div
                              className="cf-row draggable editable"
                              key={e.id}
                              onClick={() => setEditing({ catId: e.catId, itemId: e.itemId })}
                            >
                              <span
                                className="grip"
                                draggable
                                onClick={(ev) => ev.stopPropagation()}
                                onDragStart={() => startDragRow(e.catId, e.itemId, null)}
                                onDragEnd={endDrag}
                                title="Drag onto an item above to schedule"
                              >
                                <Grip />
                              </span>
                              <span className="cf-datebadge muted">—</span>
                              <div className="cf-row-mid">
                                <div className="cf-row-title">{e.name}</div>
                                <div className="cf-row-sub">{e.category}</div>
                              </div>
                              <div className="cf-row-end">
                                <span className={`cf-row-amount ${isIncome ? 'pos' : ''}`}>
                                  {isIncome ? '+' : '-'}
                                  {formatMoney(e.amount)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}

                    {eventsWithBalance.length === 0 && undated.length === 0 && (
                      <div className="cf-empty nested">
                        <p>
                          No income or expense items yet. Add some on the <a href="/budget">Budget</a> page.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </main>

      {startModal && (
        <div className="modal-overlay" onClick={() => setStartModal(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Starting balance</h3>
            <p className="modal-msg">The cash you have right now, before this month's income and bills.</p>
            <input
              className="field"
              type="text"
              inputMode="decimal"
              autoFocus
              value={startInput}
              onChange={(e) => setStartInput(sanitizeMoneyDraft(e.target.value))}
            />
            {customStart !== null && (
              <button type="button" className="cf-reset-link" onClick={resetStart}>
                Use account balance ({formatMoney(accountsNetWorth)})
              </button>
            )}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setStartModal(false)}>
                Cancel
              </button>
              <button className="btn" onClick={saveStart}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {editingItem && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">Edit item</h3>
            <p className="modal-msg">{editingItem.cat.name}</p>
            <input
              className="field"
              value={editingItem.item.name}
              placeholder="Item name"
              onChange={(e) => updateEditingItem('name', e.target.value)}
            />
            <label className="detail-label">Planned</label>
            <input
              className="field"
              type="text"
              inputMode="decimal"
              value={editPlannedDraft}
              onChange={(e) => {
                const cleaned = sanitizeMoneyDraft(e.target.value);
                setEditPlannedDraft(cleaned);
                updateEditingItem('planned', roundMoney(Number(cleaned) || 0));
              }}
            />
            <label className="detail-label">
              {editingItem.cat.type === 'income' ? 'Expected dates' : 'Due dates'}
            </label>
            <CalendarPicker
              currentMonth={currentMonth}
              item={editingItem.item}
              isIncome={editingItem.cat.type === 'income'}
              onUpdate={updateEditingItem}
            />
            <div className="modal-actions">
              <button className="btn" onClick={() => setEditing(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
