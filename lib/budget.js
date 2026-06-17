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
