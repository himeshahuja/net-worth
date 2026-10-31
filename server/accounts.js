// How a Plaid account counts toward net worth: its category, and the balance that counts.
import { CATEGORIES } from '../src/lib/networth.js';

// Plaid's investment subtypes that are retirement plans, Roth variants included.
const RETIREMENT = new Set([
  '401a', '401k', '403b', '457b', 'ira', 'keogh', 'lif', 'lira', 'lrif', 'lrsp', 'pension', 'prif',
  'profit sharing plan', 'qshr', 'rdsp', 'retirement', 'rlif', 'roth', 'roth 401k', 'roth 403b', 'roth 457b',
  'roth pension', 'roth profit sharing plan', 'roth thrift savings plan', 'rrif', 'rrsp', 'sarsep', 'sep ira',
  'simple ira', 'sipp', 'thrift savings plan',
]);

export function categoryOf({ type, subtype }) {
  if (type === 'depository') return 'cash';
  if (type === 'credit') return 'credit';
  if (type === 'loan') return 'loans';
  if (type === 'investment' || type === 'brokerage') return RETIREMENT.has(String(subtype).toLowerCase()) ? 'retirement' : 'investments';
  return 'other';
}

// Plaid's current balance is what an account holds, or for a card or loan what is owed on it. Only a bank
// account may fall back to its available balance: on a card, "available" is the unused credit.
export function balanceOf({ type, balances = {} }) {
  return balances.current ?? (type === 'depository' ? balances.available : null) ?? null;
}

// Only US dollar balances count. An account in another currency, or a token with no official currency,
// is left out and reported rather than added at a made-up rate.
export const counts = (account) => balanceOf(account) != null && account.balances?.iso_currency_code === 'USD';

// The account's type within its category: 'cash.checking', 'retirement.401k'. Plaid's subtype is a fixed list, so
// the key never carries a name or a number.
export function typeOf(account) {
  const sub = String(account.subtype ?? '').toLowerCase().replace(/[^a-z0-9 ()-]/g, '').trim().slice(0, 40);
  return `${categoryOf(account)}.${sub || 'other'}`;
}

// Whole-dollar totals per category, added up in cents so the parts match the whole, and the same totals per
// type. Each type is rounded down and the dollars left over go to the largest remainders, so a category's
// types add up to exactly its total.
export function totalsOf(accounts) {
  const cents = Object.fromEntries(CATEGORIES.map((c) => [c.key, 0]));
  const typeCents = {};
  const counted = accounts.filter(counts);
  for (const a of counted) {
    const c = Math.round(balanceOf(a) * 100);
    cents[categoryOf(a)] += c;
    typeCents[typeOf(a)] = (typeCents[typeOf(a)] || 0) + c;
  }
  const totals = Object.fromEntries(Object.entries(cents).map(([key, v]) => [key, Math.round(v / 100)]));
  const types = {};
  for (const { key } of CATEGORIES) {
    const parts = Object.entries(typeCents).filter(([k]) => k.startsWith(`${key}.`)).map(([k, c]) => ({ k, whole: Math.floor(c / 100), rest: c - Math.floor(c / 100) * 100 }));
    let left = totals[key] - parts.reduce((s, p) => s + p.whole, 0);
    for (const p of [...parts].sort((a, b) => b.rest - a.rest)) if (left-- > 0) p.whole++;
    for (const p of parts) if (p.whole) types[p.k] = p.whole;
  }
  return { totals, types, counted: counted.length, skipped: accounts.length - counted.length };
}
