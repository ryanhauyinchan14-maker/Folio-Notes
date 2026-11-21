import type { EncryptedPayload, VaultMetadata, WrappedKeyBlob } from '../types/notes';

const VAULT_STORAGE_KEY = 'goodnotes_vault_config';
export const DEFAULT_PBKDF2_ITERATIONS = 250_000;

// Base32-inspired alphabet excluding ambiguous characters (0/O, 1/I/L)
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function getCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('Web Crypto API (crypto.subtle) is not available in this environment.');
  }
  return c;
}

function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    chunks.push(String.fromCharCode(...slice));
  }
  return btoa(chunks.join(''));
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function arrayBufferToBase64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return bytesToBase64(bytes);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bytes = base64ToBytes(b64);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function generateRecoveryKey(): string {
  const crypto = getCrypto();
  const alphabetLen = RECOVERY_ALPHABET.length;
  const maxValid = 256 - (256 % alphabetLen);
  const chars: string[] = [];

  while (chars.length < 16) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && chars.length < 16; i++) {
      if (buf[i] < maxValid) {
        chars.push(RECOVERY_ALPHABET[buf[i] % alphabetLen]);
      }
    }
  }

  return `FOLIO-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars
    .slice(8, 12)
    .join('')}-${chars.slice(12, 16).join('')}`;
}

