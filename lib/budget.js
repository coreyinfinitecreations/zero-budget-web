// Budget helpers — mirror the mobile app's BudgetContext data model so the web
// editor reads/writes the exact same per-user `app_state` document.

export const DEFAULT_CATEGORIES = [
  { id: 'income', name: 'Income', type: 'income', targetPercent: null, items: [] },
  { id: 'giving', name: 'Giving', type: 'expense', targetPercent: 10, items: [] },
  { id: 'housing', name: 'Housing', type: 'expense', targetPercent: 28, items: [] },
  { id: 'transportation', name: 'Transportation', type: 'expense', targetPercent: 12, items: [] },
  { id: 'food', name: 'Food', type: 'expense', targetPercent: 12, items: [] },
  { id: 'personal', name: 'Personal', type: 'expense', targetPercent: 8, items: [] },
  { id: 'lifestyle', name: 'Lifestyle', type: 'expense', targetPercent: 8, items: [] },
  { id: 'health', name: 'Health', type: 'expense', targetPercent: 7, items: [] },
  { id: 'debt', name: 'Debt', type: 'expense', targetPercent: 15, items: [] },
];

export function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthLabel(key) {
  const [year, month] = key.split('-');
  const d = new Date(parseInt(year, 10), parseInt(month, 10) - 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function shiftMonth(key, delta) {
  const [year, month] = key.split('-').map(Number);
  return getMonthKey(new Date(year, month - 1 + delta));
}

// Derive the categories to show for a month: its saved budget, else carry the
// most recent prior month forward (spent reset), else the default template.
export function deriveCategories(budgets, month) {
  if (budgets?.[month]) return budgets[month];
  const prevKey = latestMonthBefore(budgets, month);
  const source = prevKey ? budgets[prevKey] : DEFAULT_CATEGORIES;
  // Rebase a carried-forward due date into the target month: keep the
  // day-of-month (the 5th, the 15th, …) but move it to `month`'s month/year,
  // clamping to the month's length (31st → 30th in June).
  const [ty, tm] = month.split('-').map(Number);
  const daysInTarget = new Date(ty, tm, 0).getDate();
  const rebaseDueDate = (iso) => {
    if (!iso) return null;
    const day = Math.min(new Date(iso).getDate(), daysInTarget);
    return new Date(ty, tm - 1, day).toISOString();
  };
  return source.map((cat) => ({
    ...cat,
    items: (cat.items || []).map((i) => {
      // Due dates only carry into the next month when "repeat monthly" is on
      // (default on, so existing items keep their schedule).
      const repeat = i.repeatMonthly !== false;
      return {
        ...i,
        spent: 0,
        plaidTxIds: [],
        cashflowDates: repeat ? i.cashflowDates || [] : [],
        dueDate: repeat ? rebaseDueDate(i.dueDate) : null,
      };
    }),
  }));
}

// Due day-of-month list for an item (new cashflowDates model, else legacy dueDate).
export function dueDaysOf(item) {
  if (item.cashflowDates && item.cashflowDates.length) {
    return [...item.cashflowDates].sort((a, b) => a - b);
  }
  if (item.dueDate) return [new Date(item.dueDate).getDate()];
  return [];
}

// Build dated cashflow events from a month's categories. Each item's `planned`
// amount is split evenly across its scheduled day(s) (a paycheck on the 1st &
// 15th shows up as two half-amount events); items with no schedule are
// returned separately as `undated` so they can be called out in the UI.
export function buildCashflowEvents(categories, monthKey) {
  const [year, month] = monthKey.split('-').map(Number); // month is 1-based
  const daysInMonth = new Date(year, month, 0).getDate();
  const events = [];
  const undated = [];

  (categories || []).forEach((cat) => {
    const isIncome = cat.type === 'income';
    (cat.items || []).forEach((item) => {
      if (!item.planned || item.planned <= 0) return;
      const days = [...new Set(dueDaysOf(item))].sort((a, b) => a - b);
      if (days.length === 0) {
        undated.push({
          id: `${cat.id}-${item.id}`,
          type: isIncome ? 'income' : 'expense',
          name: item.name,
          category: cat.name,
          amount: item.planned,
        });
        return;
      }
      const share = item.planned / days.length;
      days.forEach((rawDay, i) => {
        const day = Math.min(rawDay, daysInMonth); // clamp (e.g. 31st in a 30-day month)
        events.push({
          id: `${cat.id}-${item.id}-${day}`,
          day,
          type: isIncome ? 'income' : 'expense',
          name: item.name,
          category: days.length > 1 ? `${cat.name} · ${i + 1} of ${days.length}` : cat.name,
          amount: share,
        });
      });
    });
  });

  events.sort((a, b) => a.day - b.day || (a.type === 'income' ? -1 : 1));
  return { events, undated };
}

// Day-by-day running balance for a month given its dated events and a
// starting cash position. Tracks the lowest point reached (the "safe to
// spend" ceiling) and returns each event annotated with its balance-after.
export function projectCashflow(events, startingBalance, daysInMonth) {
  const dailyBalance = new Array(daysInMonth + 1).fill(startingBalance);
  const eventsWithBalance = [];
  let bal = startingBalance;
  let lowest = startingBalance;
  let lowestDay = 0;
  let cursor = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    while (cursor < events.length && events[cursor].day === day) {
      const e = events[cursor];
      bal += e.type === 'income' ? e.amount : -e.amount;
      eventsWithBalance.push({ ...e, balanceAfter: bal });
      cursor++;
    }
    dailyBalance[day] = bal;
    if (bal < lowest) {
      lowest = bal;
      lowestDay = day;
    }
  }

  return { dailyBalance, lowest, lowestDay, endBalance: bal, eventsWithBalance };
}

// Most recent month before `key` that has a saved budget (for carry-forward).
export function latestMonthBefore(budgets, key) {
  const earlier = Object.keys(budgets || {})
    .filter((k) => k < key)
    .sort();
  return earlier.length ? earlier[earlier.length - 1] : null;
}

export function formatMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// Currency with cents — used for individual transactions.
export function formatMoneyCents(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

// Normalize a vendor/description for vendor-memory ("Quick assign") matching.
export function normalizeVendor(vendor) {
  return String(vendor || '').trim().toLowerCase();
}

// Round to cents to avoid floating-point artifacts (e.g. 220.65999999999997).
export function roundMoney(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Release any manual transaction that's tracked to a category/item which no
// longer exists in the budget (e.g. its category was deleted). Such orphans are
// returned to the untracked ("New") list so they can be re-assigned.
export function reconcileTransactions(budgets, transactions) {
  const valid = new Set();
  for (const cats of Object.values(budgets || {})) {
    (cats || []).forEach((c) =>
      (c.items || []).forEach((i) => valid.add(`${c.id}:${i.id}`))
    );
  }
  if (valid.size === 0) return transactions || [];
  return (transactions || []).map((t) =>
    t.tracked && t.assignedTo && !valid.has(`${t.assignedTo.categoryId}:${t.assignedTo.itemId}`)
      ? { ...t, tracked: false, assignedTo: null }
      : t
  );
}

// Normalize every item's money fields to clean cents across all months.
// Used on load so pre-existing floating-point artifacts are corrected.
export function normalizeBudgets(budgets) {
  const out = {};
  for (const [month, cats] of Object.entries(budgets || {})) {
    out[month] = (cats || []).map((c) => ({
      ...c,
      items: (c.items || []).map((i) => ({
        ...i,
        planned: roundMoney(i.planned),
        spent: roundMoney(i.spent),
      })),
    }));
  }
  return out;
}

const sumItems = (cats, key) =>
  (cats || []).reduce(
    (sum, c) => sum + (c.items || []).reduce((s, i) => s + (Number(i[key]) || 0), 0),
    0
  );

export function computeTotals(categories, goals) {
  const income = categories.filter((c) => c.type === 'income');
  const expense = categories.filter((c) => c.type === 'expense');

  const plannedIncome = sumItems(income, 'planned');
  const plannedExpenses = sumItems(expense, 'planned');
  const spentExpenses = sumItems(expense, 'spent');
  const incomeReceived = sumItems(income, 'spent');
  const totalSaved = (goals || []).reduce((s, g) => s + (Number(g.saved) || 0), 0);

  return {
    plannedIncome,
    plannedExpenses,
    spentExpenses,
    incomeReceived,
    totalSaved,
    remaining: plannedIncome - plannedExpenses - totalSaved,
  };
}

let _id = 0;
export function newId(prefix = 'item') {
  // Time + counter; ids only need to be unique within a user's document.
  _id += 1;
  return `${prefix}-${Date.now().toString(36)}-${_id}`;
}
