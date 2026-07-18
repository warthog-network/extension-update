/**
 * Node API helpers aligned with website webwallet + wartbunker DeFi testnet.
 * Uses direct fetch (extension has host_permissions) — no proxy required.
 */
import { ethers } from "ethers";
import secp256k1 from "secp256k1";
import { DEFAULT_TX_FEE } from "../config/network";
import { isDefiNode, isMainnetNode, normalizeNodeUrl } from "./nodes";
import { formatBalanceBreakdown } from "./balanceBreakdown";

export type BalanceResult = {
  /** Total holdings (available + locked). Kept for backward compatibility. */
  balance: string;
  /** Free to spend (total − locked − mempool). */
  available: string;
  /** Locked in open orders / pending. */
  locked: string;
  hasLocked: boolean;
  nextNonce: number;
  pinHeight: number;
  pinHash: string;
  network: "mainnet" | "defi-testnet";
};

type NodeJson<T = unknown> = {
  code: number;
  data?: T;
  error?: string;
};

async function nodeGet<T = unknown>(
  nodeBase: string,
  path: string,
): Promise<T> {
  const base = normalizeNodeUrl(nodeBase);
  if (!base) throw new Error("Invalid node URL");
  const url = `${base}/${path.replace(/^\//, "")}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
    },
  });
  if (!response.ok) {
    throw new Error(`Node HTTP ${response.status}`);
  }
  const json = (await response.json()) as NodeJson<T>;
  if (json.code !== 0) {
    throw new Error(json.error || `Node error code ${json.code}`);
  }
  return json.data as T;
}

async function nodePost<T = unknown>(
  nodeBase: string,
  path: string,
  body: unknown,
): Promise<T> {
  const base = normalizeNodeUrl(nodeBase);
  if (!base) throw new Error("Invalid node URL");
  const url = `${base}/${path.replace(/^\//, "")}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body, (_k, v) =>
      typeof v === "bigint" ? Number(v) : v,
    ),
  });
  if (!response.ok) {
    throw new Error(`Node HTTP ${response.status}`);
  }
  const json = (await response.json()) as NodeJson<T>;
  if (json.code !== 0) {
    throw new Error(json.error || `Node error code ${json.code}`);
  }
  return json.data as T;
}

function formatAmountFromRaw(raw: bigint | number | string, precision = 8): string {
  const value = BigInt(raw);
  const divisor = 10n ** BigInt(precision);
  const whole = value / divisor;
  const frac = value % divisor;
  if (precision === 0) return whole.toString();
  return `${whole}.${frac.toString().padStart(precision, "0")}`;
}

function normalizeChainPin(data: Record<string, unknown>): {
  pinHash: string;
  pinHeight: number;
} {
  const head = (data?.chainHead as Record<string, unknown>) ?? data ?? {};
  const pinHash = String(head.pinHash || "");
  const pinHeight = Number(head.pinHeight ?? head.height);
  if (!pinHash || !Number.isFinite(pinHeight)) {
    throw new Error("Chain head response missing pinHash or pinHeight");
  }
  return { pinHash, pinHeight };
}

/** Parse a recipient address (40-char raw or 48-char checksummed). */
export function parseRecipientAddress(raw: string): string {
  const clean = String(raw || "")
    .trim()
    .replace(/^0x/i, "")
    .toLowerCase();
  if (!clean) {
    throw new Error("Please enter a recipient address");
  }
  if (!/^[0-9a-f]+$/.test(clean)) {
    throw new Error("Address must be hex");
  }
  if (clean.length === 48) {
    const payload = clean.slice(0, 40);
    const checksum = clean.slice(40);
    const expected = ethers.sha256("0x" + payload).slice(2, 10);
    if (checksum !== expected) {
      throw new Error("Invalid address checksum");
    }
    return clean;
  }
  if (clean.length === 40) {
    const checksum = ethers.sha256("0x" + clean).slice(2, 10);
    return clean + checksum;
  }
  throw new Error("Address must be 40 or 48 hex characters");
}