export function parseRecoveryKeyInput(raw: string): string | null {
  const upper = raw.toUpperCase();
  const formatted = upper.match(/FOLIO-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
  if (formatted) {
    return formatted[0];
  }

  // Fallback for pasted key without dashes
  const stripped = upper.replace(/[^A-Z0-9]/g, '');
  if (stripped.startsWith('FOLIO') && stripped.length === 21) {
    const body = stripped.slice(5);
    return `FOLIO-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
  }

  return null;
}

export function buildRecoveryKeyFileText(recoveryKey: string): string {
  return [
    'Folio Notes — Offline Vault Recovery Key',
    '========================================',
    '',
    'Keep this Recovery Key in a safe place (e.g., password manager or printed offline).',
    'If you forget your Vault Password, you can use this Recovery Key to unlock your',
    'encrypted notebooks and set a new Vault Password locally—no cloud services involved.',
    '',
    `Recovery Key: ${recoveryKey}`,
    `Generated: ${new Date().toISOString()}`,
    '',
  ].join('\n');
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Too short' | 'Weak' | 'Fair' | 'Good' | 'Strong';
}

export function evaluatePasswordStrength(password: string): PasswordStrength {
  if (password.length < 6) {
    return { score: 0, label: 'Too short' };
  }
  let points = 0;
  if (password.length >= 8) points++;
  if (password.length >= 12) points++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) points++;
  if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) points++;

  if (points <= 1) return { score: 1, label: 'Weak' };
  if (points === 2) return { score: 2, label: 'Fair' };
  if (points === 3) return { score: 3, label: 'Good' };
  return { score: 4, label: 'Strong' };
}

export function getVaultMetadata(): VaultMetadata | null {
  try {
    const raw = globalThis.localStorage?.getItem(VAULT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VaultMetadata;
    if (
      parsed &&
      parsed.version === 1 &&
      parsed.passwordWrapped?.wrappedKey &&
      parsed.recoveryWrapped?.wrappedKey
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function hasVaultSetup(): boolean {
  return getVaultMetadata() !== null;
}

export function saveVaultMetadata(metadata: VaultMetadata): void {
  globalThis.localStorage?.setItem(VAULT_STORAGE_KEY, JSON.stringify(metadata));
}

export function clearVaultMetadata(): void {
  globalThis.localStorage?.removeItem(VAULT_STORAGE_KEY);
}

async function deriveWrappingKey(
  secret: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const crypto = getCrypto();
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    usages,
  );
}

export async function wrapMasterKeyWithSecret(
  masterKey: CryptoKey,
  secret: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<WrappedKeyBlob> {
  const crypto = getCrypto();
  const salt = new Uint8Array(16);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(salt);
  crypto.getRandomValues(iv);

  const kek = await deriveWrappingKey(secret, salt, iterations, ['wrapKey']);
  const wrapped = await crypto.subtle.wrapKey('raw', masterKey, kek, {
    name: 'AES-GCM',
    iv,
  });

  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    wrappedKey: bytesToBase64(new Uint8Array(wrapped)),
    iterations,
  };
}

export async function unwrapMasterKeyWithSecret(
  blob: WrappedKeyBlob,
  secret: string,
  extractable = false,
): Promise<CryptoKey> {
  const crypto = getCrypto();
  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const wrappedKeyBytes = base64ToBytes(blob.wrappedKey);

  const kek = await deriveWrappingKey(secret, salt, blob.iterations, ['unwrapKey']);
  return crypto.subtle.unwrapKey(
    'raw',
    wrappedKeyBytes,
    kek,
    {
      name: 'AES-GCM',
      iv,
    },
    {
      name: 'AES-GCM',
      length: 256,
    },
    extractable,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Generates a fresh 256-bit Master Key and stores two wrapped copies in localStorage:
 * 1) Wrapped with the user's Vault Password
 * 2) Wrapped with the generated Recovery Key
 */
export async function initializeVault(
  password: string,
  recoveryKey: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): Promise<{ masterKey: CryptoKey; metadata: VaultMetadata }> {
  const crypto = getCrypto();
  const extractableMaster = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );

  const [passwordWrapped, recoveryWrapped] = await Promise.all([
    wrapMasterKeyWithSecret(extractableMaster, password, iterations),
    wrapMasterKeyWithSecret(extractableMaster, recoveryKey, iterations),
  ]);

  const now = Date.now();
  const metadata: VaultMetadata = {
    version: 1,
    createdAt: now,
    updatedAt: now,
    passwordWrapped,
    recoveryWrapped,
  };
  saveVaultMetadata(metadata);

  // Return a non-extractable runtime handle for safer in-memory use
  const runtimeKey = await unwrapMasterKeyWithSecret(passwordWrapped, password, false);
  return { masterKey: runtimeKey, metadata };
}

export async function unlockMasterKeyWithPassword(
  password: string,
  extractable = false,
): Promise<CryptoKey> {
  const meta = getVaultMetadata();
  if (!meta) {
    throw new Error('Vault has not been set up yet.');
  }
  return unwrapMasterKeyWithSecret(meta.passwordWrapped, password, extractable);
}

export async function unlockMasterKeyWithRecoveryKey(
  rawRecoveryInput: string,
  extractable = false,
): Promise<CryptoKey> {
  const meta = getVaultMetadata();
  if (!meta) {
    throw new Error('Vault has not been set up yet.');
  }
  const normalized = parseRecoveryKeyInput(rawRecoveryInput);
  if (!normalized) {
    throw new Error('Invalid Recovery Key format. Expected FOLIO-XXXX-XXXX-XXXX-XXXX.');
  }
  return unwrapMasterKeyWithSecret(meta.recoveryWrapped, normalized, extractable);
}

export async function resetVaultPasswordWithRecoveryKey(
  rawRecoveryInput: string,
  newPassword: string,
): Promise<CryptoKey> {
  const meta = getVaultMetadata();
  if (!meta) {
    throw new Error('Vault has not been set up yet.');
  }
  const extractableMaster = await unlockMasterKeyWithRecoveryKey(rawRecoveryInput, true);
  const passwordWrapped = await wrapMasterKeyWithSecret(
    extractableMaster,
    newPassword,
    meta.passwordWrapped.iterations,
  );
  saveVaultMetadata({
    ...meta,
    updatedAt: Date.now(),
    passwordWrapped,
  });
  return unwrapMasterKeyWithSecret(passwordWrapped, newPassword, false);
}

export async function changeVaultPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const meta = getVaultMetadata();
  if (!meta) {
    throw new Error('Vault has not been set up yet.');
  }
  const extractableMaster = await unlockMasterKeyWithPassword(currentPassword, true);
  const passwordWrapped = await wrapMasterKeyWithSecret(
    extractableMaster,
    newPassword,
    meta.passwordWrapped.iterations,
  );
  saveVaultMetadata({
    ...meta,
    updatedAt: Date.now(),
    passwordWrapped,
  });
}

export async function regenerateVaultRecoveryKey(
  currentPassword: string,
): Promise<string> {
  const meta = getVaultMetadata();
  if (!meta) {
    throw new Error('Vault has not been set up yet.');
  }
  const extractableMaster = await unlockMasterKeyWithPassword(currentPassword, true);
  const newRecoveryKey = generateRecoveryKey();
  const recoveryWrapped = await wrapMasterKeyWithSecret(
    extractableMaster,
    newRecoveryKey,
    meta.recoveryWrapped.iterations,
  );
  saveVaultMetadata({
    ...meta,
    updatedAt: Date.now(),
    recoveryWrapped,
  });
  return newRecoveryKey;
}

export async function encryptJsonPayload<T>(
  data: T,
  masterKey: CryptoKey,
): Promise<EncryptedPayload> {
  const crypto = getCrypto();
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    encoded,
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipherBuf)),
  };
}

export async function decryptJsonPayload<T>(
  payload: EncryptedPayload,
  masterKey: CryptoKey,
): Promise<T> {
  const crypto = getCrypto();
  const iv = base64ToBytes(payload.iv);
  const cipherBytes = base64ToBytes(payload.ciphertext);
  const plainBuf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    cipherBytes,
  );
  const json = new TextDecoder().decode(plainBuf);
  return JSON.parse(json) as T;
}

export async function encryptBinaryPayload(
  data: ArrayBuffer | Uint8Array,
  masterKey: CryptoKey,
): Promise<EncryptedPayload> {
  const crypto = getCrypto();
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const rawBytes =
    data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data;
  const cipherBuf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    rawBytes as ArrayBuffer,
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: '',
    cipherBuffer: cipherBuf,
  };
}

export async function decryptBinaryPayload(
  payload: EncryptedPayload,
  masterKey: CryptoKey,
): Promise<ArrayBuffer> {
  const crypto = getCrypto();
  const iv = base64ToBytes(payload.iv);
  const cipherData: ArrayBuffer =
    payload.cipherBuffer ?? base64ToBytes(payload.ciphertext).buffer;
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    masterKey,
    cipherData,
  );
}
