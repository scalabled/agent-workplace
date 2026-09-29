// Connector keys at rest: AES-GCM with a key derived (HKDF-SHA-256) from the CONNECTOR_SECRET Worker secret, bound to
// the connector id as additional data, so a copied ciphertext does not decrypt under another connector. Local mode
// (no sign-in, loopback only) falls back to a fixed development key; a deployed worker without the secret refuses to
// store keys at all.
import type { Env } from '../env';

const DEV_SECRET = 'headcount-local-development-connector-key';
const PREFIX = 'v1:';

export function connectorSecret(env: Pick<Env, 'CONNECTOR_SECRET' | 'AUTH_MODE'>): string | null {
  if (env.CONNECTOR_SECRET && env.CONNECTOR_SECRET.length >= 16) return env.CONNECTOR_SECRET;
  return (env.AUTH_MODE ?? '').toLowerCase() === 'google' ? null : DEV_SECRET;
}

const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyOf(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('headcount/connectors'), info: new TextEncoder().encode('connector-token-v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealToken(secret: string, connectorId: string, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(connectorId) }, await keyOf(secret), new TextEncoder().encode(token));
  return `${PREFIX}${b64(iv)}:${b64(new Uint8Array(ct))}`;
}

/** The token, or null when it cannot be opened (another secret, another connector, tampering). */
export async function openToken(secret: string, connectorId: string, sealed: string): Promise<string | null> {
  if (!sealed.startsWith(PREFIX)) return null;
  const [iv, ct] = sealed.slice(PREFIX.length).split(':');
  if (!iv || !ct) return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(connectorId) }, await keyOf(secret), unb64(ct));
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
