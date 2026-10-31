// Connected banks and their Plaid access tokens. They stay on this computer, in data/ (gitignored), readable
// by this user only. One file per Plaid environment, because sandbox tokens do not work in production.
//
// An item: { id, accessToken, institution, institutionId, kind: 'bank' | 'investment' | 'loan', added, linkSessionId }
import fs from 'node:fs/promises';
import path from 'node:path';

const fileFor = (root, mode) => path.join(root, 'data', `items.${mode}.json`);

export async function readItems(root, mode) {
  try {
    return JSON.parse(await fs.readFile(fileFor(root, mode), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

export async function writeItems(root, mode, items) {
  const file = fileFor(root, mode);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(items, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(`${file}.tmp`, file);
}
