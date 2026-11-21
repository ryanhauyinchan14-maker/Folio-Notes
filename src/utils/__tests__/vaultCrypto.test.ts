// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildRecoveryKeyFileText,
  changeVaultPassword,
  clearVaultMetadata,
  decryptJsonPayload,
  encryptJsonPayload,
  evaluatePasswordStrength,
  generateRecoveryKey,
  getVaultMetadata,
  initializeVault,
  parseRecoveryKeyInput,
  regenerateVaultRecoveryKey,
  resetVaultPasswordWithRecoveryKey,
  unlockMasterKeyWithPassword,
} from '../vaultCrypto';

// Lightweight localStorage polyfill for Node environment
const memStorage = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() {
    return memStorage.size;
  },
  clear: () => memStorage.clear(),
  getItem: (k: string) => memStorage.get(k) ?? null,
  setItem: (k: string, v: string) => {
    memStorage.set(k, v);
  },
  removeItem: (k: string) => {
    memStorage.delete(k);
  },
  key: (i: number) => Array.from(memStorage.keys())[i] ?? null,
};

describe('vaultCrypto (Web Crypto PBKDF2 + AES-GCM-256)', () => {
  beforeEach(() => {
    clearVaultMetadata();
  });

  it('generates and parses FOLIO-XXXX-XXXX-XXXX-XXXX recovery keys cleanly', () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^FOLIO-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

    const txtFile = buildRecoveryKeyFileText(key);
    expect(parseRecoveryKeyInput(txtFile)).toBe(key);
    expect(parseRecoveryKeyInput(key.replace(/-/g, '').toLowerCase())).toBe(key);
  });

  it('evaluates password strength levels accurately', () => {
    expect(evaluatePasswordStrength('abc').score).toBe(0);
    expect(evaluatePasswordStrength('abcdef').score).toBe(1);
    expect(evaluatePasswordStrength('MySecretPass99!').score).toBe(4);
  });

  it('wraps Master Key with both Password and Recovery Key, encrypts payloads, and supports password reset', async () => {
    const recoveryKey = generateRecoveryKey();
    const initialPassword = 'CorrectHorseBattery1!';

    // Use lower iterations for crisp unit-test speed while exercising full WebCrypto PBKDF2+AES-GCM path
    const { masterKey } = await initializeVault(initialPassword, recoveryKey, 10_000);
    const meta = getVaultMetadata();
    expect(meta).not.toBeNull();
    expect(JSON.stringify(meta)).not.toContain(initialPassword);
    expect(JSON.stringify(meta)).not.toContain(recoveryKey);

    const samplePayload = [{ id: 's1', color: '#2563EB', points: [{ x: 10, y: 20, pressure: 0.5 }] }];
    const encrypted = await encryptJsonPayload(samplePayload, masterKey);
    expect(encrypted.ciphertext).not.toContain('#2563EB');

    // Wrong password must fail
    await expect(unlockMasterKeyWithPassword('WrongPassword123')).rejects.toThrow();

    // Correct password unwraps Master Key and decrypts identically
    const unlocked = await unlockMasterKeyWithPassword(initialPassword);
    const decrypted = await decryptJsonPayload<typeof samplePayload>(encrypted, unlocked);
    expect(decrypted).toEqual(samplePayload);

    // Reset password using Recovery Key — preserves decryption of existing payloads!
    const resetPassword = 'BrandNewVaultPassword2#';
    const postResetKey = await resetVaultPasswordWithRecoveryKey(recoveryKey, resetPassword);
    const decryptedAfterReset = await decryptJsonPayload<typeof samplePayload>(
      encrypted,
      postResetKey,
    );
    expect(decryptedAfterReset).toEqual(samplePayload);

    // Old password no longer works; new password works
    await expect(unlockMasterKeyWithPassword(initialPassword)).rejects.toThrow();
    const reopenedWithNewPass = await unlockMasterKeyWithPassword(resetPassword);
    expect(await decryptJsonPayload<typeof samplePayload>(encrypted, reopenedWithNewPass)).toEqual(
      samplePayload,
    );

    // Change password & regenerate recovery key
    const thirdPassword = 'ThirdPassword3$';
    await changeVaultPassword(resetPassword, thirdPassword);
    await expect(unlockMasterKeyWithPassword(resetPassword)).rejects.toThrow();

    const newRecovery = await regenerateVaultRecoveryKey(thirdPassword);
    expect(newRecovery).not.toBe(recoveryKey);
    await expect(resetVaultPasswordWithRecoveryKey(recoveryKey, 'Fail1234')).rejects.toThrow();

    const unlockedViaNewRecovery = await resetVaultPasswordWithRecoveryKey(
      newRecovery,
      'FinalPass99!',
    );
    expect(
      await decryptJsonPayload<typeof samplePayload>(encrypted, unlockedViaNewRecovery),
    ).toEqual(samplePayload);
  });
});
