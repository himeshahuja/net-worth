// A snapshot: every connected account's balance, totalled by category and type, saved as one day in
// public/networth.json, encrypted with the page's password. That file is the whole public record: totals per day,
// the number of accounts and when it was updated. No bank, account name, number or transaction is ever written to it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { plaidError } from './plaid.js';
import { totalsOf } from './accounts.js';
import { isSealed, open, seal } from '../src/lib/vault.js';

export const historyFile = (root) => path.join(root, 'public', 'networth.json');

// Failures that pass on their own. An expired login or a removed connection needs the owner, so it is not retried.
const TRANSIENT = new Set(['INSTITUTION_DOWN', 'INSTITUTION_NOT_RESPONDING', 'PRODUCT_NOT_READY', 'UNREACHABLE']);
const transient = (err) => err?.response?.data?.error_type === 'RATE_LIMIT_EXCEEDED' || TRANSIENT.has(plaidError(err).code);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One connection's accounts, tried up to three times, about 2 and then 4 seconds apart, so a bank that is
// briefly down at snapshot time does not cost the day.
async function accountsOf(plaid, it, wait) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await plaid.accountsGet({ access_token: it.accessToken });
    } catch (err) {
      if (attempt === 3 || !transient(err)) throw err;
      await wait(1000 * 2 ** attempt * (0.75 + Math.random() / 2));
    }
  }
}

// All or nothing: when any connection fails, nothing is saved, so the public figure never drops because
// one bank's login expired. The error lists each failure by its position and institution.
export async function readAccounts(plaid, items, { wait = sleep } = {}) {
  const results = await Promise.allSettled(items.map((it) => accountsOf(plaid, it, wait)));
  const failures = results.flatMap((r, index) => (r.status === 'rejected' ? [{ index, institution: items[index].institution, ...plaidError(r.reason) }] : []));
  if (failures.length) {
    const err = new Error(`${failures.length} of ${items.length} connections could not be read.`);
    err.failures = failures;
    throw err;
  }
  return results.flatMap((r) => r.value.data.accounts);
}

// The date a snapshot belongs to, in the owner's time zone.
export const dateIn = (timeZone, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

// The saved history, opened with the password, and the salt to keep for the next seal. A file saved before it was
// encrypted is read as it is. After a password change, `previous` opens the old file and the next seal takes a new salt.
export async function loadHistory(file, { password, previous } = {}) {
  let saved;
  try {
    saved = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { history: null, salt: null };
    throw err;
  }
  if (!isSealed(saved)) return { history: saved, salt: null };
  for (const [pw, salt] of [[password, saved.kdf.salt], [previous, null]]) {
    if (!pw) continue;
    try {
      return { history: (await open(saved, { password: pw })).history, salt };
    } catch {
      // not this password
    }
  }
  throw new Error('NETWORTH_PASSWORD does not open the saved figures. To change the password, put the old one in NETWORTH_PREVIOUS_PASSWORD for one snapshot.');
}

// The page's password: long enough that the public file cannot be guessed open.
export function checkPassword(password) {
  if (!password) throw new Error('Add NETWORTH_PASSWORD to .env first: the published figures are encrypted with it.');
  if (password.length < 12) throw new Error('NETWORTH_PASSWORD needs at least 12 characters; a few words strung together is best.');
}

// Adds a day, or replaces it when a snapshot is taken twice on one date. Test figures never mix with real
// ones: the first production snapshot starts the history over.
export function withDay(history, { date, totals, types, accounts, source, updated }) {
  const kept = history?.source === source ? history.days.filter((d) => d.date !== date) : [];
  const days = [...kept, { date, ...totals, ...(types && { types }) }].sort((a, b) => a.date.localeCompare(b.date));
  return { currency: 'USD', source, updated, accounts, days };
}

export async function takeSnapshot({ plaid, items, source, timeZone, file, password, previous, now = new Date() }) {
  checkPassword(password);
  if (!items.length) throw new Error('No accounts are connected yet.');
  const saved = await loadHistory(file, { password, previous });
  const { totals, types, counted, skipped } = totalsOf(await readAccounts(plaid, items));
  const history = withDay(saved.history, { date: dateIn(timeZone, now), totals, types, accounts: counted, source, updated: now.toISOString() });
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(await seal(history, password, saved.salt))}\n`);
  await fs.rename(`${file}.tmp`, file);
  return { history, skipped };
}