export function validateWarthogAddress(raw: string): boolean {
  try {
    parseRecipientAddress(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch WART balance + chain pin (mainnet `/balance` vs DeFi `/wart_balance`).
 * Returns total / available / locked so UIs can show free vs open-order locks.
 */
export async function fetchBalanceAndPin(
  nodeBase: string,
  address: string,
): Promise<BalanceResult> {
  const defi = isDefiNode(nodeBase);
  const headData = await nodeGet<Record<string, unknown>>(nodeBase, "chain/head");
  const { pinHash, pinHeight } = normalizeChainPin(headData);

  let container: unknown = null;
  let nextNonce = 0;

  if (defi) {
    const data = await nodeGet<{
      wart?: unknown;
      balance?: unknown;
      account?: { nonceId?: number };
    }>(nodeBase, `account/${address}/wart_balance`);
    container = data?.wart ?? data?.balance;
    nextNonce = Number(data?.account?.nonceId) || 0;
  } else {
    try {
      const data = await nodeGet<Record<string, unknown>>(
        nodeBase,
        `account/${address}/balance`,
      );
      container = data?.balance;
      if (container == null && (data as { balanceE8?: unknown }).balanceE8 != null) {
        container = { E8: (data as { balanceE8: unknown }).balanceE8 };
      } else if (typeof container === "number" || typeof container === "string") {
        const n = parseFloat(String(container));
        if (Number.isFinite(n)) {
          container = {
            str: String(container),
            E8: Math.round(n * 1e8),
          };
        }
      }
      nextNonce =
        Number(data?.nonceId) ||
        Number((data as { nextNonce?: number })?.nextNonce) ||
        0;
    } catch {
      // Fallback for hybrid nodes
      const data = await nodeGet<{ wart?: unknown }>(
        nodeBase,
        `account/${address}/wart_balance`,
      );
      container = data?.wart;
      nextNonce = 0;
    }
  }

  const breakdown = formatBalanceBreakdown(container, { kind: "wart" });

  return {
    balance: breakdown.total,
    available: breakdown.available,
    locked: breakdown.locked,
    hasLocked: breakdown.hasLocked,
    nextNonce: Number.isFinite(nextNonce) ? nextNonce : 0,
    pinHeight,
    pinHash,
    network: defi ? "defi-testnet" : "mainnet",
  };
}

function formatFeeE8(e8: bigint | number | string): string {
  try {
    const n = Number(e8) / 1e8;
    return Number.isFinite(n) ? n.toFixed(8).replace(/\.?0+$/, "") : DEFAULT_TX_FEE;
  } catch {
    return DEFAULT_TX_FEE;
  }
}

/** Round fee via node encode16bit helper (accepted compact fee). */
async function roundFeeE8(nodeBase: string, feeWart: string): Promise<bigint> {
  try {
    const data = await nodeGet<{ roundedE8?: number | string }>(
      nodeBase,
      `tools/encode16bit/from_string/${encodeURIComponent(feeWart)}`,
    );
    if (data?.roundedE8 != null) return BigInt(data.roundedE8);
  } catch {
    // fall through
  }
  // Local approximate: parse to E8
  const n = Number(feeWart);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid fee "${feeWart}"`);
  }
  return BigInt(Math.round(n * 1e8));
}

/** Effective fee: max(preferred DEFAULT_TX_FEE, node minimum). */
export async function computeSuggestedTxFee(nodeBase: string): Promise<string> {
  try {
    const data = await nodeGet<{ minFee?: { E8?: number | string; str?: string } }>(
      nodeBase,
      "transaction/minfee",
    );
    const minFee = data?.minFee;
    if (minFee?.E8 == null) return DEFAULT_TX_FEE;

    const preferredE8 = await roundFeeE8(nodeBase, DEFAULT_TX_FEE);
    const minE8 = BigInt(minFee.E8);
    if (preferredE8 >= minE8) {
      return formatFeeE8(preferredE8);
    }
    return minFee.str || formatFeeE8(minE8);
  } catch {
    return DEFAULT_TX_FEE;
  }
}

export type SendWartParams = {
  nodeBase: string;
  /** Private key hex (64 chars, no 0x) */
  privateKeyHex: string;
  toAddress: string;
  amountWart: string | number;
  feeWart?: string;
  nonceId?: number;
};

export type SendWartResult = {
  txHash: string;
  feeE8: string;
  amountE8: string;
  nonceId: number;
  pinHeight: number;
};

function wartToE8(amount: string | number): bigint {
  const s = String(amount).trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`Invalid amount "${amount}"`);
  }
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "00000000").slice(0, 8);
  return BigInt(whole) * 100000000n + BigInt(fracPadded);
}

function signTransfer(
  pinHash: string,
  pinHeight: number,
  nonceId: number,
  feeE8: bigint,
  toAddr48: string,
  amountE8: bigint,
  privateKeyHex: string,
): string {
  const buf1 = Buffer.from(pinHash, "hex");
  const buf2 = Buffer.alloc(19);
  buf2.writeUInt32BE(pinHeight, 0);
  buf2.writeUInt32BE(nonceId, 4);
  buf2.writeUInt8(0, 8);
  buf2.writeUInt8(0, 9);
  buf2.writeUInt8(0, 10);
  buf2.writeBigUInt64BE(feeE8, 11);
  const buf3 = Buffer.from(toAddr48.slice(0, 40), "hex");
  const buf4 = Buffer.alloc(8);
  buf4.writeBigUInt64BE(amountE8, 0);
  const toSign = Buffer.concat([buf1, buf2, buf3, buf4]);

  const signHash = ethers.sha256("0x" + toSign.toString("hex")).slice(2);
  const signed = secp256k1.ecdsaSign(
    Uint8Array.from(Buffer.from(signHash, "hex")),
    Uint8Array.from(Buffer.from(privateKeyHex, "hex")),
  );
  const signatureWithoutRecid = Buffer.from(signed.signature);
  const signatureWithoutRecidNormalized = secp256k1.signatureNormalize(
    signed.signature,
  );
  let recid = signed.recid;
  if (Buffer.compare(signatureWithoutRecid, signatureWithoutRecidNormalized) !== 0) {
    recid = recid ^ 1;
  }
  const recidBuffer = Buffer.alloc(1);
  recidBuffer.writeUint8(recid);
  return Buffer.concat([signatureWithoutRecidNormalized, recidBuffer]).toString(
    "hex",
  );
}

/**
 * Build + sign + submit a WART transfer.
 * - Mainnet: amountE8 payload (website webwallet)
 * - DeFi testnet: wartE8 + type wartTransfer (wartbunker / core-defi)
 */
export async function sendWartTransfer(
  params: SendWartParams,
): Promise<SendWartResult> {
  const { nodeBase, privateKeyHex, toAddress, amountWart } = params;
  const feeStr = String(params.feeWart ?? DEFAULT_TX_FEE).trim() || DEFAULT_TX_FEE;
  const amountE8 = wartToE8(amountWart);
  if (amountE8 <= 0n) throw new Error("Amount must be positive");

  const feeE8 = await roundFeeE8(nodeBase, feeStr);

  // Enforce min fee when available
  try {
    const minData = await nodeGet<{ minFee?: { E8?: number | string } }>(
      nodeBase,
      "transaction/minfee",
    );
    if (minData?.minFee?.E8 != null && feeE8 < BigInt(minData.minFee.E8)) {
      throw new Error(
        `Fee must be at least ${formatFeeE8(minData.minFee.E8)} WART`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Fee must")) throw err;
  }

  const headData = await nodeGet<Record<string, unknown>>(nodeBase, "chain/head");
  const pin = normalizeChainPin(headData);
  const nonceId = Number.isFinite(params.nonceId) ? Number(params.nonceId) : 0;
  const toAddr = parseRecipientAddress(toAddress);
  const signature65 = signTransfer(
    pin.pinHash,
    pin.pinHeight,
    nonceId,
    feeE8,
    toAddr,
    amountE8,
    privateKeyHex.replace(/^0x/i, ""),
  );

  let postdata: Record<string, unknown>;
  if (isDefiNode(nodeBase)) {
    postdata = {
      type: "wartTransfer",
      pinHeight: pin.pinHeight,
      nonceId,
      feeE8: Number(feeE8),
      toAddr,
      wartE8: Number(amountE8),
      signature65,
    };
  } else {
    postdata = {
      pinHeight: pin.pinHeight,
      nonceId,
      toAddr,
      amountE8: Number(amountE8),
      feeE8: Number(feeE8),
      signature65,
    };
  }

  const result = await nodePost<{ txHash?: string }>(
    nodeBase,
    "transaction/add",
    postdata,
  );

  return {
    txHash: result?.txHash || "",
    feeE8: String(feeE8),
    amountE8: String(amountE8),
    nonceId,
    pinHeight: pin.pinHeight,
  };
}

export type HistoryItem = {
  date: string;
  action: string;
  amount: string;
  /** Raw amount without sign / unit (for mobile-style cards). */
  amountRaw?: string;
  usdAmount: string;
  txHash?: string;
  direction?: "in" | "out" | "self" | "unknown";
  type?: string;
  fromAddress?: string;
  toAddress?: string;
  height?: number;
  confirmations?: number;
  timestamp?: number | null;
  isReward?: boolean;
  isIncoming?: boolean;
  asset?: string;
  description?: string;
  fee?: string;
  source?: "indexer" | "node";
  meta?: Record<string, unknown> | null;
  assetName?: string | null;
  assetHash?: string | null;
  assetDecimals?: number | null;
  amountSecondary?: string | null;
  side?: string;
  orderAmount?: string;
  limitPrice?: string;
  baseAmount?: string;
  quoteAmount?: string;
  swapCount?: number;
};

export type HistoryFetchResult = {
  items: HistoryItem[];
  hasMore: boolean;
  nextPage?: number;
  source: "indexer" | "node";
  fromId?: number | null;
};

function getAmountStr(v: unknown, fallback = "0"): string {
  if (v == null) return fallback;
  if (typeof v === "string") return v.trim() || fallback;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : fallback;
  if (typeof v === "object") {
    const obj = v as { str?: string; E8?: number | string };
    if (obj.str) return obj.str;
    if (obj.E8 !== undefined) return formatAmountFromRaw(obj.E8, 8);
  }
  return fallback;
}

type FlatTx = {
  amount: string;
  toAddress?: string;
  fromAddress?: string;
  txHash?: string;
  isReward?: boolean;
  height?: number;
  timestamp?: number | null;
  confirmations?: number;
  category?: string;
};

/**
 * Flatten node history `perBlock` pages (mainnet + DeFi shapes) into display rows.
 * Mirrors wartbunker `parseHistoryBlocks` / website webwallet activity.
 */
function flattenHistoryPage(rawData: Record<string, unknown>): FlatTx[] {
  const perBlock = rawData?.perBlock;
  if (!Array.isArray(perBlock)) return [];

  const items: FlatTx[] = [];

  const pushFlat = (entry: Record<string, unknown>, block: Record<string, unknown>, hint: string) => {
    // DeFi nested: { transaction: { data, hash, signedCommon }, historyId }
    const nested = (entry?.transaction as Record<string, unknown>) || entry;
    const data = (nested?.data as Record<string, unknown>) || entry;
    const common =
      (nested?.signedCommon as Record<string, unknown>) ||
      (nested?.signingData as Record<string, unknown>) ||
      {};

    const isReward =
      hint === "reward" ||
      Boolean(entry?.txHash && !entry?.fromAddress) ||
      Boolean(!common.originAddress && data.amount && !data.toAddress);

    const amountField =
      data.amount ?? entry.amount ?? entry.amountE8 ?? data.wart ?? data.wartE8;
    const amount = getAmountStr(amountField);

    const toAddress = String(
      data.toAddress || entry.toAddress || entry.toAddr || "",
    );
    const fromAddress = String(
      common.originAddress ||
        data.fromAddress ||
        entry.fromAddress ||
        entry.fromAddr ||
        "",
    );

    const header = block.header as { time?: { timestamp?: number; UTC?: string } } | undefined;
    const timestamp =
      header?.time?.timestamp ||
      Number(block.timestamp) ||
      null;

    items.push({
      amount,
      toAddress,
      fromAddress: fromAddress || undefined,
      txHash: String(
        nested.hash || entry.txHash || entry.hash || entry.txid || "",
      ),
      isReward,
      height: Number(block.height) || undefined,
      timestamp,
      confirmations: Number(block.confirmations) || undefined,
      category: hint,
    });
  };

  for (const block of perBlock as Record<string, unknown>[]) {
    const body =
      (block.body as Record<string, unknown>) ||
      (block.transactions as Record<string, unknown>) ||
      {};

    // Mainnet shape: transactions.rewards / transactions.transfers
    const rewards = (body.rewards ||
      (block.transactions as { rewards?: unknown[] })?.rewards) as
      | unknown[]
      | undefined;
    if (Array.isArray(rewards)) {
      rewards.forEach((r) =>
        pushFlat(r as Record<string, unknown>, block, "reward"),
      );
    }

    const transfers = (body.transfers ||
      (block.transactions as { transfers?: unknown[] })?.transfers) as
      | unknown[]
      | undefined;
    if (Array.isArray(transfers)) {
      transfers.forEach((t) =>
        pushFlat(t as Record<string, unknown>, block, "wartTransfer"),
      );
    }

    // DeFi single reward object
    if (body.reward) {
      const list = Array.isArray(body.reward) ? body.reward : [body.reward];
      list.forEach((r) =>
        pushFlat(r as Record<string, unknown>, block, "reward"),
      );
    }

    const defiKeys = [
      "wartTransfer",
      "tokenTransfer",
      "limitSwap",
      "liquidityDeposit",
      "liquidityWithdrawal",
      "assetCreation",
      "match",
      "cancelation",
    ];
    for (const key of defiKeys) {
      const arr = body[key];
      if (!Array.isArray(arr)) continue;
      const hint =
        key === "wartTransfer"
          ? "wartTransfer"
          : key === "tokenTransfer"
            ? "tokenTransfer"
            : key;
      arr.forEach((entry) =>
        pushFlat(entry as Record<string, unknown>, block, hint),
      );
    }
  }

  return items;
}

function toHistoryItem(tx: FlatTx, viewingAddress: string): HistoryItem {
  const account = viewingAddress.toLowerCase().replace(/^0x/i, "");
  const to = (tx.toAddress || "").toLowerCase();
  const from = (tx.fromAddress || "").toLowerCase();

  let direction: HistoryItem["direction"] = "unknown";
  if (tx.isReward) direction = "in";
  else if (from && from.startsWith(account.slice(0, 40)) && to.startsWith(account.slice(0, 40)))
    direction = "self";
  else if (from && from.startsWith(account.slice(0, 40))) direction = "out";
  else if (to && to.startsWith(account.slice(0, 40))) direction = "in";
  else if (tx.isReward) direction = "in";

  const ts = Number(tx.timestamp || 0);
  const date =
    ts > 0
      ? new Date(ts * (ts < 1e12 ? 1000 : 1)).toLocaleString()
      : tx.height
        ? `Block ${tx.height}`
        : "Unknown date";

  const signedAmount =
    direction === "out"
      ? `-${tx.amount}`
      : direction === "in"
        ? `+${tx.amount}`
        : tx.amount;

  const action = tx.isReward
    ? "Reward"
    : direction === "out"
      ? "Send WART"
      : direction === "in"
        ? "Receive WART"
        : tx.category || "Transfer";

  const isIncoming = direction === "in";
  const description = tx.isReward
    ? `Block reward ${tx.amount} WART`
    : direction === "out"
      ? `Sent ${tx.amount} WART`
      : direction === "in"
        ? `Received ${tx.amount} WART`
        : `${tx.category || "Transfer"} ${tx.amount} WART`;

  return {
    date,
    action,
    amount: `${signedAmount} WART`,
    amountRaw: tx.amount,
    usdAmount: "",
    txHash: tx.txHash,
    direction,
    type: tx.category || (tx.isReward ? "reward" : "wart_transfer"),
    fromAddress: tx.fromAddress,
    toAddress: tx.toAddress,
    height: tx.height,
    confirmations: tx.confirmations,
    timestamp: tx.timestamp ?? null,
    isReward: Boolean(tx.isReward),
    isIncoming,
    asset: "WART",
    description,
  };
}

/**
 * Fetch a page of account history.
 * Prefers explorer indexer on DeFi (rich `meta` cards); falls back to node RPC.
 */
export async function fetchAccountHistory(
  nodeBase: string,
  address: string,
  options:
    | number
    | string
    | {
        beforeTxIndex?: number | string;
        page?: number;
        filter?: string;
      } = {},
): Promise<HistoryFetchResult> {
  // Back-compat: third arg used to be beforeTxIndex only.
  const opts =
    typeof options === "object" && options !== null
      ? options
      : { beforeTxIndex: options as number | string };

  const beforeTxIndex = opts.beforeTxIndex ?? 4294967295;
  const page = Math.max(1, opts.page ?? 1);
  const filterId = opts.filter || "all";

  // Indexer path (DeFi testnet) — rich meta for limit swaps / matches / etc.
  try {
    const { fetchIndexerHistoryPage } = await import("./warthogIndexer");
    const indexed = await fetchIndexerHistoryPage(nodeBase, address, {
      page,
      filter: filterId,
    });
    if (indexed && indexed.items.length >= 0 && indexed.source === "indexer") {
      // Accept empty first page as success (account may truly have no txs of this filter).
      return {
        items: indexed.items as HistoryItem[],
        hasMore: indexed.hasMore,
        nextPage: indexed.nextPage,
        source: "indexer",
        fromId: null,
      };
    }
  } catch (err) {
    console.warn("[history] indexer path failed, falling back to node", err);
  }

  const data = await nodeGet<Record<string, unknown>>(
    nodeBase,
    `account/${address}/history/${beforeTxIndex}`,
  );

  const flat = flattenHistoryPage(data || {});
  const items = flat.map((tx) => {
    const item = toHistoryItem(tx, address);
    item.source = "node";
    return item;
  });
  const fromId =
    data && typeof (data as { fromId?: number }).fromId === "number"
      ? (data as { fromId: number }).fromId
      : null;

  return {
    items,
    hasMore: items.length > 0 && !!fromId && fromId > 0,
    fromId: fromId && fromId > 0 ? fromId : null,
    source: "node",
  };
}

/** Convenience: return items only (legacy call sites). */
export async function fetchAccountHistoryItems(
  nodeBase: string,
  address: string,
  beforeTxIndex: number | string = 4294967295,
): Promise<HistoryItem[]> {
  const result = await fetchAccountHistory(nodeBase, address, { beforeTxIndex });
  return result.items;
}

/** Lightweight health/latency check for a node. */
export async function probeNode(
  nodeBase: string,
  address?: string | null,
): Promise<{ online: boolean; latencyMs: number }> {
  const start = performance.now();
  try {
    await nodeGet(nodeBase, "chain/head");
    if (address) {
      if (isDefiNode(nodeBase)) {
        await nodeGet(nodeBase, `account/${address}/wart_balance`);
      } else {
        try {
          await nodeGet(nodeBase, `account/${address}/balance`);
        } catch {
          // balance may 404 for empty accounts — head success is enough
        }
      }
    }
    return { online: true, latencyMs: performance.now() - start };
  } catch {
    return { online: false, latencyMs: performance.now() - start };
  }
}

export { isDefiNode, isMainnetNode, normalizeNodeUrl };
