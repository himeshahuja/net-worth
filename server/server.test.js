import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { categoryOf, balanceOf, totalsOf } from './accounts.js';
import { checkPassword, dateIn, loadHistory, readAccounts, takeSnapshot, withDay } from './snapshot.js';
import { createApi } from './api.js';
import { isSealed, open, seal } from '../src/lib/vault.js';

const PASSWORD = 'test page password';

const account = (type, subtype, current, extra = {}) => ({
  account_id: `acc-${Math.random().toString(36).slice(2, 8)}`, name: `${subtype} account`, mask: '0000', type, subtype,
  balances: { current, available: null, iso_currency_code: 'USD', ...extra },
});
const plaidFailure = (code) => Object.assign(new Error('Request failed with status code 400'), { response: { data: { error_code: code, error_message: 'the login details of this item have changed' } } });

test('accounts land in the right category', () => {
  assert.equal(categoryOf({ type: 'depository', subtype: 'checking' }), 'cash');
  assert.equal(categoryOf({ type: 'credit', subtype: 'credit card' }), 'credit');
  assert.equal(categoryOf({ type: 'loan', subtype: 'student' }), 'loans');
  assert.equal(categoryOf({ type: 'investment', subtype: 'brokerage' }), 'investments');
  assert.equal(categoryOf({ type: 'investment', subtype: 'roth 401k' }), 'retirement');
  assert.equal(categoryOf({ type: 'investment', subtype: '403B' }), 'retirement');
  assert.equal(categoryOf({ type: 'other', subtype: 'other' }), 'other');
});

test('a card never counts its unused credit as a balance', () => {
  assert.equal(balanceOf({ type: 'credit', balances: { current: null, available: 4200 } }), null);
  assert.equal(balanceOf({ type: 'depository', balances: { current: null, available: 310.5 } }), 310.5);
});

test('totals add up in cents and leave out other currencies', () => {
  const { totals, counted, skipped } = totalsOf([
    account('depository', 'checking', 100.1),
    account('depository', 'savings', 200.2),
    account('credit', 'credit card', 50.5),
    account('investment', 'ira', 1000),
    account('depository', 'savings', 999, { iso_currency_code: 'EUR' }),
  ]);
  assert.deepEqual(totals, { cash: 300, investments: 0, retirement: 1000, other: 0, credit: 51, loans: 0 });
  assert.equal(counted, 4);
  assert.equal(skipped, 1);
});

test('totals per type add up to their category, to the dollar', () => {
  // Three checking accounts of $0.40 make $1.20, which rounds to $1: the dollar goes to one of them, not three.
  const { totals, types } = totalsOf([
    account('depository', 'checking', 0.4), account('depository', 'checking', 0.4), account('depository', 'savings', 0.4),
    account('depository', 'cd', 0.6), account('investment', '401k', 1200.5), account('investment', 'Roth', 99.5),
    account('loan', 'student', 5000), account('loan', null, 10),
  ]);
  assert.equal(totals.cash, 2);
  assert.deepEqual(types, { 'cash.checking': 1, 'cash.cd': 1, 'retirement.401k': 1201, 'retirement.roth': 99, 'loans.student': 5000, 'loans.other': 10 });
  assert.equal(totals.retirement, 1300);
});

test('a snapshot is dated in the owner’s time zone', () => {
  assert.equal(dateIn('America/New_York', new Date('2026-11-01T03:00:00Z')), '2026-10-31');
});

test('a day is replaced on a second snapshot, and production starts over from sandbox', () => {
  const totals = { cash: 1, investments: 0, retirement: 0, other: 0, credit: 0, loans: 0 };
  let h = withDay(null, { date: '2026-10-30', totals, accounts: 1, source: 'sandbox', updated: 'a' });
  h = withDay(h, { date: '2026-10-31', totals, accounts: 1, source: 'sandbox', updated: 'b' });
  h = withDay(h, { date: '2026-10-31', totals: { ...totals, cash: 2 }, accounts: 1, source: 'sandbox', updated: 'c' });
  assert.deepEqual(h.days.map((d) => [d.date, d.cash]), [['2026-10-30', 1], ['2026-10-31', 2]]);
  const real = withDay(h, { date: '2026-11-01', totals, accounts: 3, source: 'production', updated: 'd' });
  assert.deepEqual(real.days.map((d) => d.date), ['2026-11-01']);
});

