import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlock } from './index.js';

// A stand-in for Google: its own signing key, served as Google's JWKS.
const CLIENT = 'client-123.apps.googleusercontent.com';
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
globalThis.fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'cache-control': 'public, max-age=60' } });

const b64url = (data) => btoa(String.fromCharCode(...new Uint8Array(data))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
async function token(claims = {}, { key = pair.privateKey, kid = 'k1' } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${enc({ alg: 'RS256', kid, typ: 'JWT' })}.${enc({ iss: 'https://accounts.google.com', aud: CLIENT, email: 'owner@example.com', email_verified: true, iat: now, exp: now + 3600, ...claims })}`;
  return `${body}.${b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(body)))}`;
}

const env = { GOOGLE_CLIENT_ID: CLIENT, ALLOWED_EMAILS: 'Owner@Example.com, friend@example.com', ALLOWED_ORIGINS: 'https://himeshahuja.github.io', VAULT_KEY: 'a2V5\n' };
const ask = (credential, { origin = 'https://himeshahuja.github.io', method = 'POST', path = '/unlock', vars = env } = {}) =>
  unlock(new Request(`https://w.example${path}`, { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify({ credential }) : undefined }), vars);

test('an allowed, verified Google account gets the key, with CORS for the page', async () => {
  const res = await ask(await token());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { key: 'a2V5' });
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://himeshahuja.github.io');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('every other sign-in is turned away without the key', async () => {
  const cases = {
    'another address': [await token({ email: 'stranger@example.com' }), 403],
    'an unverified address': [await token({ email_verified: false }), 403],
    'a token for another site': [await token({ aud: 'someone-else' }), 401],
    'an expired token': [await token({ exp: Math.floor(Date.now() / 1000) - 600 }), 401],
    'a token not from Google': [await token({ iss: 'https://evil.example' }), 401],
    'a forged signature': [await token({}, { key: other.privateKey }), 401],
    'an unknown signing key': [await token({}, { kid: 'k9' }), 401],
    'garbage': ['not.a.token', 401],
    'nothing': [undefined, 401],
  };
  for (const [name, [credential, status]] of Object.entries(cases)) {
    const res = await ask(credential);
    assert.equal(res.status, status, name);
    assert.ok(!('key' in (await res.json())), `${name} must not get the key`);
  }
});

test('only the page may ask, only by POST to /unlock', async () => {
  assert.equal((await ask(await token(), { origin: 'https://evil.example' })).status, 403);
  assert.equal((await ask(undefined, { method: 'GET' })).status, 405);
  assert.equal((await ask(await token(), { path: '/' })).status, 404);
  const pre = await ask(undefined, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-methods'), 'POST');
});

test('no key configured is an error, not an empty key', async () => {
  const res = await ask(await token(), { vars: { ...env, VAULT_KEY: undefined } });
  assert.equal(res.status, 503);
});
