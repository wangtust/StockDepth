import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Reserved prefix: never treat a malformed/future envelope as a legacy API key.
const prefix = 'sdkey:';
const context = 'stockdepth:model-api-key';
type Environment = Record<string, string | undefined>;
function fail(): never { throw new Error('Model key unavailable or invalid'); }
function decode(value: string, length?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return fail();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value || (length !== undefined && bytes.length !== length)) return fail();
  return bytes;
}
function keyFor(id: string, env: Environment): Buffer {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return fail();
  try {
    const ring = JSON.parse(env.STOCKDEPTH_MODEL_KEYRING || '{}');
    if (!ring || typeof ring !== 'object' || Array.isArray(ring) || !Object.hasOwn(ring, id) || typeof ring[id] !== 'string') return fail();
    return decode(ring[id], 32);
  } catch { return fail(); }
}
export function encryptModelKey(plaintext: string, env: Environment = process.env): string {
  if (!plaintext || plaintext.length > 1000 || plaintext.startsWith(prefix)) return fail();
  const id = env.STOCKDEPTH_MODEL_KEY_ID || '';
  const key = keyFor(id, env);
  const nonce = randomBytes(12);
  const header = `${prefix}v1:${id}`;
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(`${context}:${header}`));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${header}:${nonce.toString('base64url')}:${ciphertext.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}`;
}
export function decryptModelKey(stored: string, env: Environment = process.env): string {
  if (!stored.startsWith(prefix)) return stored; // staged legacy dual-read
  try {
    const parts = stored.split(':');
    if (parts.length !== 6 || parts[1] !== 'v1' || stored.length > 4096) return fail();
    const [, , id, nonce, ciphertext, tag] = parts;
    const decipher = createDecipheriv('aes-256-gcm', keyFor(id, env), decode(nonce, 12));
    decipher.setAAD(Buffer.from(`${context}:${prefix}v1:${id}`));
    decipher.setAuthTag(decode(tag, 16));
    const plaintext = Buffer.concat([decipher.update(decode(ciphertext)), decipher.final()]).toString('utf8');
    if (!plaintext || plaintext.length > 1000 || plaintext.startsWith(prefix)) return fail();
    return plaintext;
  } catch { return fail(); }
}
export function readModelConfig<T extends { apiKey: string }>(config: T): T {
  return { ...config, apiKey: decryptModelKey(config.apiKey) };
}
export function modelConfigWrite<T extends { apiKey: string }>(config: T): T {
  return { ...config, apiKey: encryptModelKey(config.apiKey) };
}
export function maskedModelKey(stored: string): string {
  return stored ? 'configured' : 'not set';
}
