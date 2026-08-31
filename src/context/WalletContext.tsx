import React, {
  createContext,
  useState,
  useEffect,
  useRef,
  ReactNode,
  useCallback,
} from "react";
import { getKeyFromPassword, encrypt, decrypt } from "dha-encryption";
import browser from "webextension-polyfill";
import { Account } from "warthog-ts";
import {
  DEFAULT_NODE_INDEX,
  DEFAULT_NODE_LIST,
  DEFAULT_NODE_NAME_LIST,
} from "../config/network";
import { mergeNodeLists, networkLabel, normalizeNodeUrl } from "../utils/nodes";
import {
  deriveAccountAtIndex,
  deriveWallet,
  generateWallet,
  importFromPrivateKey,
  type PathType,
  type WalletKeyMaterial,
  type WordCount,
} from "../utils/walletKeys";
import {
  decryptWallet,
  encryptWallet,
  loadNamedWalletEncrypted,
  saveNamedWallet,
  type EncryptedWalletPayload,
} from "../utils/warthogWalletCrypto";
import {
  buildEnvelopeWithPasskey,
  decryptWithPasskey,
  envelopeWithPassword,
  inspectWalletBlob,
  isWebAuthnAvailable,
  serializeEnvelope,
  setPasskeyProductName,
  tryParseEnvelope,
  unlockEnvelopeWith2fa,
} from "../utils/passkeyWallet";
import {
  bumpIdleTimer,
  exportWalletFromWorker,
  lockSigningWorker,
  setIdleLockHandler,
  unlockSigningWorker,
} from "../utils/signingBridge";

setPasskeyProductName("Warthog Extension");

interface WalletContextProps {
  seedPhrase: string | null;
  /** Active account private key (hex). Required for PK-only wallets; also set for seed wallets. */
  privateKey: string | null;
  wallet: string | null;
  walletList: string[];
  nameList: string[];
  nodeList: string[];
  nodeNameList: string[];
  visibleWalletList: boolean[];
  selectedWalletIndex: number;
  selectedNodeIndex: number;
  password: string | null;
  name: string | null;
  pathType: PathType;
  tmpDestinationWallet: string | null;
  inputWordsBackup: string[];
  selectedNodeUrl: string | null;
  selectedNetworkLabel: "Mainnet" | "DeFi Testnet";
  /** True when setup is complete enough to show the home UI. */
  isAuthenticated: boolean;
  /** Seed-based wallets can add more accounts; PK-only cannot. */
  canAddAccounts: boolean;
  setName: (name: string) => void;
  setSeedPhrase: (seedPhrase: string | null) => void;
  setPrivateKey: (privateKey: string | null) => void;
  setWallet: (wallet: string) => void;
  setPassword: (password: string) => void;
  setWalletList: (walletList: string[]) => void;
  setNodeList: (nodeList: string[]) => void;
  setNodeNameList: (nodeNameList: string[]) => void;
  setNameList: (nameList: string[]) => void;
  setSelectedNodeIndex: (selectedNodeIndex: number) => void;
  setVisibleWalletList: (visibleWalletList: boolean[]) => void;
  setSelectedWalletIndex: (selectedWalletIndex: number) => void;
  setInputWordsBackup: (inputWordsBackup: string[]) => void;
  setPathType: (pathType: PathType) => void;
  clearWalletData: () => void;
  token: string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
  /** Wipe in-memory keys and session token. Named encrypted wallets stay on disk. */
  lockSession: () => Promise<void>;
  accountPath: (index: number) => string;
  newWallet: (wordCount?: WordCount, pathType?: PathType) => Promise<void>;
  addAccount: (name: string | null) => Promise<void>;
  switchActiveAccount: (index: number) => Promise<void>;
  importWallet: (
    seedPhrase: string,
    pathType?: PathType,
    wordCount?: WordCount,
  ) => Promise<void>;
  importPrivateKey: (privateKeyHex: string) => Promise<void>;
  /** Activate from website-compatible encrypted payload (saved wallet / file). */
  loginFromEncrypted: (
    encrypted: string,
    password: string,
    walletName?: string | null,
  ) => Promise<void>;
  /** Unlock a multi-auth envelope with WebAuthn passkey (optionally + password for 2FA). */
  loginFromPasskey: (
    encrypted: string,
    walletName?: string | null,
    password?: string | null,
  ) => Promise<void>;
  /** Persist current key material as a named wallet (website format). */
  saveCurrentAsNamedWallet: (
    walletName: string,
    password?: string | null,
    opts?: {
      withPasskey?: boolean;
      require2fa?: boolean;
      preferFingerprint?: boolean;
    },
  ) => Promise<void>;
  /** Add or re-register passkey unlock on the currently open named wallet. */
  enablePasskeyOnCurrentWallet: (opts?: {
    password?: string | null;
    require2fa?: boolean;
    preferFingerprint?: boolean;
    name?: string | null;
  }) => Promise<boolean>;
  activateKeyMaterial: (
    data: WalletKeyMaterial,
    opts?: { password?: string; name?: string },
  ) => Promise<void>;
  setWalletListState: (walletList: string[]) => void;
  setNodeListState: (nodeList: string[]) => void;
  setNodeNameListState: (nodeNameList: string[]) => void;
  setNameListState: (nameList: string[]) => void;
  setSelectedWalletIndexState: (selectedWalletIndex: number) => void;
  setSelectedNodeIndexState: (selectedNodeIndex: number) => void;
  setVisibleWalletListState: (visibleWalletList: boolean[]) => void;
  setTmpDestinationWalletState: (tmpDestinationWallet: string) => void;
  getAccountFromIndex: (index: number) => Account;
  signingUnlocked: boolean;
}

