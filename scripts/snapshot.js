// npm run snapshot: reads every connected account through Plaid and saves today as one day in
// public/networth.json, encrypted with NETWORTH_PASSWORD. On this computer it uses the connections in data/; in
// GitHub Actions, the PLAID_ACCESS_TOKENS secret. Action logs on a public repository are public, so in CI a failing
// connection is named by its position, never by its bank, and the figure itself is never printed.
import { readEnv, plaidSettings, plaidClient } from '../server/plaid.js';
import { readItems } from '../server/store.js';
import { dispatchOf, historyFile, takeSnapshot } from '../server/snapshot.js';
import { net } from '../src/lib/networth.js';
import { money } from '../src/lib/format.js';

const root = process.cwd();
const env = readEnv(root);

function tokensFromSecret(json) {
  const list = JSON.parse(json);
  return list.map((entry) => (typeof entry === 'string' ? { accessToken: entry } : entry));
}

try {
  const settings = plaidSettings(env);
  if (!settings.ready) throw new Error('Add PLAID_CLIENT_ID and PLAID_SECRET to .env first.');
  const items = env.PLAID_ACCESS_TOKENS ? tokensFromSecret(env.PLAID_ACCESS_TOKENS) : await readItems(root, settings.mode);
  const { history, skipped } = await takeSnapshot({ plaid: plaidClient(settings), items, source: settings.mode, timeZone: settings.timeZone, file: historyFile(root), password: settings.password, previous: settings.previousPassword, dispatch: dispatchOf(env) });
  const day = history.days.at(-1);
  const figure = process.env.CI ? '' : `: net worth ${money(net(day))}`;
  console.log(`Saved ${day.date}${figure} across ${history.accounts} accounts (${settings.mode}), encrypted.`);
  if (skipped) console.log(`Left out ${skipped} account${skipped === 1 ? '' : 's'} without a US dollar balance.`);
} catch (err) {
  console.error(err.message);
  for (const f of err.failures || []) {
    console.error(`  ${process.env.CI ? `Connection ${f.index + 1}` : f.institution}: ${f.code}`);
  }
  if (err.failures) console.error('Nothing was saved. Reconnect on the admin page (npm run dev), then try again.');
  process.exitCode = 1;
}
