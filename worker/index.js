import { googleKeys, tokenKid, verifyIdToken } from './google.js';

// Two jobs.
// - On each cron tick, asks GitHub to run the snapshot workflow, as a manual run would. GITHUB_TOKEN is a fine-grained
//   token with Actions: Read and write on this repository only, stored with `npx wrangler secret put GITHUB_TOKEN`.
// - POST /unlock hands the page the key to its sealed file, for a "Sign in with Google" by an allowed address only.
//   VAULT_KEY (that key) and ALLOWED_EMAILS (comma-separated) are secrets; see the README.
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env));
  },
  async fetch(request, env) {
    return unlock(request, env);
  },
};

async function dispatch(env) {
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/${env.WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      // Trimmed, as a pasted secret can carry a stray newline or space.
      Authorization: `Bearer ${env.GITHUB_TOKEN?.trim()}`,
      'Content-Type': 'application/json',
      // GitHub's API turns away requests without one.
      'User-Agent': 'net-worth-snapshot',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: env.REF }),
  });
  // A failure shows on the cron event in the Cloudflare dashboard.
  if (!res.ok) throw new Error(`GitHub refused the run: ${res.status} ${await res.text()}`);
}

const list = (value) => (value ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export async function unlock(request, env) {
  const origin = request.headers.get('Origin');
  const cors = list(env.ALLOWED_ORIGINS).includes(origin?.toLowerCase())
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {};
  const reply = (body, status) => Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'no-store' } });

  if (new URL(request.url).pathname !== '/unlock') return reply({ error: 'not-found' }, 404);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ error: 'method' }, 405);
  if (!cors['Access-Control-Allow-Origin']) return reply({ error: 'origin' }, 403);

  const { credential } = await request.json().catch(() => ({}));
  if (typeof credential !== 'string') return reply({ error: 'sign-in' }, 401);
  let keys;
  try {
    keys = await googleKeys(tokenKid(credential));
  } catch {
    return reply({ error: 'google' }, 502);
  }
  const claims = await verifyIdToken(credential, { clientId: env.GOOGLE_CLIENT_ID, keys }).catch(() => null);
  if (!claims) return reply({ error: 'sign-in' }, 401);
  if (claims.email_verified !== true || !list(env.ALLOWED_EMAILS).includes(claims.email?.toLowerCase())) return reply({ error: 'not-allowed' }, 403);
  if (!env.VAULT_KEY) return reply({ error: 'no-key' }, 503);
  return reply({ key: env.VAULT_KEY.trim() }, 200);
}
