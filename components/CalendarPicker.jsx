'use client';

import { ordinal } from '../lib/budget';

// Day-of-month picker for a budget item's cashflow schedule. Shared by the
// Budget page's item detail panel and the Cashflow page's edit modal so both
// read/write the exact same `cashflowDates`/`dueDate`/`repeatMonthly` fields.
export default function CalendarPicker({ currentMonth, item, isIncome, onUpdate }) {
  const [y, m] = String(currentMonth || '').split('-').map(Number);
  const year = y || new Date().getFullYear();
  const month = m || new Date().getMonth() + 1; // 1-based
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const selected = item.cashflowDates && item.cashflowDates.length
    ? [...item.cashflowDates].sort((a, b) => a - b)
    : item.dueDate
      ? [new Date(item.dueDate).getDate()]
      : [];
  const repeat = item.repeatMonthly !== false;

  const apply = (days) => {
    const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 31).sort((a, b) => a - b);
    onUpdate('cashflowDates', sorted);
    onUpdate('dueDate', sorted.length ? new Date(year, month - 1, sorted[0]).toISOString() : null);
  };
  const toggleDay = (d) => apply(selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d]);

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div className="cal">
      <div className="cal-month">{monthLabel}</div>
      <div className="cal-grid cal-weekdays">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
          <span key={i} className="cal-wd">{w}</span>
        ))}
      </div>
      <div className="cal-grid">
        {cells.map((d, i) =>
          d === null ? (
            <span key={`b${i}`} className="cal-cell empty" />
          ) : (
            <button
              key={d}
              type="button"
              className={`cal-cell ${selected.includes(d) ? 'on' : ''}`}
              onClick={() => toggleDay(d)}
            >
              {d}
            </button>
          )
        )}
      </div>
      <label className="cal-repeat">
        <input type="checkbox" checked={repeat} onChange={(e) => onUpdate('repeatMonthly', e.target.checked)} />
        Repeat monthly
      </label>
      <div className="cal-summary">
        {selected.length === 0
          ? `Pick the day(s) this ${isIncome ? 'income arrives' : 'is due'}.`
          : repeat
            ? `Repeats on the ${selected.map(ordinal).join(', ')} each month.`
            : `${monthLabel} only — won’t carry to next month.`}
      </div>
    </div>
  );
}
