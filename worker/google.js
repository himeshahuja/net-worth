// Checks a "Sign in with Google" ID token: Google's signature, issued for this page's OAuth client, not expired.
// Returns its claims, or null. The keys are Google's published signing keys (a JWKS), passed in so tests can use
// their own.

const text = (part) => new TextDecoder().decode(bytes(part));
const bytes = (part) => Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export async function verifyIdToken(token, { clientId, keys, now = Date.now() / 1000 }) {
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) return null;
  let header, claims;
  try {
    header = JSON.parse(text(parts[0]));
    claims = JSON.parse(text(parts[1]));
  } catch {
    return null;
  }
  const jwk = header.alg === 'RS256' && keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), signed))) return null;
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') return null;
  if (claims.aud !== clientId) return null;
  // A minute of leeway for clocks that disagree.
  if (!(claims.exp + 60 > now) || !(claims.iat - 60 < now)) return null;
  return claims;
}

let cache = { keys: [], until: 0 };

// Google rotates its keys every few weeks and says how long each copy may be kept; refetch early if a token names
// a key this copy doesn't have.
export async function googleKeys(kid) {
  if (Date.now() < cache.until && (!kid || cache.keys.some((k) => k.kid === kid))) return cache.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error(`Google's signing keys: ${res.status}`);
  const age = Number(res.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 3600);
  cache = { keys: (await res.json()).keys, until: Date.now() + age * 1000 };
  return cache.keys;
}

export const tokenKid = (token) => {
  try {
    return JSON.parse(text(token.split('.')[0])).kid;
  } catch {
    return undefined;
  }
};
