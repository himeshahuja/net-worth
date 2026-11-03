// On each cron tick, asks GitHub to run the snapshot workflow, as a manual run would. GITHUB_TOKEN is a fine-grained
// token with Actions: Read and write on this repository only, stored with `npx wrangler secret put GITHUB_TOKEN`.
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(dispatch(env));
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
