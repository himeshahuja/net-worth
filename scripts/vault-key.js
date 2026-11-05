// Prints the page's key, the one the Worker hands out after a Google sign-in (VAULT_KEY), for piping straight into
// Cloudflare so it never shows:
//
//   node --env-file=.env scripts/vault-key.js | (cd worker && npx wrangler secret put VAULT_KEY)
//
// It derives the key from NETWORTH_PASSWORD and the published file's salt, and prints it only after it has opened
// public/networth.json with it, so a wrong password stores nothing. Run it after `git pull`, and again after a
// password change once the new file is published.
import fs from 'node:fs/promises';
import { open } from '../src/lib/vault.js';

const file = JSON.parse(await fs.readFile(new URL('../public/networth.json', import.meta.url), 'utf8'));
try {
  process.stdout.write((await open(file, { password: process.env.NETWORTH_PASSWORD ?? '' })).key);
} catch {
  console.error('NETWORTH_PASSWORD in .env does not open public/networth.json, so no key was printed.');
  process.exit(1);
}
