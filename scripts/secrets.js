// npm run secrets: gives the daily GitHub Action what it needs to take snapshots on its own: the Plaid keys
// and the access tokens of the connections made on this computer. Run it in the repository's folder, with
// the GitHub CLI signed in. Each value goes to `gh secret set` on stdin, so none appears in a command line.
import { execFileSync } from 'node:child_process';
import { readEnv, plaidSettings } from '../server/plaid.js';
import { readItems } from '../server/store.js';
import { checkPassword } from '../server/snapshot.js';

const root = process.cwd();
const settings = plaidSettings(readEnv(root));

if (!settings.ready) {
  console.error('Add PLAID_CLIENT_ID and PLAID_SECRET to .env first.');
  process.exit(1);
}
try {
  checkPassword(settings.password);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const items = await readItems(root, settings.mode);
if (!items.length) {
  console.error(`No ${settings.mode} connections yet. Connect an account on the admin page first.`);
  process.exit(1);
}
if (settings.mode !== 'production') {
  console.warn('PLAID_ENV is sandbox: the Action will publish test figures, marked as such on the page.');
}

const secrets = {
  PLAID_CLIENT_ID: settings.clientId,
  PLAID_SECRET: settings.secret,
  PLAID_ENV: settings.mode,
  PLAID_ACCESS_TOKENS: JSON.stringify(items.map(({ institution, accessToken }) => ({ institution, accessToken }))),
  NETWORTH_PASSWORD: settings.password,
};
for (const [name, value] of Object.entries(secrets)) {
  execFileSync('gh', ['secret', 'set', name], { cwd: root, input: value, stdio: ['pipe', 'inherit', 'inherit'] });
}
// Not a secret: the time zone that dates each snapshot, so the Action's days match this computer's.
execFileSync('gh', ['variable', 'set', 'SNAPSHOT_TZ', '--body', settings.timeZone], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
console.log(`Saved ${Object.keys(secrets).length} secrets for ${items.length} connection${items.length === 1 ? '' : 's'}, dated in ${settings.timeZone}. The Action takes a snapshot twice a day.`);
