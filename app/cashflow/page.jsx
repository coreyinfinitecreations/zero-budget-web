'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { accountsApi, manualAccountsApi, stateApi } from '../../lib/api';
import Sidebar from '../../components/Sidebar';
import TopLoadingBar from '../../components/TopLoadingBar';
import {
  buildCashflowEvents,
  formatMoney,
  formatMonthLabel,
  getMonthKey,
  normalizeBudgets,
  projectCashflow,
  shiftMonth,
} from '../../lib/budget';

const START_KEY = 'zb-cashflow-start';
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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

export default function CashflowPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [budgets, setBudgets] = useState({});
  const [accountsNetWorth, setAccountsNetWorth] = useState(0);
  const [currentMonth, setCurrentMonth] = useState(() => getMonthKey(new Date()));

  const [customStart, setCustomStart] = useState(null); // null = use accountsNetWorth
  const [startModal, setStartModal] = useState(false);
  const [startInput, setStartInput] = useState('');

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
        const [state, connected, manual] = await Promise.all([
          stateApi.get(),
          accountsApi.list().catch(() => ({ accounts: [] })),
          manualAccountsApi.list().catch(() => ({ accounts: [] })),
        ]);
        if (!active) return;
        setBudgets(normalizeBudgets(state?.data?.budgets || {}));
        const netWorth = [...(connected?.accounts || []), ...(manual?.accounts || [])].reduce((sum, a) => {
          const isCredit = a.type === 'credit' || a.subtype === 'credit_card';
          const bal = Number(a.balance) || 0;
          return sum + (isCredit ? -bal : bal);
        }, 0);
        setAccountsNetWorth(netWorth);
      } catch (e) {
        console.warn('Load cashflow failed:', e.message);
      }
      if (active) setReady(true);
    })();
    return () => {
      active = false;
    };
  }, [router]);

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

  const monthInitialized = ready && !!budgets?.[currentMonth];
  const categories = budgets?.[currentMonth] || [];

  const [year, month] = currentMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const realNow = new Date();
  const isCurrentMonth = realNow.getFullYear() === year && realNow.getMonth() + 1 === month;
  const todayDay = isCurrentMonth ? realNow.getDate() : null;

  const { events, undated } = useMemo(
    () => (monthInitialized ? buildCashflowEvents(categories, currentMonth) : { events: [], undated: [] }),
    [monthInitialized, categories, currentMonth]
  );

  const { dailyBalance, lowest, lowestDay, endBalance, eventsWithBalance } = useMemo(
    () => projectCashflow(events, startingBalance, daysInMonth),
    [events, startingBalance, daysInMonth]
  );

  const totalIncome = events.filter((e) => e.type === 'income').reduce((s, e) => s + e.amount, 0);
  const totalExpense = events.filter((e) => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
  const goesNegative = lowest < 0;
  const safeToSpend = Math.max(0, lowest);

  const timeline = useMemo(() => {
    const map = {};
    eventsWithBalance.forEach((e) => {
      if (!map[e.day]) map[e.day] = { day: e.day, items: [] };
      map[e.day].items.push(e);
    });
    return Object.values(map).sort((a, b) => a.day - b.day);
  }, [eventsWithBalance]);

  const calendarCells = useMemo(() => {
    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const dayEvents = events.filter((e) => e.day === day);
      cells.push({
        day,
        hasIncome: dayEvents.some((e) => e.type === 'income'),
        hasExpense: dayEvents.some((e) => e.type === 'expense'),
        balance: dailyBalance[day],
      });
    }
    return cells;
  }, [events, dailyBalance, firstWeekday, daysInMonth]);

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
                    <div className="left-to-budget">{formatMonthLabel(currentMonth)}</div>
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
                        Expenses come due before enough income arrives. Move a bill later, or a paycheck earlier, to
                        stay positive.
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

                  <div className="cf-section-title">Month at a glance</div>
                  <div className="cf-calendar">
                    <div className="cf-weekdays">
                      {WEEKDAYS.map((w, i) => (
                        <span key={i}>{w}</span>
                      ))}
                    </div>
                    <div className="cf-grid">
                      {calendarCells.map((cell, idx) =>
                        cell ? (
                          <div key={cell.day} className="cf-cell">
                            <div
                              className={`cf-day ${cell.day === todayDay ? 'today' : ''} ${
                                cell.day === lowestDay && goesNegative ? 'low' : ''
                              } ${cell.balance < 0 ? 'negbal' : ''}`}
                            >
                              {cell.day}
                            </div>
                            <div className="cf-dots">
                              {cell.hasIncome && <span className="cf-dot income" />}
                              {cell.hasExpense && <span className="cf-dot expense" />}
                            </div>
                          </div>
                        ) : (
                          <div key={`b${idx}`} className="cf-cell" />
                        )
                      )}
                    </div>
                    <div className="cf-legend">
                      <span>
                        <span className="cf-dot income" /> Income
                      </span>
                      <span>
                        <span className="cf-dot expense" /> Expense
                      </span>
                    </div>
                  </div>

                  <div className="cf-section-title">Projected timeline</div>
                  {timeline.length === 0 ? (
                    <div className="cf-empty">
                      <p>
                        No dated items yet. Add a date to your income and expenses on the <a href="/budget">Budget</a>{' '}
                        page to see your cashflow projected day by day.
                      </p>
                    </div>
                  ) : (
                    <div className="cf-timeline">
                      <div className="cf-row">
                        <span className="cf-datebadge muted">START</span>
                        <div className="cf-row-mid">
                          <div className="cf-row-title">Starting balance</div>
                          <div className="cf-row-sub">Cash on hand</div>
                        </div>
                        <div className="cf-row-end">
                          <span className={`cf-row-balance ${startingBalance < 0 ? 'neg' : ''}`}>
                            {formatMoney(startingBalance)}
                          </span>
                        </div>
                      </div>
                      {timeline.map((dayGroup) =>
                        dayGroup.items.map((e, i) => {
                          const isIncome = e.type === 'income';
                          return (
                            <div className="cf-row" key={e.id}>
                              {i === 0 ? (
                                <span className={`cf-datebadge ${dayGroup.day === todayDay ? 'today' : ''}`}>
                                  {dayGroup.day}
                                </span>
                              ) : (
                                <span className="cf-datebadge blank" />
                              )}
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
                        })
                      )}
                    </div>
                  )}

                  {undated.length > 0 && (
                    <>
                      <div className="cf-section-title">Not scheduled ({undated.length})</div>
                      <div className="cf-timeline">
                        <div className="cf-undated-note">
                          These items have no date, so they're not in the projection. Add a date from the{' '}
                          <a href="/budget">Budget</a> page to include them.
                        </div>
                        {undated.map((e) => {
                          const isIncome = e.type === 'income';
                          return (
                            <div className="cf-row" key={e.id}>
                              <div className="cf-row-mid" style={{ marginLeft: 0 }}>
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
                      </div>
                    </>
                  )}
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
              type="number"
              inputMode="decimal"
              autoFocus
              value={startInput}
              onChange={(e) => setStartInput(e.target.value)}
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
    </div>
  );
}