const defaultNodeList = [...DEFAULT_NODE_LIST];
const defaultNodeNameList = [...DEFAULT_NODE_NAME_LIST];

const WalletContext = createContext<WalletContextProps | undefined>(undefined);

const ENCRYPTION_KEY =
  import.meta.env.VITE_APP_ENCRYPTION_KEY || "encryption_key";

export const WalletProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [seedPhrase, setSeedPhraseState] = useState<string | null>(null);
  const [privateKey, setPrivateKeyState] = useState<string | null>(null);
  const [wallet, setWalletState] = useState<string | null>(null);
  const [password, setPasswordState] = useState<string | null>(null);
  const [name, setNameState] = useState<string | null>(null);
  const [pathType, setPathTypeState] = useState<PathType>("hardened");
  const [walletList, setWalletListState] = useState<string[]>([]);
  const [selectedWalletIndex, setSelectedWalletIndexState] =
    useState<number>(0);
  const [selectedNodeIndex, setSelectedNodeIndexState] =
    useState<number>(DEFAULT_NODE_INDEX);
  const [nameList, setNameListState] = useState<string[]>([]);
  const [nodeList, setNodeListState] = useState<string[]>([]);
  const [nodeNameList, setNodeNameListState] = useState<string[]>([]);
  const [token, setTokenState] = useState<string | null>(null);
  const [signingUnlocked, setSigningUnlocked] = useState(false);
  const [hasMnemonic, setHasMnemonic] = useState(false);
  const [visibleWalletList, setVisibleWalletListState] = useState<boolean[]>(
    [],
  );
  const [tmpDestinationWallet, setTmpDestinationWalletState] = useState<
    string | null
  >(null);
  const [inputWordsBackup, setInputWordsBackupState] = useState<string[]>([]);

  const arrayBufferToHex = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  };

  const hexToArrayBuffer = (hex: string): ArrayBuffer => {
    const bytes = new Uint8Array(
      hex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)),
    );
    return bytes.buffer;
  };

  const saveToBrowserStorage = async (
    key: string,
    value: string | null,
  ): Promise<void> => {
    try {
      const keyObject = await getKeyFromPassword(ENCRYPTION_KEY);
      const encryptedValue = value ? await encrypt(value, keyObject) : null;
      const hexValue = encryptedValue ? arrayBufferToHex(encryptedValue) : null;
      await browser.storage.local.set({ [key]: hexValue });
    } catch (error) {
      console.error(`Error saving ${key} to browser storage:`, error);
      throw error;
    }
  };

  const decryptValue = async (
    value: string | undefined,
  ): Promise<string | null> => {
    const keyObject = await getKeyFromPassword(ENCRYPTION_KEY);
    const arrayBuffer = value ? hexToArrayBuffer(value) : null;
    const decryptedValue = arrayBuffer
      ? await decrypt(arrayBuffer, keyObject)
      : null;
    return decryptedValue;
  };

  const loadFromChromeStorage = useCallback(
    (key: string, callback: (value: string | null) => void): void => {
      try {
        browser.storage.local
          .get(key)
          .then((result: Record<string, unknown>) => {
            decryptValue(result[key] as string | undefined)
              .then((decryptedValue) => {
                callback(decryptedValue);
              })
              .catch((error: unknown) => {
                console.error(
                  `Error decrypting ${key} from browser storage:`,
                  error,
                );
              });
          })
          .catch((error: unknown) => {
            console.error(`Error loading ${key} from browser storage:`, error);
          });
      } catch (error) {
        console.error(`Error loading ${key} from browser storage:`, error);
      }
    },
    [],
  );

  const accountPath = (index: number): string => {
    return pathType === "hardened"
      ? `m/44'/2070'/0'/0/${index}`
      : `m/44'/2070'/0/0/${index}`;
  };

  const ensureDefaultNodes = () => {
    setNodeList(defaultNodeList);
    setNodeNameList(defaultNodeNameList);
    setSelectedNodeIndex(DEFAULT_NODE_INDEX);
  };

  const setPrivateKey = (pk: string | null): void => {
    setPrivateKeyState(pk);
  };

  const setPathType = (pt: PathType): void => {
    setPathTypeState(pt);
    saveToBrowserStorage("pathType", pt);
  };

  const setSeedPhrase = (seed: string | null): void => {
    setSeedPhraseState(seed);
  };

  const setWallet = (w: string): void => {
    setWalletState(w);
    saveToBrowserStorage("wallet", w);
  };

  const setWalletList = (list: string[]): void => {
    setWalletListState(list);
    saveToBrowserStorage("walletList", list.join(","));
  };

  const setNodeList = (list: string[]): void => {
    setNodeListState(list);
    saveToBrowserStorage("nodeList", list.join(","));
  };

  const setNodeNameList = (list: string[]): void => {
    setNodeNameListState(list);
    saveToBrowserStorage("nodeNameList", list.join(","));
  };

  const setNameList = (list: string[]): void => {
    setNameListState(list);
    saveToBrowserStorage("nameList", list.join(","));
  };

  const setSelectedWalletIndex = (idx: number): void => {
    setSelectedWalletIndexState(idx);
    saveToBrowserStorage("selectedWalletIndex", idx.toString());
  };

  const setSelectedNodeIndex = (idx: number): void => {
    setSelectedNodeIndexState(idx);
    saveToBrowserStorage("selectedNodeIndex", idx.toString());
  };

  const setPassword = (pwd: string): void => {
    setPasswordState(pwd);
  };

  const setName = (n: string): void => {
    setNameState(n);
    saveToBrowserStorage("name", n);
  };

  const setVisibleWalletList = (list: boolean[]): void => {
    setVisibleWalletListState(list);
    saveToBrowserStorage("visibleWalletList", list.join(","));
  };

  const setInputWordsBackup = (words: string[]): void => {
    setInputWordsBackupState(words);
  };

  /** Apply key material into session + storage (used by create / import / login). */
  const activateKeyMaterial = async (
    data: WalletKeyMaterial,
    opts?: { password?: string; name?: string },
  ): Promise<void> => {
    const accountName = opts?.name || "Account 0";
    const sessionToken = opts?.password
      ? opts.password + Date.now().toString()
      : "session-" + Date.now().toString();
    const expirationTime = Date.now() + 3600 * 1000;

    await unlockSigningWorker({
      privateKey: data.privateKey,
      publicKey: data.publicKey,
      address: data.address,
      mnemonic: data.mnemonic,
    });
    setPrivateKeyState(null);
    setSeedPhraseState(null);
    setSigningUnlocked(true);
    setHasMnemonic(Boolean(data.mnemonic));
    setWalletState(data.address);
    setWalletListState([data.address]);
    setNameListState([accountName]);
    setVisibleWalletListState([true]);
    setSelectedWalletIndexState(0);
    setNameState(accountName);
    if (data.pathType) {
      setPathTypeState(data.pathType);
    }
    setNodeListState([...defaultNodeList]);
    setNodeNameListState([...defaultNodeNameList]);
    setSelectedNodeIndexState(DEFAULT_NODE_INDEX);
    if (opts?.password) {
      setPasswordState(opts.password);
    }
    if (sessionToken) {
      setTokenState(sessionToken);
    }

    // Persist public session only. Seed / private key / password stay in memory
    // until lock — they are not wrapped with a bundled storage key.
    await Promise.all([
      saveToBrowserStorage("wallet", data.address),
      saveToBrowserStorage("walletList", data.address),
      saveToBrowserStorage("nameList", accountName),
      saveToBrowserStorage("visibleWalletList", "true"),
      saveToBrowserStorage("selectedWalletIndex", "0"),
      saveToBrowserStorage("name", accountName),
      saveToBrowserStorage("pathType", data.pathType || pathType),
      saveToBrowserStorage("nodeList", defaultNodeList.join(",")),
      saveToBrowserStorage("nodeNameList", defaultNodeNameList.join(",")),
      saveToBrowserStorage("selectedNodeIndex", String(DEFAULT_NODE_INDEX)),
      sessionToken
        ? saveToBrowserStorage("token", sessionToken)
        : Promise.resolve(),
      sessionToken
        ? saveToBrowserStorage("tokenExpiration", expirationTime.toString())
        : Promise.resolve(),
    ]);
  };

  const newWallet = async (
    wordCount: WordCount = 12,
    pt: PathType = "hardened",
  ): Promise<void> => {
    try {
      const data = await generateWallet(wordCount, pt);
      await unlockSigningWorker({
        privateKey: data.privateKey,
        publicKey: data.publicKey,
        address: data.address,
        mnemonic: data.mnemonic,
      });
      setSigningUnlocked(true);
      setHasMnemonic(Boolean(data.mnemonic));
      // Seed stays in React only while the recovery screens are showing it.
      setSeedPhrase(data.mnemonic || null);
      setPrivateKey(null);
      setWallet(data.address);
      setWalletList([data.address]);
      setNameList(["Account 0"]);
      setVisibleWalletList([true]);
      setSelectedWalletIndex(0);
      setName("Account 0");
      setPathType(pt);
      ensureDefaultNodes();
    } catch (error) {
      console.log("Error creating new wallet:", error);
      throw error;
    }
  };

  const mnemonicFromSession = async (): Promise<string | null> => {
    try {
      const exported = await exportWalletFromWorker();
      const mnemonic = exported.mnemonic || seedPhrase || null;
      exported.privateKey = "";
      return mnemonic;
    } catch {
      return seedPhrase;
    }
  };

  const addAccount = async (accountName: string | null): Promise<void> => {
    try {
      const mnemonic = await mnemonicFromSession();
      if (!mnemonic) {
        throw new Error("Cannot add accounts to a private-key-only wallet");
      }
      const index = walletList.length;
      const data = deriveAccountAtIndex(mnemonic, pathType, index);
      await unlockSigningWorker({
        privateKey: data.privateKey,
        publicKey: data.publicKey,
        address: data.address,
        mnemonic,
      });
      setPrivateKeyState(null);
      setSigningUnlocked(true);
      setHasMnemonic(true);
      setWallet(data.address);
      setWalletList([...walletList, data.address]);
      setNameList([...nameList, accountName || `Account ${index}`]);
      setVisibleWalletList([...visibleWalletList, true]);
      setSelectedWalletIndex(index);
      setName(accountName || `Account ${index}`);
    } catch (error) {
      console.log("Error adding new account:", error);
      throw error;
    }
  };

  const switchActiveAccount = async (index: number): Promise<void> => {
    const mnemonic = await mnemonicFromSession();
    if (!mnemonic) {
      throw new Error("Cannot switch accounts on a private-key-only wallet");
    }
    const data = deriveAccountAtIndex(mnemonic, pathType, index);
    await unlockSigningWorker({
      privateKey: data.privateKey,
      publicKey: data.publicKey,
      address: data.address,
      mnemonic,
    });
    setPrivateKeyState(null);
    setSigningUnlocked(true);
    setHasMnemonic(true);
    setWallet(data.address);
    setSelectedWalletIndex(index);
    setName(nameList[index] || `Account ${index}`);
  };

  const importWallet = async (
    mnemonic: string,
    pt: PathType = "hardened",
    wordCount?: WordCount,
  ): Promise<void> => {
    const words = mnemonic.trim().split(/\s+/).filter(Boolean);
    const wc = (wordCount ||
      (words.length === 24 ? 24 : 12)) as WordCount;
    const data = deriveWallet(words.join(" "), wc, pt, 0);
    await unlockSigningWorker({
      privateKey: data.privateKey,
      publicKey: data.publicKey,
      address: data.address,
      mnemonic: data.mnemonic,
    });
    setSigningUnlocked(true);
    setHasMnemonic(true);
    setSeedPhrase(data.mnemonic || null);
    setPrivateKey(null);
    setWallet(data.address);
    setWalletList([data.address]);
    setNameList(["Account 0"]);
    setVisibleWalletList([true]);
    setSelectedWalletIndex(0);
    setName("Account 0");
    setPathType(pt);
    ensureDefaultNodes();
  };

  const importPrivateKey = async (privateKeyHex: string): Promise<void> => {
    const data = importFromPrivateKey(privateKeyHex);
    await unlockSigningWorker({
      privateKey: data.privateKey,
      publicKey: data.publicKey,
      address: data.address,
    });
    setSigningUnlocked(true);
    setHasMnemonic(false);
    setSeedPhrase(null);
    setPrivateKey(null);
    setWallet(data.address);
    setWalletList([data.address]);
    setNameList(["Account 0"]);
    setVisibleWalletList([true]);
    setSelectedWalletIndex(0);
    setName("Account 0");
    ensureDefaultNodes();
  };

  const currentWalletPayload = async (): Promise<EncryptedWalletPayload> => {
    const exported = await exportWalletFromWorker();
    if (!exported?.privateKey) {
      throw new Error("No active wallet to save");
    }
    return {
      privateKey: exported.privateKey,
      publicKey: exported.publicKey || "",
      address: exported.address || wallet || "",
      mnemonic: exported.mnemonic || seedPhrase || undefined,
    };
  };

  const loginFromEncrypted = async (
    encrypted: string,
    pwd: string,
    walletName?: string | null,
  ): Promise<void> => {
    const info = inspectWalletBlob(encrypted);
    if (info.require2fa) {
      throw new Error(
        "This wallet requires password + passkey. Use Unlock with password + passkey.",
      );
    }
    if (!info.hasPassword) {
      throw new Error(
        "This wallet has no password unlock — use passkey instead",
      );
    }
    const decrypted = await decryptWallet(encrypted, pwd);
    const material: WalletKeyMaterial = {
      privateKey: decrypted.privateKey,
      publicKey: decrypted.publicKey,
      address: decrypted.address,
      mnemonic: decrypted.mnemonic,
    };
    await activateKeyMaterial(material, {
      password: pwd,
      name: walletName || "Account 0",
    });
  };

  const loginFromPasskey = async (
    encrypted: string,
    walletName?: string | null,
    pwd?: string | null,
  ): Promise<void> => {
    if (!isWebAuthnAvailable()) {
      throw new Error(
        "Passkey unlock needs a modern browser with WebAuthn support",
      );
    }
    const info = inspectWalletBlob(encrypted);
    if (!info.hasPasskey || !info.envelope?.passkey) {
      throw new Error(
        "This wallet has no passkey unlock — use password, or enable passkey after unlock",
      );
    }

    let decrypted: EncryptedWalletPayload;
    if (info.require2fa) {
      if (!pwd) {
        throw new Error(
          "2FA wallet: enter password, then confirm with passkey",
        );
      }
      decrypted = (await unlockEnvelopeWith2fa(
        info.envelope,
        pwd,
        decryptWallet,
      )) as EncryptedWalletPayload;
    } else {
      decrypted = (await decryptWithPasskey(
        info.envelope.passkey,
      )) as EncryptedWalletPayload;
    }

    const material: WalletKeyMaterial = {
      privateKey: decrypted.privateKey,
      publicKey: decrypted.publicKey,
      address: decrypted.address,
      mnemonic: decrypted.mnemonic,
    };
    await activateKeyMaterial(material, {
      password: pwd || undefined,
      name: walletName || "Account 0",
    });
  };

  const saveCurrentAsNamedWallet = async (
    walletName: string,
    pwd?: string | null,
    opts?: {
      withPasskey?: boolean;
      require2fa?: boolean;
      preferFingerprint?: boolean;
    },
  ): Promise<void> => {
    const payload = await currentWalletPayload();
    const trimmed = walletName.trim();
    if (!trimmed) throw new Error("Wallet name is required");

    const withPasskey = Boolean(opts?.withPasskey);
    const require2fa = Boolean(opts?.require2fa);
    const preferFingerprint = Boolean(opts?.preferFingerprint);

    if (!pwd && !withPasskey) {
      throw new Error("Password or passkey required to save");
    }
    if (require2fa && (!pwd || !withPasskey)) {
      throw new Error("2FA needs both a password and passkey");
    }

    const existing = await loadNamedWalletEncrypted(trimmed);
    const prevEnv = existing ? tryParseEnvelope(existing) : null;

    let passwordCipher: string | null = pwd ? await encryptWallet(payload, pwd) : null;
    if (!passwordCipher && prevEnv?.password) passwordCipher = prevEnv.password;
    if (!passwordCipher && existing && !prevEnv) passwordCipher = existing;

    if (withPasskey) {
      if (!isWebAuthnAvailable()) {
        throw new Error("Passkey unlock needs HTTPS and a modern browser");
      }
      // passkeyWallet is a JS port; cast opts to avoid loose default-param inference
      const { envelope } = (await buildEnvelopeWithPasskey(payload, {
        displayName: trimmed,
        existingPasswordCipher: passwordCipher,
        previousEnvelope: prevEnv,
        require2fa: require2fa && Boolean(passwordCipher || pwd),
        preferFingerprint,
      } as Record<string, unknown>)) as {
        envelope: {
          password: string | null;
          require2fa: boolean;
          [k: string]: unknown;
        };
      };
      if (require2fa && pwd) {
        envelope.password = await encryptWallet(payload, pwd);
        envelope.require2fa = true;
      }
      await saveNamedWallet(trimmed, serializeEnvelope(envelope));
      return;
    }

    if (pwd) {
      const cipher = await encryptWallet(payload, pwd);
      if (prevEnv?.passkey) {
        const next = envelopeWithPassword(payload, cipher, prevEnv, {
          require2fa,
        });
        await saveNamedWallet(trimmed, serializeEnvelope(next));
      } else {
        await saveNamedWallet(trimmed, cipher);
      }
    }
  };

  const enablePasskeyOnCurrentWallet = async (opts?: {
    password?: string | null;
    require2fa?: boolean;
    preferFingerprint?: boolean;
    name?: string | null;
  }): Promise<boolean> => {
    if (!signingUnlocked || !wallet) {
      throw new Error("Unlock your wallet first, then enable passkey");
    }
    const tag =
      String(opts?.name || name || "").trim() || "Main";
    await saveCurrentAsNamedWallet(tag, opts?.password ?? password, {
      withPasskey: true,
      require2fa: Boolean(opts?.require2fa),
      preferFingerprint: Boolean(opts?.preferFingerprint),
    });
    if (!name) setName(tag);
    return true;
  };

  const setToken = (t: string): void => {
    setTokenState(t);
    const expirationTime = Date.now() + 3600 * 1000;
    saveToBrowserStorage("token", t);
    saveToBrowserStorage("tokenExpiration", expirationTime.toString());
  };

  const clearToken = (): void => {
    setTokenState(null);
    browser.storage.local
      .remove(["token", "tokenExpiration"])
      .catch((error: unknown) => {
        console.error("Error removing token and token expiration:", error);
      });
  };

  const SECRET_STORAGE_KEYS = [
    "privateKey",
    "seedPhrase",
    "password",
    "inputWordsBackup",
    "token",
    "tokenExpiration",
  ] as const;

  const lockSession = async (): Promise<void> => {
    setSeedPhraseState(null);
    setPrivateKeyState(null);
    setPasswordState(null);
    setTokenState(null);
    setInputWordsBackupState([]);
    setSigningUnlocked(false);
    setHasMnemonic(false);
    try {
      await lockSigningWorker();
    } catch {
      /* ignore */
    }
    try {
      await browser.storage.local.remove([...SECRET_STORAGE_KEYS]);
    } catch (error: unknown) {
      console.error("Error wiping session secrets:", error);
    }
  };

  const getAccountFromIndex = (index: number): Account => {
    if (seedPhrase) {
      const data = deriveAccountAtIndex(seedPhrase, pathType, index);
      return Account.fromPrivateKeyHex(data.privateKey);
    }
    if (privateKey) {
      return Account.fromPrivateKeyHex(privateKey);
    }
    throw new Error("No key material available");
  };

  const clearWalletData = (): void => {
    setSeedPhraseState(null);
    setPrivateKeyState(null);
    setWalletState(null);
    setPasswordState(null);
    setNameState(null);
    browser.storage.local
      .remove([
        "seedPhrase",
        "privateKey",
        "wallet",
        "password",
        "name",
        "pathType",
        "walletList",
        "nameList",
        "visibleWalletList",
      ])
      .then(() => {
        console.log("Wallet data removed");
      })
      .catch((error: unknown) => {
        console.error("Error removing wallet data:", error);
      });
  };

  useEffect(() => {
    // Drop any leftover secrets from older builds that wrapped keys with a
    // bundled storage password. Named warthogWallet_* envelopes are untouched.
    void browser.storage.local.remove([
      "privateKey",
      "seedPhrase",
      "password",
      "inputWordsBackup",
    ]);
    loadFromChromeStorage("wallet", setWalletState);
    loadFromChromeStorage("pathType", (pt) => {
      if (pt === "hardened" || pt === "non-hardened") {
        setPathTypeState(pt);
      }
    });
    loadFromChromeStorage("walletList", (list) =>
      setWalletListState(list ? list.split(",").filter(Boolean) : []),
    );
    loadFromChromeStorage("nameList", (list) =>
      setNameListState(list ? list.split(",") : []),
    );
    Promise.all([
      new Promise<string | null>((resolve) =>
        loadFromChromeStorage("nodeList", resolve),
      ),
      new Promise<string | null>((resolve) =>
        loadFromChromeStorage("nodeNameList", resolve),
      ),
      new Promise<string | null>((resolve) =>
        loadFromChromeStorage("selectedNodeIndex", resolve),
      ),
    ]).then(([storedNodes, storedNames, storedIndex]) => {
      const merged = mergeNodeLists(
        storedNodes ? storedNodes.split(",").filter(Boolean) : [],
        storedNames ? storedNames.split(",") : [],
      );
      setNodeListState(merged.urls);
      setNodeNameListState(merged.names);
      saveToBrowserStorage("nodeList", merged.urls.join(","));
      saveToBrowserStorage("nodeNameList", merged.names.join(","));

      const idx = storedIndex ? parseInt(storedIndex, 10) : DEFAULT_NODE_INDEX;
      const safeIdx =
        Number.isFinite(idx) && idx >= 0 && idx < merged.urls.length
          ? idx
          : DEFAULT_NODE_INDEX;
      setSelectedNodeIndexState(safeIdx);
    });
    loadFromChromeStorage("visibleWalletList", (visible) => {
      const boolArray = visible
        ? visible.split(",").map((val) => val === "true")
        : [];
      setVisibleWalletListState(boolArray);
    });
    loadFromChromeStorage("selectedWalletIndex", (idx) =>
      setSelectedWalletIndexState(idx ? parseInt(idx, 10) : 0),
    );
    loadFromChromeStorage("name", setNameState);
    loadFromChromeStorage("token", setTokenState);
  }, [loadFromChromeStorage]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadFromChromeStorage("tokenExpiration", (expiration) => {
        const expirationTime = expiration ? parseInt(expiration, 10) : 0;
        if (Date.now() >= expirationTime) {
          clearToken();
        }
      });
    }, 1000 * 60);
    return () => clearInterval(interval);
  }, [loadFromChromeStorage]);

  const lockSessionRef = useRef(lockSession);
  lockSessionRef.current = lockSession;

  useEffect(() => {
    setIdleLockHandler(() => {
      void lockSessionRef.current();
    });
    const bump = () => bumpIdleTimer();
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    bumpIdleTimer();
    return () => {
      setIdleLockHandler(null);
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
    };
  }, []);

  const selectedNodeUrl =
    nodeList.length > 0
      ? normalizeNodeUrl(nodeList[selectedNodeIndex] || nodeList[0])
      : null;
  const selectedNetworkLabel = networkLabel(selectedNodeUrl);
  // Password or session token (passkey-only unlock sets token without password)
  const isAuthenticated = Boolean(wallet && signingUnlocked && token);
  const canAddAccounts = hasMnemonic || Boolean(seedPhrase);

  return (
    <WalletContext.Provider
      value={{
        seedPhrase,
        privateKey,
        wallet,
        password,
        name,
        pathType,
        token,
        walletList,
        nodeList,
        nodeNameList,
        nameList,
        selectedWalletIndex,
        selectedNodeIndex,
        visibleWalletList,
        tmpDestinationWallet,
        inputWordsBackup,
        selectedNodeUrl,
        selectedNetworkLabel,
        isAuthenticated,
        signingUnlocked,
        canAddAccounts,
        accountPath,
        setSeedPhrase,
        setPrivateKey,
        setWallet,
        setPassword,
        setName,
        setWalletList,
        setNodeList,
        setNodeNameList,
        setNameList,
        setVisibleWalletList,
        setSelectedWalletIndex,
        setSelectedNodeIndex,
        setPathType,
        clearWalletData,
        setToken,
        clearToken,
        lockSession,
        newWallet,
        addAccount,
        switchActiveAccount,
        setWalletListState,
        setNodeListState,
        setNodeNameListState,
        setNameListState,
        setSelectedWalletIndexState,
        setSelectedNodeIndexState,
        setVisibleWalletListState,
        setTmpDestinationWalletState,
        getAccountFromIndex,
        importWallet,
        importPrivateKey,
        loginFromEncrypted,
        loginFromPasskey,
        saveCurrentAsNamedWallet,
        enablePasskeyOnCurrentWallet,
        activateKeyMaterial,
        setInputWordsBackup,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
};

export default WalletContext;
