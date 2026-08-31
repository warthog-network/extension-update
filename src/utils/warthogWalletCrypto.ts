/**
 * Website-compatible encrypted wallet files / named saves (CryptoJS AES).
 * Format: AES-encrypt(JSON({ privateKey, publicKey, address }), password)
 * Also supports multi-auth envelopes (password + passkey) from wartbunker.
 */
import CryptoJS from "crypto-js";
import browser from "webextension-polyfill";
import {
  authBadgeForBlob,
  cleanupPasskeyStorage,
  getPasswordCipherFromBlob,
  inspectWalletBlob,
  tryParseEnvelope,
} from "./passkeyWallet";

export type EncryptedWalletPayload = {
  privateKey: string;
  publicKey: string;
  address: string;
  mnemonic?: string;
};

const NAMED_PREFIX = "warthogWallet_";

/** PBKDF2-SHA256 iterations — matches WartBunker v2. */
export const WALLET_CRYPTO_VERSION = 2;
const PBKDF2_ITERATIONS = 210_000;

function encryptV2(plaintext: string, password: string): string {
  const salt = CryptoJS.lib.WordArray.random(16);
  const iv = CryptoJS.lib.WordArray.random(16);
  const key = CryptoJS.PBKDF2(String(password), salt, {
    keySize: 256 / 32,
    iterations: PBKDF2_ITERATIONS,
    hasher: CryptoJS.algo.SHA256,
  });
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return JSON.stringify({
    v: WALLET_CRYPTO_VERSION,
    kdf: "pbkdf2-sha256",
    iter: PBKDF2_ITERATIONS,
    salt: CryptoJS.enc.Base64.stringify(salt),
    iv: CryptoJS.enc.Base64.stringify(iv),
    ct: CryptoJS.enc.Base64.stringify(encrypted.ciphertext),
  });
}

function decryptV2(envelope: {
  iter?: number;
  salt: string;
  iv: string;
  ct: string;
}, password: string): EncryptedWalletPayload {
  const iterations =
    Number(envelope.iter) > 0 ? Number(envelope.iter) : PBKDF2_ITERATIONS;
  const salt = CryptoJS.enc.Base64.parse(envelope.salt);
  const iv = CryptoJS.enc.Base64.parse(envelope.iv);
  const ciphertext = CryptoJS.enc.Base64.parse(envelope.ct);
  const key = CryptoJS.PBKDF2(String(password), salt, {
    keySize: 256 / 32,
    iterations,
    hasher: CryptoJS.algo.SHA256,
  });
  const decrypted = CryptoJS.AES.decrypt({ ciphertext } as CryptoJS.lib.CipherParams, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  const decryptedStr = decrypted.toString(CryptoJS.enc.Utf8);
  if (!decryptedStr) throw new Error("Invalid password");
  return JSON.parse(decryptedStr) as EncryptedWalletPayload;
}

function decryptLegacyOpenSsl(
  encrypted: string,
  password: string,
): EncryptedWalletPayload {
  const bytes = CryptoJS.AES.decrypt(encrypted, password);
  const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
  if (!decryptedStr) throw new Error("Invalid password");
  return JSON.parse(decryptedStr) as EncryptedWalletPayload;
}

export function encryptWallet(
  walletData: EncryptedWalletPayload,
  password: string,
): string {
  if (!password) throw new Error("Password is required");
  const { privateKey, publicKey, address, mnemonic } = walletData;
  return encryptV2(
    JSON.stringify({ privateKey, publicKey, address, mnemonic }),
    password,
  );
}

/**
 * Decrypt a password ciphertext or a multi-auth envelope (password field).
 * Supports WartBunker v2 PBKDF2 envelopes and legacy CryptoJS OpenSSL blobs.
 */
export function decryptWallet(
  encrypted: string,
  password: string,
): EncryptedWalletPayload {
  if (!password) throw new Error("Invalid password");
  const raw = String(encrypted ?? "").trim();
  if (!raw) throw new Error("Invalid password");

  const cipher = getPasswordCipherFromBlob(raw);
  if (!cipher) {
    throw new Error(
      "This wallet has no password unlock — use passkey, or re-save with a password",
    );
  }

  const inner = String(cipher).trim();
  if (inner.startsWith("{")) {
    try {
      const envelope = JSON.parse(inner) as {
        v?: number;
        ct?: string;
        salt?: string;
        iv?: string;
        iter?: number;
      };
      if (
        envelope &&
        Number(envelope.v) === 2 &&
        envelope.ct &&
        envelope.salt &&
        envelope.iv
      ) {
        const parsed = decryptV2(
          envelope as { salt: string; iv: string; ct: string; iter?: number },
          password,
        );
        if (!parsed?.privateKey || !parsed?.address) {
          throw new Error("Invalid wallet file");
        }
        return parsed;
      }
    } catch (err) {
      if (err instanceof Error && err.message === "Invalid password") throw err;
      if (!(err instanceof SyntaxError)) throw err;
    }
  }

  const parsed = decryptLegacyOpenSsl(inner, password);
  if (!parsed?.privateKey || !parsed?.address) {
    throw new Error("Invalid wallet file");
  }
  return parsed;
}

export type SavedWalletEntry = {
  name: string;
  hasPassword: boolean;
  hasPasskey: boolean;
  require2fa: boolean;
  badge: string;
  addressHint: string;
};

/** List named wallets stored in extension local storage (website-compatible keys). */
export async function getSavedWallets(): Promise<string[]> {
  try {
    const all = await browser.storage.local.get(null);
    return Object.keys(all)
      .filter((key) => key.startsWith(NAMED_PREFIX))
      .map((key) => key.slice(NAMED_PREFIX.length))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** List named wallets with auth capability badges. */
export async function getSavedWalletEntries(): Promise<SavedWalletEntry[]> {
  try {
    const all = await browser.storage.local.get(null);
    const entries: SavedWalletEntry[] = [];
    for (const key of Object.keys(all)) {
      if (!key.startsWith(NAMED_PREFIX)) continue;
      const name = key.slice(NAMED_PREFIX.length);
      const raw = typeof all[key] === "string" ? (all[key] as string) : "";
      const info = inspectWalletBlob(raw);
      entries.push({
        name,
        hasPassword: info.hasPassword,
        hasPasskey: info.hasPasskey,
        require2fa: info.require2fa,
        badge: authBadgeForBlob(raw),
        addressHint: info.addressHint || "",
      });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function saveNamedWallet(
  name: string,
  encrypted: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Wallet name is required");
  await browser.storage.local.set({ [`${NAMED_PREFIX}${trimmed}`]: encrypted });
}

export async function loadNamedWalletEncrypted(
  name: string,
): Promise<string | null> {
  const key = `${NAMED_PREFIX}${name}`;
  const result = await browser.storage.local.get(key);
  const value = result[key];
  return typeof value === "string" ? value : null;
}

export async function deleteNamedWallet(name: string): Promise<void> {
  const raw = await loadNamedWalletEncrypted(name);
  if (raw) await cleanupPasskeyStorage(raw);
  await browser.storage.local.remove(`${NAMED_PREFIX}${name}`);
}

export function inspectNamedBlob(raw: string | null | undefined) {
  return inspectWalletBlob(raw);
}

export function isEnvelopeBlob(raw: string | null | undefined): boolean {
  return tryParseEnvelope(raw) != null;
}

/** Build a downloadable warthog_wallet.txt blob (website format). */
export function walletFileBlob(encrypted: string): Blob {
  return new Blob([encrypted], { type: "text/plain" });
}
