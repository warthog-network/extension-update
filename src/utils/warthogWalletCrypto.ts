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

export function encryptWallet(
  walletData: EncryptedWalletPayload,
  password: string,
): string {
  const { privateKey, publicKey, address, mnemonic } = walletData;
  return CryptoJS.AES.encrypt(
    JSON.stringify({ privateKey, publicKey, address, mnemonic }),
    password,
  ).toString();
}

/**
 * Decrypt a password ciphertext or a multi-auth envelope (password field).
 */
export function decryptWallet(
  encrypted: string,
  password: string,
): EncryptedWalletPayload {
  const cipher = getPasswordCipherFromBlob(encrypted);
  if (!cipher) {
    throw new Error(
      "This wallet has no password unlock — use passkey, or re-save with a password",
    );
  }
  const bytes = CryptoJS.AES.decrypt(cipher, password);
  const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
  if (!decryptedStr) throw new Error("Invalid password");
  const parsed = JSON.parse(decryptedStr) as EncryptedWalletPayload;
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
