// The published history, encrypted with a password, so networth.json reads as noise without it. AES-256-GCM with a
// key derived from the password by PBKDF2 (SHA-256, 600,000 rounds). Web Crypto only, so the snapshot (Node) seals
// with the same code the page (browser) opens with.
//
// A sealed file: { encrypted: 'AES-256-GCM', kdf: { name, hash, iterations, salt }, iv, data }, all base64.

const ITERATIONS = 600_000;

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export const isSealed = (file) => file?.encrypted === 'AES-256-GCM';

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256));
}
const aesKey = (raw, use) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [use]);

// A fresh IV every time. The salt is kept from the last file while the password stays the same, so a browser that
// remembered the key can open the next day's file without asking again.
export async function seal(history, password, salt) {
  const saltBytes = salt ? fromBase64(salt) : crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(await deriveKey(password, saltBytes, ITERATIONS), 'encrypt');
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(history)));
  return {
    encrypted: 'AES-256-GCM',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: toBase64(saltBytes) },
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)),
  };
}

// Opens a sealed file with the password, or with the key remembered from an earlier opening (base64). Returns the
// history and that key; throws when the password or key is wrong.
export async function open(file, { password, key }) {
  const raw = key ? fromBase64(key) : await deriveKey(password, fromBase64(file.kdf.salt), file.kdf.iterations);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(file.iv) }, await aesKey(raw, 'decrypt'), fromBase64(file.data));
  return { history: JSON.parse(new TextDecoder().decode(plain)), key: toBase64(raw) };
}
