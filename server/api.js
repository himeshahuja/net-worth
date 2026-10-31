// The private side: a few JSON routes on the Vite dev server, for the admin page. They answer only requests
// made to this computer by the pages it serves itself, and no response ever carries an access token.
import { readEnv, plaidSettings, plaidClient, plaidError } from './plaid.js';
import { readItems, writeItems } from './store.js';
import { categoryOf, balanceOf, counts, totalsOf, typeOf } from './accounts.js';
import { checkPassword, historyFile, loadHistory, takeSnapshot } from './snapshot.js';

// What the owner says they are connecting picks the Plaid product, and so which institutions Link offers.
// The other two ride along as optional products, so a bank that also holds a brokerage account comes in as
// one connection: the Trial plan allows ten, and removing one does not give it back.
export const PRODUCTS = { bank: 'transactions', investment: 'investments', loan: 'liabilities' };

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    Object.assign(this, { status, extra });
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new HttpError(413, 'That request is too large.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'That request was not JSON.');
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// A page on another site can make a browser send requests here. The host check stops DNS rebinding, the
// origin check stops another site's script, and the custom header keeps a cross-site form from posting.
function trusted(req) {
  const host = req.headers.host || '';
  if (!LOCAL.has(host.replace(/:\d+$/, ''))) return false;
  if (req.headers.origin && req.headers.origin !== `http://${host}`) return false;
  return req.method === 'GET' || req.headers['x-requested-by'] === 'net-worth';
}

export function createApi({ root, client = plaidClient }) {
  async function status({ settings }) {
    // A missing or short password, or one that does not open what is saved, blocks the snapshot until it is fixed.
    let history = null, passwordProblem = null;
    try {
      checkPassword(settings.password);
    } catch (err) {
      passwordProblem = err.message;
    }
    try {
      ({ history } = await loadHistory(historyFile(root), { password: settings.password, previous: settings.previousPassword }));
    } catch (err) {
      passwordProblem ??= err.message;
    }
    const recorded = history && { source: history.source, updated: history.updated, count: history.days.length, last: history.days.at(-1) };
    if (!settings.ready) return { mode: settings.mode, ready: false, connections: [], preview: null, history: recorded, passwordProblem };

    const plaid = client(settings);
    const items = await readItems(root, settings.mode);
    const read = await Promise.all(items.map(async (it) => {
      try {
        return { it, accounts: (await plaid.accountsGet({ access_token: it.accessToken })).data.accounts };
      } catch (err) {
        return { it, error: plaidError(err), accounts: [] };
      }
    }));
    const connections = read.map(({ it, error, accounts }) => ({
      id: it.id,
      institution: it.institution,
      kind: it.kind,
      added: it.added,
      error,
      accounts: accounts.map((a) => ({ id: a.account_id, name: a.name, mask: a.mask, subtype: a.subtype, category: categoryOf(a), type: typeOf(a), balance: balanceOf(a), counts: counts(a) })),
    }));
    // What a snapshot taken now would publish; only when every connection answered, as a snapshot needs.
    const preview = items.length && read.every((r) => !r.error) ? totalsOf(read.flatMap((r) => r.accounts)) : null;
    return { mode: settings.mode, ready: true, connections, preview, history: recorded, passwordProblem };
  }

  async function linkToken({ settings, body }) {
    const plaid = client(settings);
    const request = { user: { client_user_id: 'owner' }, client_name: 'Net worth', country_codes: ['US'], language: 'en' };
    if (body.itemId) {
      // Update mode: the owner signs in to the same connection again; no new Item is made.
      const it = (await readItems(root, settings.mode)).find((i) => i.id === body.itemId);
      if (!it) throw new HttpError(404, 'That connection is no longer here.');
      request.access_token = it.accessToken;
    } else {
      const product = PRODUCTS[body.kind];
      if (!product) throw new HttpError(400, 'Choose a bank, investment or loan account.');
      request.products = [product];
      request.optional_products = Object.values(PRODUCTS).filter((p) => p !== product);
    }
    try {
      return { linkToken: (await plaid.linkTokenCreate(request)).data.link_token };
    } catch (err) {
      // A team without access to an optional product still gets the product it asked for.
      if (!request.optional_products || !/^INVALID_(FIELD|PRODUCT)$/.test(plaidError(err).code)) throw err;
      delete request.optional_products;
      return { linkToken: (await plaid.linkTokenCreate(request)).data.link_token };
    }
  }

  async function addItem({ settings, body }) {
    if (typeof body.publicToken !== 'string' || !PRODUCTS[body.kind]) throw new HttpError(400, 'That connection was incomplete.');
    const { data } = await client(settings).itemPublicTokenExchange({ public_token: body.publicToken });
    const items = await readItems(root, settings.mode);
    items.push({
      id: data.item_id,
      accessToken: data.access_token,
      institution: String(body.institution?.name || 'Bank').slice(0, 80),
      institutionId: body.institution?.institution_id ?? null,
      kind: body.kind,
      added: new Date().toISOString(),
      // Plaid support finds a connection's Link session by this ID; Link reports it only here.
      linkSessionId: typeof body.linkSessionId === 'string' ? body.linkSessionId.slice(0, 64) : null,
    });
    await writeItems(root, settings.mode, items);
    return { id: data.item_id };
  }

  async function removeItem({ settings, id }) {
    const items = await readItems(root, settings.mode);
    const it = items.find((i) => i.id === id);
    if (!it) throw new HttpError(404, 'That connection is no longer here.');
    try {
      await client(settings).itemRemove({ access_token: it.accessToken });
    } catch (err) {
      // Already gone at Plaid's end: forget it here too.
      if (!['ITEM_NOT_FOUND', 'INVALID_ACCESS_TOKEN'].includes(plaidError(err).code)) throw err;
    }
    await writeItems(root, settings.mode, items.filter((i) => i !== it));
    return { removed: id };
  }

  async function snapshot({ settings }) {
    const items = await readItems(root, settings.mode);
    try {
      const { history, skipped } = await takeSnapshot({ plaid: client(settings), items, source: settings.mode, timeZone: settings.timeZone, file: historyFile(root), password: settings.password, previous: settings.previousPassword });
      return { day: history.days.at(-1), accounts: history.accounts, skipped };
    } catch (err) {
      if (err.failures) throw new HttpError(502, err.message, { failures: err.failures.map(({ institution, code, message }) => ({ institution, code, message })) });
      throw err;
    }
  }

  return async function api(req, res) {
    try {
      if (!trusted(req)) throw new HttpError(403, 'Only this computer can use this page.');
      const route = `${req.method} ${req.url.replace(/^\/api/, '').split('?')[0]}`;
      const settings = plaidSettings(readEnv(root));
      if (route === 'GET /status') return send(res, 200, await status({ settings }));
      if (!settings.ready) throw new HttpError(409, 'Add your Plaid keys to .env first.');
      const body = req.method === 'POST' ? await readBody(req) : {};
      if (route === 'POST /link-token') return send(res, 200, await linkToken({ settings, body }));
      if (route === 'POST /items') return send(res, 200, await addItem({ settings, body }));
      if (route === 'POST /snapshot') return send(res, 200, await snapshot({ settings }));
      const remove = route.match(/^DELETE \/items\/([\w-]+)$/);
      if (remove) return send(res, 200, await removeItem({ settings, id: remove[1] }));
      throw new HttpError(404, 'No such route.');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...err.extra });
      const plaid = plaidError(err);
      if (err?.response) return send(res, 502, { error: plaid.message, code: plaid.code });
      return send(res, 500, { error: err.message });
    }
  };
}

// Mounted on the dev server only: a build has no server side at all.
export function netWorthApi() {
  return {
    name: 'net-worth-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api', createApi({ root: server.config.root }));
    },
  };
}