test('the figures open only with the password, and a password change carries the history over', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'net-worth-vault-'));
  const file = path.join(dir, 'networth.json');
  const history = { currency: 'USD', source: 'sandbox', updated: 'a', accounts: 1, days: [{ date: '2026-10-31', cash: 5 }] };
  try {
    const sealed = await seal(history, 'correct horse battery');
    assert.ok(isSealed(sealed) && !JSON.stringify(sealed).includes('2026-10-31'));
    assert.deepEqual((await open(sealed, { password: 'correct horse battery' })).history, history);
    await assert.rejects(open(sealed, { password: 'wrong horse battery' }));

    // A plain file from before is read as it is.
    await fs.writeFile(file, JSON.stringify(history));
    assert.deepEqual(await loadHistory(file, { password: 'correct horse battery' }), { history, salt: null });
    // The same password keeps the salt; a new one opens the file through the previous one and drops it.
    await fs.writeFile(file, JSON.stringify(sealed));
    assert.equal((await loadHistory(file, { password: 'correct horse battery' })).salt, sealed.kdf.salt);
    assert.deepEqual(await loadHistory(file, { password: 'a brand new phrase', previous: 'correct horse battery' }), { history, salt: null });
    await assert.rejects(loadHistory(file, { password: 'a brand new phrase' }), /does not open/);
    assert.throws(() => checkPassword('short'), /12 characters/);
    assert.throws(() => checkPassword(null), /NETWORTH_PASSWORD/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a snapshot syncs transactions and advances the private cursor', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'net-worth-transactions-'));
  const item = { id: 'item-1', accessToken: 'token', kind: 'bank', institution: 'Bank' };
  let request;
  const plaid = {
    accountsGet: async () => ({ data: { accounts: [account('depository', 'checking', 100, { account_id: 'account-1' })] } }),
    transactionsSync: async (body) => {
      request = body;
      return {
        data: {
          added: [{ transaction_id: 'transaction-1', account_id: 'account-1', date: '2026-11-04', name: 'Coffee', amount: 4.25, category: ['Food and Drink'], pending: false }],
          modified: [], removed: [], next_cursor: 'cursor-1', has_more: false,
        },
      };
    },
  };
  try {
    const updated = [];
    const result = await takeSnapshot({
      plaid, items: [item], source: 'sandbox', timeZone: 'America/New_York', file: path.join(dir, 'public', 'networth.json'),
      password: PASSWORD, now: new Date('2026-11-04T12:00:00Z'), updateItems: async (items) => updated.push(items),
    });
    assert.equal(result.history.transactions[0].name, 'Coffee');
    assert.deepEqual(request, { access_token: 'token' });
    assert.equal(updated[0][0].transactionCursor, 'cursor-1');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('one failing connection fails the whole read', async () => {
  const plaid = { accountsGet: async ({ access_token }) => { if (access_token === 'bad') throw plaidFailure('ITEM_LOGIN_REQUIRED'); return { data: { accounts: [] } }; } };
  await assert.rejects(readAccounts(plaid, [{ accessToken: 'ok', institution: 'One' }, { accessToken: 'bad', institution: 'Two' }]), (err) => {
    assert.deepEqual(err.failures.map((f) => [f.index, f.institution, f.code]), [[1, 'Two', 'ITEM_LOGIN_REQUIRED']]);
    return true;
  });
});

test('a bank that is briefly down is tried again, and an expired login is not', async () => {
  const tries = {};
  const plaid = {
    accountsGet: async ({ access_token }) => {
      tries[access_token] = (tries[access_token] || 0) + 1;
      if (access_token === 'flaky' && tries.flaky < 3) throw plaidFailure('INSTITUTION_NOT_RESPONDING');
      if (access_token === 'down') throw plaidFailure('INSTITUTION_DOWN');
      if (access_token === 'expired') throw plaidFailure('ITEM_LOGIN_REQUIRED');
      return { data: { accounts: [account('depository', 'checking', 10)] } };
    },
  };
  const wait = async () => {};
  assert.equal((await readAccounts(plaid, [{ accessToken: 'flaky' }], { wait })).length, 1);
  await assert.rejects(readAccounts(plaid, [{ accessToken: 'down' }, { accessToken: 'expired' }], { wait }));
  assert.deepEqual(tries, { flaky: 3, down: 3, expired: 1 });
});

// The API, over real HTTP, with a fake Plaid behind it.
let root, server, port;
const calls = [];
const fake = {
  failing: false,
  linkTokenCreate: async (req) => { calls.push(['linkTokenCreate', req]); return { data: { link_token: 'link-sandbox-123' } }; },
  itemPublicTokenExchange: async (req) => { calls.push(['exchange', req]); return { data: { item_id: 'item-1', access_token: 'access-sandbox-SECRET' } }; },
  itemRemove: async (req) => { calls.push(['remove', req]); return { data: {} }; },
  accountsGet: async () => {
    if (fake.failing) throw plaidFailure('ITEM_LOGIN_REQUIRED');
    return { data: { accounts: [account('depository', 'checking', 2500.4), account('investment', 'roth', 8000), account('credit', 'credit card', 700.25)] } };
  },
};

before(async () => {
  for (const key of ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'PLAID_ENV', 'PLAID_ACCESS_TOKENS', 'NETWORTH_PASSWORD', 'NETWORTH_PREVIOUS_PASSWORD']) delete process.env[key];
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'net-worth-'));
  await fs.writeFile(path.join(root, '.env'), `PLAID_CLIENT_ID=test-id\nPLAID_SECRET=test-secret\nPLAID_ENV=sandbox\nNETWORTH_PASSWORD=${PASSWORD}\n`);
  const api = createApi({ root, client: () => fake });
  server = http.createServer((req, res) => api(req, res)).listen(0);
  port = server.address().port;
});
after(async () => {
  server.close();
  await fs.rm(root, { recursive: true, force: true });
});

