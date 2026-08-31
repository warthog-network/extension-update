import { Account } from "warthog-js";

type WorkerResponse = {
  requestId: number;
  ok: boolean;
  error?: string;
  [k: string]: unknown;
};

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<
  number,
  { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void }
>();

const AUTO_LOCK_MS = 15 * 60 * 1000;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleLockHandler: (() => void) | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/signingWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      const waiter = pending.get(msg.requestId);
      if (!waiter) return;
      pending.delete(msg.requestId);
      if (msg.ok) waiter.resolve(msg);
      else waiter.reject(new Error(msg.error || "Signing worker request failed"));
    };
    worker.onerror = (event) => {
      pending.forEach(({ reject }) => {
        reject(new Error(event.message || "Signing worker crashed"));
      });
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function callWorker(action: string, payload: Record<string, unknown> = {}) {
  const w = getWorker();
  return new Promise<WorkerResponse>((resolve, reject) => {
    const requestId = ++nextRequestId;
    pending.set(requestId, { resolve, reject });
    w.postMessage({ requestId, action, payload });
  });
}

export function getAutoLockMs() {
  return AUTO_LOCK_MS;
}

export function setIdleLockHandler(fn: (() => void) | null) {
  idleLockHandler = fn;
}

export function bumpIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    void lockSigningWorker();
    idleLockHandler?.();
  }, AUTO_LOCK_MS);
}

export async function unlockSigningWorker(data: {
  privateKey: string;
  publicKey?: string;
  address?: string;
  mnemonic?: string;
}) {
  const result = await callWorker("unlock", data);
  bumpIdleTimer();
  return result;
}

export async function lockSigningWorker() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (!worker) return { unlocked: false };
  return callWorker("lock");
}

export async function getSigningStatus(): Promise<{
  unlocked: boolean;
  address: string | null;
  publicKey: string | null;
  hasMnemonic: boolean;
}> {
  if (!worker) {
    return { unlocked: false, address: null, publicKey: null, hasMnemonic: false };
  }
  const r = await callWorker("status");
  return {
    unlocked: Boolean(r.unlocked),
    address: (r.address as string) || null,
    publicKey: (r.publicKey as string) || null,
    hasMnemonic: Boolean(r.hasMnemonic),
  };
}

/** Explicit user export only (Show key / download). */
export async function exportWalletFromWorker() {
  const r = await callWorker("exportWallet");
  return r.wallet as {
    privateKey: string;
    publicKey: string | null;
    address: string | null;
    mnemonic: string | null;
  };
}

/**
 * Borrow the key for one Account construction on this turn, then drop the local copy.
 * Canonical key stays in the worker.
 */
export async function runWithUnlockedAccount<T>(
  fn: (account: Account) => T | Promise<T>,
): Promise<T> {
  const status = await getSigningStatus();
  if (!status.unlocked) {
    throw new Error("Wallet is locked — unlock to sign");
  }
  const wallet = await exportWalletFromWorker();
  try {
    const account = Account.fromPrivateKeyHex(wallet.privateKey);
    return await fn(account);
  } finally {
    wallet.privateKey = "";
  }
}

export async function runWithUnlockedPrivateKey<T>(
  fn: (privateKeyHex: string) => T | Promise<T>,
): Promise<T> {
  const status = await getSigningStatus();
  if (!status.unlocked) {
    throw new Error("Wallet is locked — unlock to sign");
  }
  const wallet = await exportWalletFromWorker();
  try {
    return await fn(wallet.privateKey);
  } finally {
    wallet.privateKey = "";
  }
}
