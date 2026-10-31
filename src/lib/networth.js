// What a snapshot holds and the figures derived from it. Pure functions, shared by the public page,
// the admin page and the Node scripts.
//
// A history is { currency, source, updated, accounts, days: [{ date: 'YYYY-MM-DD', cash, ... }] },
// one day per snapshot, oldest first, every figure a whole number of dollars.

export const CATEGORIES = [
  { key: 'cash', label: 'Cash', side: 'own' },
  { key: 'investments', label: 'Investments', side: 'own' },
  { key: 'retirement', label: 'Retirement', side: 'own' },
  { key: 'other', label: 'Other assets', side: 'own' },
  { key: 'credit', label: 'Credit cards', side: 'owe' },
  { key: 'loans', label: 'Loans', side: 'owe' },
];

const CATEGORY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));

// Each day may also hold `types`: the same totals split by account type, keyed 'category.subtype' with Plaid's
// subtype ('cash.checking', 'retirement.401k', 'loans.student'). The parts of a category add up to its total.
const TYPE_LABELS = {
  'cash.checking': 'Checking', 'cash.savings': 'Savings', 'cash.cd': 'CDs', 'cash.money market': 'Money market',
  'cash.cash management': 'Cash management', 'cash.hsa': 'HSA', 'cash.prepaid': 'Prepaid', 'cash.paypal': 'PayPal',
  'investments.brokerage': 'Brokerage', 'investments.529': '529 plan', 'investments.hsa': 'HSA investments',
  'investments.crypto exchange': 'Crypto', 'investments.education savings account': 'Education savings',
  'investments.stock plan': 'Stock plan', 'investments.mutual fund': 'Mutual funds', 'investments.non-taxable brokerage account': 'Tax-free brokerage',
  'retirement.401k': '401(k)', 'retirement.roth 401k': 'Roth 401(k)', 'retirement.401a': '401(a)', 'retirement.403b': '403(b)',
  'retirement.roth 403b': 'Roth 403(b)', 'retirement.457b': '457(b)', 'retirement.ira': 'IRA', 'retirement.roth': 'Roth IRA',
  'retirement.sep ira': 'SEP IRA', 'retirement.simple ira': 'SIMPLE IRA', 'retirement.pension': 'Pension',
  'retirement.thrift savings plan': 'Thrift Savings Plan', 'retirement.roth thrift savings plan': 'Roth TSP',
  'credit.credit card': 'Credit cards', 'credit.paypal': 'PayPal Credit',
  'loans.student': 'Student loans', 'loans.mortgage': 'Mortgage', 'loans.auto': 'Auto loan', 'loans.home equity': 'Home equity',
  'loans.line of credit': 'Line of credit', 'loans.consumer': 'Personal loan', 'loans.business': 'Business loan',
};

export const categoryOfType = (key) => key.slice(0, key.indexOf('.'));
export function typeLabel(key) {
  if (TYPE_LABELS[key]) return TYPE_LABELS[key];
  const sub = key.slice(key.indexOf('.') + 1);
  return !sub || sub === 'other' || sub === categoryOfType(key) ? CATEGORY[categoryOfType(key)]?.label ?? 'Other' : sub[0].toUpperCase() + sub.slice(1);
}

// A day's parts by type; a day saved before types existed counts as one part per category.
export const partsOf = (day) => day.types ?? Object.fromEntries(CATEGORIES.filter((c) => day[c.key]).map((c) => [`${c.key}.${c.key}`, day[c.key]]));

// Every type a history has held, so a loan paid off stays on the list at $0, largest today first.
export function typesUsed(days) {
  const keys = new Set(days.flatMap((d) => Object.keys(partsOf(d))));
  const last = partsOf(days.at(-1));
  return [...keys].sort((a, b) => (last[b] || 0) - (last[a] || 0) || a.localeCompare(b));
}

const sum = (day, side) => CATEGORIES.reduce((s, c) => (c.side === side ? s + (day[c.key] || 0) : s), 0);
export const own = (day) => sum(day, 'own');
export const owe = (day) => sum(day, 'owe');
export const net = (day) => own(day) - owe(day);

