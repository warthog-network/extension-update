/**
 * Warthog explorer indexer client (read-only) for the browser extension.
 * History + indexed lookups; live balance / submit stay on node RPC.
 * See wartbunker docs/WARTBUNKER-INDEXER-RICH-CARDS-CLIENT-GUIDE.md
 */

import { DEFI_TESTNET_URL } from "../config/network";
import { isDefiNode, normalizeNodeUrl } from "./nodes";

/** Public DeFi testnet indexer (nginx → warthog-read-api). */
export const DEFAULT_INDEXER_BASE = `${DEFI_TESTNET_URL.replace(/\/+$/, "")}/api/explorer`;

const PAGE_COUNT_DEFAULT = 50;
const PAGE_COUNT_MAX = 100;

function isLoopbackNode(node: string): boolean {
  try {
    const u = new URL(normalizeNodeUrl(node));
    const h = u.hostname.toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0";
  } catch {
    return /localhost|127\.0\.0\.1/i.test(node);
  }
}

function envIndexerBase(): string | null {
  try {
    const raw = import.meta.env?.VITE_WARTHOG_INDEXER_URL;
    if (raw && String(raw).trim()) {
      return String(raw).trim().replace(/\/+$/, "");
    }
  } catch {
    /* no env */
  }
  return null;
}

/**
 * Resolve explorer indexer base for a connected node, or null → node history.
 * - VITE_WARTHOG_INDEXER_URL wins
 * - DeFi / public testnet → public indexer
 * - Loopback custom nodes → no remote indexer
 */
export function resolveIndexerBase(nodeBase: string): string | null {
  const fromEnv = envIndexerBase();
  if (fromEnv) return fromEnv;

  const node = normalizeNodeUrl(nodeBase);
  if (!node) return null;

  try {
    const u = new URL(node);
    if (u.hostname.toLowerCase().includes("defitestnet")) {
      return `${node.replace(/\/+$/, "")}/api/explorer`;
    }
  } catch {
    /* ignore */
  }

  if (isLoopbackNode(node)) return null;
  if (isDefiNode(node)) return DEFAULT_INDEXER_BASE;
  return null;
}

export function cleanIndexerAddress(address: string): string {
  return String(address || "")
    .trim()
    .replace(/^0x/i, "")
    .toLowerCase();
}

export async function indexerFetch(indexerBase: string, path: string): Promise<unknown> {
  const base = String(indexerBase || "").replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  // Only CORS-safelisted headers (no Cache-Control — preflight fails on public indexer).
  const res = await fetch(`${base}${p}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Indexer HTTP ${res.status}`);
  return res.json();
}

export async function fetchIndexerHealth(
  indexerBase: string,
): Promise<{ ok: boolean; dbHeight: number | null }> {
  const body = (await indexerFetch(indexerBase, "/health")) as {
    ok?: boolean;
    dbHeight?: number;
  };
  if (body && typeof body === "object" && "ok" in body) {
    return {
      ok: Boolean(body.ok),
      dbHeight: Number.isFinite(Number(body.dbHeight)) ? Number(body.dbHeight) : null,
    };
  }
  return { ok: false, dbHeight: null };
}

export type IndexerServerFilter = {
  group?: string;
  direction?: string;
  type?: string;
  types?: string;
};

/** Map UI filter id → indexer query params. */
export function historyFilterToIndexerQuery(historyFilter: string): IndexerServerFilter {
  const id = String(historyFilter || "all").toLowerCase().replace(/-/g, "_");
  switch (id) {
    case "all":
      return {};
    case "rewards":
    case "reward":
      return { group: "reward" };
    case "transfers":
    case "transfer":
      return { group: "transfer" };
    case "limit_swaps":
    case "limit_swap":
    case "limitswap":
      return { group: "limit_swap" };
    case "matches":
    case "match":
      return { group: "match" };
    case "cancels":
    case "cancel":
    case "cancelation":
    case "cancellation":
      return { group: "cancelation" };
    case "asset_creations":
    case "asset_creation":
      return { group: "asset_creation" };
    case "liquidity":
      return { group: "liquidity" };
    case "in":
      return { direction: "in" };
    case "out":
      return { direction: "out" };
    default:
      return {};
  }
}

export type IndexerTxMeta = {
  summary?: string;
  side?: string;
  order_amount?: string;
  asset_name?: string;
  asset_hash?: string;
  asset_decimals?: number;
  limit_price?: string;
  base_amount?: string;
  quote_amount?: string;
  swap_count?: number;
  token_amount?: string;
  supply?: string;
  shares?: string;
  cancel_txid?: string;
  [key: string]: unknown;
};

