/**
 * Wallet key generation / derivation — same logic as website webwallet.
 */
import { ethers } from "ethers";

export type PathType = "hardened" | "non-hardened";
export type WordCount = 12 | 24;

export type WalletKeyMaterial = {
  mnemonic?: string;
  wordCount?: WordCount;
  pathType?: PathType;
  privateKey: string;
  publicKey: string;
  address: string;
};

export function derivationPath(pathType: PathType, accountIndex = 0): string {
  return pathType === "hardened"
    ? `m/44'/2070'/0'/0/${accountIndex}`
    : `m/44'/2070'/0/0/${accountIndex}`;
}

function addressFromPublicKey(publicKeyHex: string): {
  publicKey: string;
  address: string;
} {
  const publicKey = publicKeyHex.replace(/^0x/i, "");
  const sha = ethers.sha256("0x" + publicKey).slice(2);
  const ripemd = ethers.ripemd160("0x" + sha).slice(2);
  const checksum = ethers.sha256("0x" + ripemd).slice(2, 10);
  return { publicKey, address: ripemd + checksum };
}

/** Create a new wallet (12 or 24 words). Matches website `generateWallet`. */
export async function generateWallet(
  wordCount: WordCount = 12,
  pathType: PathType = "hardened",
): Promise<WalletKeyMaterial> {
  const strengthBytes = wordCount === 12 ? 16 : 32;
  const entropy = window.crypto.getRandomValues(new Uint8Array(strengthBytes));
  const mnemonicObj = ethers.Mnemonic.fromEntropy(ethers.hexlify(entropy));
  const mnemonic = mnemonicObj.phrase;
  const path = derivationPath(pathType, 0);
  const hdWallet = ethers.HDNodeWallet.fromPhrase(mnemonic, "", path);
  const { publicKey, address } = addressFromPublicKey(
    hdWallet.publicKey.slice(2),
  );
  return {
    mnemonic,
    wordCount,
    pathType,
    privateKey: hdWallet.privateKey.slice(2),
    publicKey,
    address,
  };
}

/** Derive wallet from an existing seed phrase. Matches website `deriveWallet`. */
export function deriveWallet(
  mnemonic: string,
  wordCount: WordCount,
  pathType: PathType = "hardened",
  accountIndex = 0,
): WalletKeyMaterial {
  const words = mnemonic.trim().split(/\s+/).filter(Boolean);
  if (words.length !== wordCount) {
    throw new Error(
      `Invalid mnemonic: must have exactly ${wordCount} words (got ${words.length})`,
    );
  }
  try {
    const path = derivationPath(pathType, accountIndex);
    const hdWallet = ethers.HDNodeWallet.fromPhrase(
      words.join(" "),
      "",
      path,
    );
    const { publicKey, address } = addressFromPublicKey(
      hdWallet.publicKey.slice(2),
    );
    return {
      mnemonic: words.join(" "),
      wordCount,
      pathType,
      privateKey: hdWallet.privateKey.slice(2),
      publicKey,
      address,
    };
  } catch {
    throw new Error("Invalid mnemonic");
  }
}

/** Import from a 64-char hex private key. Matches website `importFromPrivateKey`. */
export function importFromPrivateKey(privKeyRaw: string): WalletKeyMaterial {
  const privKey = privKeyRaw.trim().replace(/^0x/i, "").replace(/\s/g, "");
  if (privKey.length !== 64) {
    throw new Error("Private key must be exactly 64 characters long");
  }
  if (!/^[0-9a-fA-F]+$/.test(privKey)) {
    throw new Error(
      "Private key must consist of hexadecimal characters only (0-9, a-f, A-F)",
    );
  }
  try {
    const signer = new ethers.Wallet("0x" + privKey);
    const publicKey = signer.signingKey.compressedPublicKey.slice(2);
    const { address } = addressFromPublicKey(publicKey);
    return {
      privateKey: privKey.toLowerCase(),
      publicKey,
      address,
    };
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Invalid private key",
    );
  }
}

/** Derive account N from a stored mnemonic + path type. */
export function deriveAccountAtIndex(
  mnemonic: string,
  pathType: PathType,
  index: number,
): WalletKeyMaterial {
  const words = mnemonic.trim().split(/\s+/).filter(Boolean);
  const wordCount = (words.length === 24 ? 24 : 12) as WordCount;
  return deriveWallet(words.join(" "), wordCount, pathType, index);
}