// Dates stay 'YYYY-MM-DD' strings; arithmetic goes through UTC so no time zone can shift a day.
const toUTC = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
export const addDays = (date, n) => new Date(toUTC(date) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
export const endOfLastMonth = (date) => addDays(`${date.slice(0, 7)}-01`, -1);
export const endOfLastYear = (date) => `${+date.slice(0, 4) - 1}-12-31`;

// The figure as of a date: the last snapshot on or before it.
export function dayOn(days, date) {
  let found = null;
  for (const d of days) {
    if (d.date > date) break;
    found = d;
  }
  return found;
}

// The change from a baseline date to the latest day. When the history starts after the baseline, the
// change runs from the first snapshot instead, and `from` says so; with one snapshot there is no change.
export function changeSince(days, date) {
  const last = days.at(-1);
  const base = dayOn(days, date) || days[0];
  if (!last || base === last) return null;
  return { from: base.date, started: base.date > date, net: net(last) - net(base), own: own(last) - own(base), owe: owe(last) - owe(base) };
}

// Each month's close (its last snapshot), newest first, with the change from the close before it.
export function months(days) {
  const closes = new Map();
  for (const d of days) closes.set(d.date.slice(0, 7), d);
  const list = [...closes.values()];
  return list.map((day, i) => ({ month: day.date.slice(0, 7), day, change: i ? net(day) - net(list[i - 1]) : null })).reverse();
}

// The change in a figure over the last `length` days, from the snapshot on or before that date. Null when the
// history does not reach back that far, or holds one day.
export function changeOver(days, length, value = net) {
  const last = days.at(-1);
  const base = length === Infinity ? days[0] : dayOn(days, addDays(last.date, -length));
  if (!base || base === last) return null;
  return { from: base.date, base: value(base), change: value(last) - value(base) };
}

// The standard look-backs, each from a calendar date. A look-back the history does not reach has no change.
export function periods(days) {
  const end = days.at(-1).date;
  const list = [
    ['1 day', addDays(end, -1)],
    ['7 days', addDays(end, -7)],
    ['Month to date', endOfLastMonth(end)],
    ['3 months', addDays(end, -91)],
    ['Year to date', endOfLastYear(end)],
    ['1 year', addDays(end, -365)],
  ];
  const rows = list.map(([label, date]) => {
    const base = dayOn(days, date);
    return { label, date, from: base?.date ?? null, change: base && base !== days.at(-1) ? net(days.at(-1)) - net(base) : null, base: base && net(base) };
  });
  rows.push({ label: 'All time', date: days[0].date, from: days[0].date, change: days.length > 1 ? net(days.at(-1)) - net(days[0]) : null, base: net(days[0]) });
  return rows;
}

// Highs, lows and the best and worst months, from the daily figures. Month changes count closed months only.
export function records(days) {
  let high = days[0], low = days[0];
  for (const d of days) {
    if (net(d) >= net(high)) high = d;
    if (net(d) < net(low)) low = d;
  }
  const closed = months(days).filter((m) => m.change != null && m.month !== days.at(-1).date.slice(0, 7));
  const best = closed.reduce((b, m) => (!b || m.change > b.change ? m : b), null);
  const worst = closed.reduce((w, m) => (!w || m.change < w.change ? m : w), null);
  return { high, low, belowHigh: net(days.at(-1)) - net(high), best, worst, count: days.length, since: days[0].date };
}

// A round step that the figure crosses at most four times, so the notes on the line stay few.
export function milestoneStep(days) {
  const quarter = Math.max(1, ...days.map((d) => Math.abs(net(d)))) / 4;
  const mag = 10 ** Math.floor(Math.log10(quarter));
  return Math.max(100, [1, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= quarter));
}

// The days the figure first climbed past each round step (and past zero, for a history that starts in
// debt). Falls below a step are not notes: the line shows them, and a record is only set going up.
export function milestones(days, step = milestoneStep(days)) {
  const notes = [];
  if (!days.length) return notes;
  let best = Math.floor(net(days[0]) / step);
  days.forEach((d, i) => {
    const level = Math.floor(net(d) / step);
    if (i && level > best) {
      const value = level * step;
      notes.push({ index: i, date: d.date, value });
      best = level;
    }
  });
  return notes;
}