export type IndexerTxRow = {
  type?: string;
  hash?: string;
  amount?: string | number;
  fee?: string | number;
  sender?: string;
  recipient?: string;
  height?: number;
  timestamp?: number;
  nonce?: number | null;
  pinHeight?: number | null;
  direction?: string;
  meta?: IndexerTxMeta | null;
};

export async function fetchIndexerAccountTransactions(
  indexerBase: string,
  address: string,
  page = 1,
  count = PAGE_COUNT_DEFAULT,
  filter: IndexerServerFilter = {},
): Promise<{
  address: string;
  page: number;
  count: number;
  total: number | null;
  filter?: object;
  transactions: IndexerTxRow[];
}> {
  const addr = cleanIndexerAddress(address);
  if (!/^[0-9a-f]{48}$/.test(addr)) {
    throw new Error("Invalid address for indexer history");
  }
  const p = Math.max(1, Number(page) || 1);
  const c = Math.min(PAGE_COUNT_MAX, Math.max(1, Number(count) || PAGE_COUNT_DEFAULT));
  const qs = new URLSearchParams();
  qs.set("page", String(p));
  qs.set("count", String(c));
  if (filter?.group) qs.set("group", String(filter.group));
  else if (filter?.types) qs.set("types", String(filter.types));
  else if (filter?.type) qs.set("type", String(filter.type));
  if (filter?.direction) qs.set("direction", String(filter.direction));

  const body = (await indexerFetch(
    indexerBase,
    `/accounts/${addr}/transactions?${qs.toString()}`,
  )) as { code?: number; error?: string; data?: any };

  if (body?.code !== 0) {
    throw new Error(body?.error || "Indexer history error");
  }
  return body.data;
}

export function mapIndexerTxType(raw: string | undefined): string {
  const t = String(raw || "").toLowerCase().replace(/-/g, "_");
  if (!t) return "unknown";
  if (t === "reward") return "reward";
  if (t === "transfer" || t === "wart_transfer" || t === "warttransfer") return "wart_transfer";
  if (t === "token_transfer" || t === "tokentransfer") return "token_transfer";
  if (t === "limit_swap" || t === "limitswap") return "limit_swap";
  if (t === "match") return "match";
  if (t === "cancelation" || t === "cancellation" || t.includes("cancel")) return "cancelation";
  if (t === "asset_creation" || t === "assetcreation") return "asset_creation";
  if (t === "liquidity_deposit" || t === "liquiditydeposit") return "liquidity_deposit";
  if (
    t === "liquidity_withdrawal" ||
    t === "liquiditywithdrawal" ||
    t.includes("liquiditywithdraw")
  ) {
    return "liquidity_withdrawal";
  }
  return t;
}

function abbreviateAddr(value: string): string {
  const str = String(value || "");
  if (!str || str.length <= 12) return str || "N/A";
  return `${str.slice(0, 6)}...${str.slice(-4)}`;
}

function isZeroAmount(amount: string | undefined): boolean {
  const s = String(amount ?? "").trim();
  if (!s || s === "0") return true;
  return /^0+(?:\.0+)?$/.test(s);
}

