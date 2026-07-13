/**
 * Website-compatible encrypted wallet files / named saves (CryptoJS AES).
 * Format: AES-encrypt(JSON({ privateKey, publicKey, address }), password)
 */
import CryptoJS from "crypto-js";
import browser from "webextension-polyfill";

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

export function decryptWallet(
  encrypted: string,
  password: string,
): EncryptedWalletPayload {
  const bytes = CryptoJS.AES.decrypt(encrypted, password);
  const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
  if (!decryptedStr) throw new Error("Invalid password");
  const parsed = JSON.parse(decryptedStr) as EncryptedWalletPayload;
  if (!parsed?.privateKey || !parsed?.address) {
    throw new Error("Invalid wallet file");
  }
  return parsed;
}

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
  await browser.storage.local.remove(`${NAMED_PREFIX}${name}`);
}

/** Build a downloadable warthog_wallet.txt blob (website format). */
export function walletFileBlob(encrypted: string): Blob {
  return new Blob([encrypted], { type: "text/plain" });
}
