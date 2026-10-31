// The Plaid client, built from the keys in .env (or, in GitHub Actions, from the repository's secrets).
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

// .env read fresh on every call, so a key pasted in while the dev server runs takes effect at once.
// Variables already set in the environment win, as they do in CI.
export function readEnv(root) {
  let file = {};
  try {
    file = parseEnv(fs.readFileSync(path.join(root, '.env'), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return { ...file, ...process.env };
}

export function plaidSettings(env) {
  const mode = (env.PLAID_ENV || 'sandbox').trim().toLowerCase();
  if (!PlaidEnvironments[mode]) throw new Error(`PLAID_ENV must be sandbox or production, not "${mode}".`);
  const clientId = env.PLAID_CLIENT_ID?.trim(), secret = env.PLAID_SECRET?.trim();
  return {
    mode, clientId, secret, ready: Boolean(clientId && secret), timeZone: env.SNAPSHOT_TZ?.trim() || 'America/New_York',
    // The page's password, which encrypts the published figures, and the old one for the snapshot after a change.
    password: env.NETWORTH_PASSWORD?.trim() || null, previousPassword: env.NETWORTH_PREVIOUS_PASSWORD?.trim() || null,
  };
}

export function plaidClient({ mode, clientId, secret }) {
  return new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[mode],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret } },
  }));
}

// Plaid's errors arrive as axios errors whose request carries the keys, so only Plaid's own code and
// message are kept; the raw error is never logged or sent on.
export function plaidError(err) {
  const data = err?.response?.data;
  if (data?.error_code) return { code: data.error_code, message: data.display_message || data.error_message };
  return { code: 'UNREACHABLE', message: 'Plaid could not be reached.' };
}