/** Normalized history row shared by Home / ActivityItem. */
export type IndexerHistoryItem = {
  date: string;
  action: string;
  amount: string;
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
  meta?: IndexerTxMeta | null;
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

/**
 * Map indexer `meta` onto display fields for history cards.
 * Card detail lives on the explorer indexer (backfilled); no client getBlock hydrate.
 */
export function applyIndexerMeta(
  out: IndexerHistoryItem,
  rawMeta: IndexerTxMeta | null | undefined,
): IndexerHistoryItem {
  const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : null;
  if (!meta || !out) return out;

  const next: IndexerHistoryItem = { ...out, meta };

  if (meta.summary) next.description = String(meta.summary);
  if (meta.asset_name) next.assetName = String(meta.asset_name);
  if (meta.asset_hash) next.assetHash = String(meta.asset_hash);
  if (meta.asset_decimals != null) next.assetDecimals = Number(meta.asset_decimals);

  const type = String(next.type || "").toLowerCase();

  if (type === "limit_swap") {
    if (meta.side) next.side = String(meta.side);
    if (meta.order_amount != null) next.orderAmount = String(meta.order_amount);
    if (meta.limit_price != null) next.limitPrice = String(meta.limit_price);
    if (meta.order_amount && isZeroAmount(next.amountRaw ?? next.amount)) {
      next.amountRaw = String(meta.order_amount);
      next.amount = String(meta.order_amount);
      next.asset = meta.side === "sell" ? meta.asset_name || "ASSET" : "WART";
    } else if (meta.asset_name && meta.side === "sell") {
      next.asset = String(meta.asset_name);
    }
    if (!meta.summary) {
      const asset = meta.asset_name || "ASSET";
      const amt = meta.order_amount || next.amountRaw || next.amount || "0";
      const lim = meta.limit_price != null ? meta.limit_price : "?";
      next.description =
        meta.side === "buy"
          ? `BUY limit ${amt} WART for ${asset} @ ${lim}`
          : meta.side === "sell"
            ? `SELL limit ${amt} ${asset} @ ${lim}`
            : next.description;
    }
  }

  if (type === "match") {
    if (meta.base_amount != null) next.baseAmount = String(meta.base_amount);
    if (meta.quote_amount != null) next.quoteAmount = String(meta.quote_amount);
    if (meta.swap_count != null) next.swapCount = Number(meta.swap_count);
    if (meta.base_amount) {
      next.amountRaw = String(meta.base_amount);
      next.amount = String(meta.base_amount);
      next.asset = meta.asset_name || next.asset || "ASSET";
      if (meta.quote_amount) next.amountSecondary = `${meta.quote_amount} WART`;
    } else if (meta.asset_name) {
      next.asset = String(meta.asset_name);
    }
    if (!meta.summary) {
      const asset = meta.asset_name || "ASSET";
      const n = meta.swap_count ?? 0;
      let s = `DEX match${n ? ` (${n} swap${n === 1 ? "" : "s"})` : ""} on ${asset}`;
      if (meta.base_amount && meta.quote_amount) {
        s += ` — ${meta.base_amount} ${asset} / ${meta.quote_amount} WART`;
      }
      next.description = s;
    }
  }

  if (type === "liquidity_deposit" || type === "liquidity_withdrawal") {
    if (meta.asset_name) next.asset = String(meta.asset_name);
    if (meta.base_amount != null && meta.quote_amount != null) {
      next.amountRaw = `${meta.base_amount} + ${meta.quote_amount}`;
      next.amount = next.amountRaw;
      next.asset = meta.asset_name ? `${meta.asset_name} / WART` : "POOL";
    } else if (meta.shares != null && isZeroAmount(next.amountRaw ?? next.amount)) {
      next.amountRaw = String(meta.shares);
      next.amount = String(meta.shares);
    }
  }

  if (type === "token_transfer") {
    if (meta.asset_name) next.asset = String(meta.asset_name);
    if (meta.token_amount != null) {
      next.amountRaw = String(meta.token_amount);
      next.amount = String(meta.token_amount);
    }
  }

  if (type === "asset_creation") {
    if (meta.asset_name) next.asset = String(meta.asset_name);
    if (meta.supply != null) {
      next.amountRaw = String(meta.supply);
      next.amount = String(meta.supply);
    }
  }

  if (type === "cancelation" && meta.cancel_txid && !meta.summary) {
    next.description = `Canceled tx ${abbreviateAddr(String(meta.cancel_txid))}`;
  }

  return next;
}

function actionLabel(type: string, isReward: boolean, direction: string): string {
  if (isReward || type === "reward") return "Reward";
  if (type === "wart_transfer") {
    return direction === "out" ? "Send WART" : direction === "in" ? "Receive WART" : "Transfer";
  }
  if (type === "token_transfer") return "Token Transfer";
  if (type === "limit_swap") return "Limit Swap";
  if (type === "match") return "DEX Match";
  if (type === "cancelation") return "Cancel";
  if (type === "liquidity_deposit") return "LP Deposit";
  if (type === "liquidity_withdrawal") return "LP Withdraw";
  if (type === "asset_creation") return "Create Asset";
  return type.replace(/_/g, " ") || "Transfer";
}

export function normalizeIndexerTransaction(
  tx: IndexerTxRow,
  opts: { tipHeight?: number | null } = {},
): IndexerHistoryItem {
  const tipHeight = opts.tipHeight ?? null;
  const type = mapIndexerTxType(tx?.type);
  const isReward = type === "reward";
  const directionRaw = String(tx?.direction || "").toLowerCase();
  const sender = tx?.sender ? String(tx.sender) : "";
  const recipient = tx?.recipient ? String(tx.recipient) : "";
  const amount = tx?.amount != null ? String(tx.amount) : "0";
  const fee = tx?.fee != null ? String(tx.fee) : "0";
  const height = tx?.height != null ? Number(tx.height) : undefined;
  const timestamp = tx?.timestamp != null ? Number(tx.timestamp) : null;
  const hash = tx?.hash ? String(tx.hash) : "N/A";
  const hasAmt = !isZeroAmount(amount);

  const isIncoming =
    directionRaw === "in" || isReward || type === "liquidity_withdrawal";

  let direction: IndexerHistoryItem["direction"] = "unknown";
  if (directionRaw === "in" || directionRaw === "out" || directionRaw === "self") {
    direction = directionRaw;
  } else if (isReward) {
    direction = "in";
  } else if (isIncoming) {
    direction = "in";
  }

  let asset = "WART";
  let description = "";

  switch (type) {
    case "reward":
      description = `Block reward ${amount} WART`;
      break;
    case "wart_transfer":
      description = isIncoming
        ? `Received ${amount} WART`
        : `Sent ${amount} WART to ${abbreviateAddr(recipient)}`;
      break;
    case "token_transfer":
      asset = "TOKEN";
      description = hasAmt
        ? isIncoming
          ? `Received ${amount}`
          : `Sent ${amount}`
        : isIncoming
          ? "Received token transfer"
          : "Sent token transfer";
      break;
    case "limit_swap":
      description = hasAmt ? `Limit order ${amount}` : "Limit order placed";
      break;
    case "match":
      description = hasAmt ? `DEX match ${amount} WART` : "DEX match";
      break;
    case "cancelation":
      description = "Canceled order";
      break;
    case "liquidity_deposit":
      description = hasAmt ? `Liquidity deposit ${amount}` : "Liquidity deposit";
      break;
    case "liquidity_withdrawal":
      description = hasAmt ? `Liquidity withdrawal ${amount}` : "Liquidity withdrawal";
      break;
    case "asset_creation":
      description = hasAmt ? `Asset creation ${amount}` : "Asset creation";
      break;
    default:
      description = type || "Transaction";
  }

  let confirmations: number | undefined;
  if (
    tipHeight != null &&
    height != null &&
    Number.isFinite(tipHeight) &&
    Number.isFinite(height)
  ) {
    confirmations = Math.max(0, tipHeight - height + 1);
  }

  const ts = Number(timestamp || 0);
  const date =
    ts > 0
      ? new Date(ts * (ts < 1e12 ? 1000 : 1)).toLocaleString()
      : height
        ? `Block ${height}`
        : "Unknown date";

  const base: IndexerHistoryItem = {
    date,
    action: actionLabel(type, isReward, direction || "unknown"),
    amount,
    amountRaw: amount,
    usdAmount: "",
    txHash: hash !== "N/A" ? hash : undefined,
    direction,
    type,
    fromAddress: sender || undefined,
    toAddress: recipient || undefined,
    height,
    confirmations,
    timestamp,
    isReward,
    isIncoming,
    asset,
    description,
    fee,
    source: "indexer",
    meta: null,
    assetName: null,
    assetHash: null,
    amountSecondary: null,
  };

  return applyIndexerMeta(base, tx?.meta);
}

export function normalizeIndexerTransactions(
  transactions: IndexerTxRow[] | undefined,
  opts: { tipHeight?: number | null } = {},
): IndexerHistoryItem[] {
  if (!Array.isArray(transactions)) return [];
  return transactions.map((tx) => normalizeIndexerTransaction(tx, opts));
}

const INDEXER_PAGE_SIZE = 50;

export type HistoryFetchResult = {
  items: IndexerHistoryItem[];
  hasMore: boolean;
  nextPage?: number;
  source: "indexer" | "node";
  fromId?: number | null;
};

/**
 * Prefer explorer indexer (rich `meta` cards) on DeFi; caller falls back to node.
 */
export async function fetchIndexerHistoryPage(
  nodeBase: string,
  address: string,
  options: { page?: number; filter?: string; count?: number } = {},
): Promise<HistoryFetchResult | null> {
  const indexerBase = resolveIndexerBase(nodeBase);
  if (!indexerBase) return null;

  const page = Math.max(1, options.page ?? 1);
  const filterId = options.filter || "all";
  const count = options.count ?? INDEXER_PAGE_SIZE;

  try {
    const health = await fetchIndexerHealth(indexerBase);
    if (!health.ok) return null;

    const query = historyFilterToIndexerQuery(filterId);
    const data = await fetchIndexerAccountTransactions(
      indexerBase,
      address,
      page,
      count,
      query,
    );
    const txs = Array.isArray(data?.transactions) ? data.transactions : [];
    const items = normalizeIndexerTransactions(txs, { tipHeight: health.dbHeight });
    return {
      items,
      hasMore: txs.length >= count,
      nextPage: page + 1,
      source: "indexer",
      fromId: null,
    };
  } catch (err) {
    console.warn("[history] indexer failed", err);
    return null;
  }
}