function call(method, url, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port, method, path: `/api${url}`, headers: { host: `localhost:${port}`, ...(method === 'GET' ? {} : { 'x-requested-by': 'net-worth', 'content-type': 'application/json' }), ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, text, json: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test('requests from anywhere but this page are refused', async () => {
  assert.equal((await call('GET', '/status', { headers: { origin: 'https://example.com' } })).status, 403);
  assert.equal((await call('GET', '/status', { headers: { host: 'attacker.example:80' } })).status, 403);
  assert.equal((await call('POST', '/snapshot', { headers: { 'x-requested-by': '' } })).status, 403);
  assert.equal((await call('GET', '/status', { headers: { origin: `http://localhost:${port}` } })).status, 200);
});

test('connecting a bank asks Plaid for transactions, with the rest optional', async () => {
  const res = await call('POST', '/link-token', { body: { kind: 'bank' } });
  assert.equal(res.json.linkToken, 'link-sandbox-123');
  const [, req] = calls.findLast(([name]) => name === 'linkTokenCreate');
  assert.deepEqual(req.products, ['transactions']);
  assert.deepEqual(req.optional_products, ['investments', 'liabilities']);
  assert.equal(req.access_token, undefined);
  assert.equal((await call('POST', '/link-token', { body: { kind: 'crypto' } })).status, 400);
});

test('a new connection is stored privately and its token never leaves the server', async () => {
  const res = await call('POST', '/items', { body: { publicToken: 'public-sandbox-1', institution: { name: 'First Platypus Bank', institution_id: 'ins_109508' }, kind: 'bank', linkSessionId: 'session-1' } });
  assert.equal(res.json.id, 'item-1');
  const file = path.join(root, 'data', 'items.sandbox.json');
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const [stored] = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(stored.accessToken, 'access-sandbox-SECRET');
  assert.equal(stored.linkSessionId, 'session-1');

  const status = await call('GET', '/status');
  assert.ok(!status.text.includes('access-sandbox-SECRET'));
  assert.equal(status.json.connections[0].institution, 'First Platypus Bank');
  assert.deepEqual(status.json.connections[0].accounts.map((a) => a.category), ['cash', 'retirement', 'credit']);
  assert.deepEqual(status.json.preview.totals, { cash: 2500, investments: 0, retirement: 8000, other: 0, credit: 700, loans: 0 });
});

test('reconnecting uses update mode on the same connection', async () => {
  await call('POST', '/link-token', { body: { itemId: 'item-1' } });
  const [, req] = calls.findLast(([name]) => name === 'linkTokenCreate');
  assert.equal(req.access_token, 'access-sandbox-SECRET');
  assert.equal(req.products, undefined);
});

test('a snapshot saves the totals, and a failing bank saves nothing', async () => {
  const res = await call('POST', '/snapshot');
  assert.equal(res.status, 200);
  const file = path.join(root, 'public', 'networth.json');
  const saved = await fs.readFile(file, 'utf8');
  // The file is sealed: nothing in it reads without the password.
  assert.ok(isSealed(JSON.parse(saved)) && !saved.includes('days') && !saved.includes('sandbox'));
  const { history } = await open(JSON.parse(saved), { password: PASSWORD });
  assert.equal(history.source, 'sandbox');
  assert.equal(history.days.at(-1).cash, 2500);
  // Types are published ('cash.checking'); bank and account names ('checking account') never are.
  assert.ok(!JSON.stringify(history).includes('First Platypus') && !JSON.stringify(history).includes(' account'));
  assert.deepEqual(history.days.at(-1).types, { 'cash.checking': 2500, 'retirement.roth': 8000, 'credit.credit card': 700 });
  assert.equal((await call('GET', '/status')).json.history.count, 1);

  fake.failing = true;
  const failed = await call('POST', '/snapshot');
  fake.failing = false;
  assert.equal(failed.status, 502);
  assert.deepEqual(failed.json.failures.map((f) => [f.institution, f.code]), [['First Platypus Bank', 'ITEM_LOGIN_REQUIRED']]);
  assert.equal(await fs.readFile(file, 'utf8'), saved);
});

test('removing a connection tells Plaid and forgets the token', async () => {
  const res = await call('DELETE', '/items/item-1');
  assert.equal(res.json.removed, 'item-1');
  assert.deepEqual(calls.findLast(([name]) => name === 'remove')[1], { access_token: 'access-sandbox-SECRET' });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'data', 'items.sandbox.json'), 'utf8')), []);
});
