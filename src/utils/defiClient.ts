/**
 * DeFi testnet helpers (wartbunker core functions) via warthog-js.
 * Only used when the selected node is a DeFi/testnet node.
 */
import {
  Account,
  Address,
  Funds,
  Liquidity,
  NonceId,
  Price,
  RoundedFee,
  TokenPrecision,
  Wart,
  WarthogApi,
  encodeLimitPrice,
  normalizeChainPin,
  type TransactionJson,
} from "warthog-js";
import { DEFAULT_TX_FEE } from "../config/network";
import { normalizeNodeUrl } from "./nodes";
import { formatBalanceBreakdown } from "./balanceBreakdown";

/** Matches mobile-wallet AssetBalance / OpenOrders shapes. */
export type DefiAssetBalance = {
  hash: string;
  name: string;
  /** Total holdings (available + locked). Backward-compatible field. */
  balance: string;
  available: string;
  locked: string;
  hasLocked: boolean;
  decimals: number;
};

export type OpenLimitOrder = {
  txHash?: string;
  amount?: { str?: string };
  filled?: { str?: string };
  limit?: { doubleAdjusted?: number; hex?: string };
  formattedLimitPrice?: string;
  inMempool?: boolean;
};

export type OpenOrdersByAsset = {
  baseAsset: {
    hash?: string;
    id?: number;
    name?: string;
    decimals?: number;
  };
  wartToAssetSwaps?: OpenLimitOrder[];
  assetToWartSwaps?: OpenLimitOrder[];
};

export type LiquidityPosition = {
  hash: string;
  name: string;
  assetId?: number;
  decimals: number;
  lpBalance: string;
  poolWart: string;
  poolAsset: string;
};

export type AssetInfo = {
  hash?: string;
  assetHash?: string;
  id?: number;
  name?: string;
  decimals?: number;
};

function serializeTx(tx: TransactionJson): TransactionJson {
  const out: Record<string, unknown> = { ...tx };
  for (const key of Object.keys(out)) {
    if (typeof out[key] === "bigint") {
      out[key] = Number(out[key]);
    }
  }
  return out as TransactionJson;
}

export function createDefiApi(nodeBase: string): WarthogApi {
  const base = normalizeNodeUrl(nodeBase);
  if (!base) throw new Error("Invalid node URL");
  return new WarthogApi(base);
}

export function accountFromPrivateKey(privateKeyHex: string): Account {
  const clean = privateKeyHex.replace(/^0x/i, "");
  return Account.fromPrivateKeyHex(clean);
}

function nonceStorageKey(address: string) {
  return `warthogNextNonce_${address.toLowerCase()}`;
}

export function getSmartNonce(address: string, fallback = 0): number {
  try {
    const stored = localStorage.getItem(nonceStorageKey(address));
    const n = stored ? Number(stored) : 0;
    return Math.max(n, fallback, 0);
  } catch {
    return fallback;
  }
}

export function bumpNonce(address: string, usedNonce: number): number {
  const next = Math.max(getSmartNonce(address), usedNonce + 1);
  try {
    localStorage.setItem(nonceStorageKey(address), String(next));
  } catch {
    // ignore
  }
  return next;
}

async function resolveFee(
  api: WarthogApi,
  feeInput?: string,
): Promise<RoundedFee> {
  const feeStr = String(feeInput ?? DEFAULT_TX_FEE).trim() || DEFAULT_TX_FEE;
  const preferred = Wart.parse(feeStr)?.roundedFee(true);
  if (!preferred) throw new Error(`Invalid fee "${feeStr}"`);

  try {
    const feeRes = await api.getMinFee();
    if (feeRes.success) {
      const minE8 = BigInt(
        (feeRes.data as { minFee?: { E8?: number | string } })?.minFee?.E8 ?? 0,
      );
      if (preferred.E8 < minE8) {
        throw new Error(
          `Fee too low (min ${(Number(minE8) / 1e8).toFixed(8)} WART)`,
        );
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Fee too")) throw e;
  }
  return preferred;
}

type BuildFn = (
  ctx: Awaited<ReturnType<WarthogApi["createTransactionContext"]>>,
  account: Account,
) => TransactionJson;

async function signAndSubmit(
  nodeBase: string,
  privateKeyHex: string,
  address: string,
  buildTx: BuildFn,
  opts?: { fee?: string; nonceId?: number },
): Promise<{ txHash: string; nonce: number }> {
  const api = createDefiApi(nodeBase);
  const fee = await resolveFee(api, opts?.fee);
  const nonceId = opts?.nonceId ?? getSmartNonce(address);
  const nonce = NonceId.fromNumber(nonceId);
  if (!nonce) throw new Error(`Invalid nonce ${nonceId}`);

  const account = accountFromPrivateKey(privateKeyHex);
  const ctx = await api.createTransactionContext(fee, nonce);
  const tx = serializeTx(buildTx(ctx, account));
  const submit = await api.submitTransaction(tx);
  if (!submit.success) {
    throw new Error(submit.error || "Node rejected transaction");
  }
  const txHash =
    (submit.data as { txHash?: string })?.txHash ||
    (tx as { hash?: string }).hash ||
    "";
  bumpNonce(address, nonceId);
  return { txHash, nonce: nonceId };
}

export function normalizeAssetHash(raw: string): string {
  return raw.trim().replace(/^0x/i, "").toLowerCase();
}

export function isValidAssetHash(hash: string): boolean {
  const h = normalizeAssetHash(hash);
  return h.length === 64 && /^[0-9a-f]+$/.test(h);
}

function formatAmountFromRaw(raw: bigint | number | string, precision = 8): string {
  const value = BigInt(raw);
  const divisor = 10n ** BigInt(precision);
  const whole = value / divisor;
  const frac = value % divisor;
  if (precision === 0) return whole.toString();
  const fracStr = frac.toString().padStart(precision, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

function formatBalanceObj(obj: unknown, decimals = 8): string {
  if (obj == null) return "0";
  if (typeof obj === "object") {
    const o = obj as { str?: string; E8?: number | string; u64?: number | string };
    if (o.str) return o.str;
    if (o.E8 !== undefined) return formatAmountFromRaw(o.E8, 8);
    if (o.u64 !== undefined) return formatAmountFromRaw(o.u64, decimals);
  }
  if (typeof obj === "string" || typeof obj === "number") return String(obj);
  return "0";
}

/** Fetch asset balance for one hash (total / available / locked). */
export async function fetchAssetBalance(
  nodeBase: string,
  address: string,
  assetHash: string,
): Promise<DefiAssetBalance> {
  const api = createDefiApi(nodeBase);
  const hash = normalizeAssetHash(assetHash);
  const res = await api.getAccountAssetBalance(address, hash);
  if (!res.success) {
    throw new Error(res.error || "Failed to fetch asset balance");
  }
  const data = res.data as {
    token?: { name?: string; decimals?: number };
    balance?: unknown;
  };
  const tokenInfo = data?.token || {};
  const decimals = tokenInfo.decimals ?? 8;
  const breakdown = formatBalanceBreakdown(data?.balance, {
    kind: "token",
    decimals,
  });
  return {
    hash,
    name: tokenInfo.name || hash.slice(0, 8),
    balance: breakdown.total,
    available: breakdown.available,
    locked: breakdown.locked,
    hasLocked: breakdown.hasLocked,
    decimals,
  };
}

/** Search assets by name prefix. */
export async function searchAssets(
  nodeBase: string,
  namePrefix: string,
  hashPrefix?: string,
): Promise<unknown[]> {
  const api = createDefiApi(nodeBase);
  const res = await api.searchAssets(namePrefix, hashPrefix);
  if (!res.success) throw new Error(res.error || "Search failed");
  const data = res.data as { assets?: unknown[] } | unknown[];
  if (Array.isArray(data)) return data;
  return (data as { assets?: unknown[] })?.assets || [];
}

/**
 * Lookup a single asset by full 64-char hash.
 * Empty input is not valid for lookup — use searchAssetsDetailed("", …) to list all.
 */
export async function lookupAsset(
  nodeBase: string,
  assetHash: string,
): Promise<unknown> {
  const hash = normalizeAssetHash(assetHash);
  if (!hash) {
    throw new Error("Enter a 64-character asset hash, or use Search with empty fields to list all");
  }
  if (!isValidAssetHash(hash)) {
    throw new Error("Asset hash must be exactly 64 hex characters");
  }
  const api = createDefiApi(nodeBase);
  // Avoid bare /asset/lookup/ which nginx returns as HTML 502
  const res = await api.lookupAsset(hash);
  if (!res.success) throw new Error(res.error || "Lookup failed");
  return res.data;
}

/** DEX market info. */
export async function getDexMarket(
  nodeBase: string,
  assetHash: string,
): Promise<unknown> {
  const api = createDefiApi(nodeBase);
  const res = await api.getDexMarket(normalizeAssetHash(assetHash));
  if (!res.success) throw new Error(res.error || "Market lookup failed");
  return res.data;
}

/** Open limit orders for account (mobile-wallet OpenOrdersByAsset[] shape). */
export async function getOpenOrders(
  nodeBase: string,
  address: string,
): Promise<OpenOrdersByAsset[]> {
  const api = createDefiApi(nodeBase);
  const res = await api.getOpenOrders(address);
  if (!res.success) throw new Error(res.error || "Failed to load open orders");
  const data = res.data;
  if (!Array.isArray(data)) return [];
  return data as OpenOrdersByAsset[];
}

/**
 * Search assets — empty name + empty hash lists all (node /asset/complete).
 * Bypasses warthog-js for empty search so we control the query string and HTML errors.
 */
export async function searchAssetsDetailed(
  nodeBase: string,
  namePrefix = "",
  hashPrefix?: string,
): Promise<{ matches: AssetInfo[] }> {
  const base = normalizeNodeUrl(nodeBase);
  if (!base) throw new Error("Invalid node URL");

  const params = new URLSearchParams();
  // Always send namePrefix (empty = list all on defi testnet)
  params.set("namePrefix", namePrefix.trim());
  if (hashPrefix?.trim()) {
    params.set("hashPrefix", hashPrefix.trim().replace(/^0x/i, "").toLowerCase());
  }

  const url = `${base}/asset/complete?${params.toString()}`;
  let text: string;
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    text = await response.text();
  } catch (e) {
    throw new Error(
      e instanceof Error ? e.message : "Network error fetching assets",
    );
  }

  if (text.trimStart().startsWith("<")) {
    throw new Error(
      "Node returned HTML instead of JSON (bad path or gateway error). Try another DeFi node.",
    );
  }

  let json: { code?: number; data?: unknown; error?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from asset search");
  }

  if (json.code !== 0) {
    throw new Error(json.error || `Asset search error code ${json.code}`);
  }

  const data = json.data as { matches?: AssetInfo[] } | AssetInfo[] | undefined;
  if (Array.isArray(data)) return { matches: data };
  return { matches: data?.matches ?? [] };
}

function parseDisplayAmount(v: unknown, fallback = "0"): string {
  if (v == null) return fallback;
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    const o = v as { str?: string; E8?: number | string; u64?: number | string };
    if (o.str) return o.str;
    if (o.E8 !== undefined) return formatAmountFromRaw(o.E8, 8);
    if (o.u64 !== undefined) return formatAmountFromRaw(o.u64, 8);
  }
  return fallback;
}

export function computePoolSpotPrice(marketData: Record<string, unknown>): number | null {
  const pool = (marketData.liquidityPool || marketData.liquidity) as
    | Record<string, unknown>
    | undefined;
  if (!pool) return null;
  const wart = parseFloat(parseDisplayAmount(pool.wart || pool.WART, "0"));
  const asset = parseFloat(parseDisplayAmount(pool.asset, "0"));
  if (!Number.isFinite(wart) || !Number.isFinite(asset) || asset <= 0) return null;
  return wart / asset;
}

export async function fetchLiquidityBalance(
  nodeBase: string,
  address: string,
  assetHash: string,
): Promise<{ balance: string; name: string; decimals: number } | null> {
  const api = createDefiApi(nodeBase);
  const hash = normalizeAssetHash(assetHash);
  const res = await api.getNodePath(
    `account/${address}/balance/liquidity:${hash}`,
  );
  if (!res.success || !res.data) return null;
  const data = res.data as {
    token?: { name?: string; decimals?: number };
    asset?: { name?: string; decimals?: number };
    balance?: { total?: unknown } | unknown;
  };
  const balanceInfo =
    (data.balance as { total?: unknown })?.total || data.balance || data;
  const tokenInfo = data.token || data.asset || {};
  const decimals = Number(tokenInfo.decimals ?? 8);
  const balStr = formatBalanceObj(balanceInfo, decimals);
  if (!balStr || balStr === "0" || parseFloat(balStr) <= 0) return null;
  return {
    balance: balStr,
    name: String(tokenInfo.name || "Asset"),
    decimals,
  };
}

export async function fetchLiquidityPositions(
  nodeBase: string,
  address: string,
  assetHashes: string[],
  knownAssets: DefiAssetBalance[] = [],
): Promise<LiquidityPosition[]> {
  const unique = [...new Set(assetHashes.map(normalizeAssetHash))];
  const positions = await Promise.all(
    unique.map(async (hash) => {
      try {
        const [lp, market] = await Promise.all([
          fetchLiquidityBalance(nodeBase, address, hash),
          getDexMarket(nodeBase, hash).catch(() => null),
        ]);
        if (!lp) return null;
        const m = market as Record<string, unknown> | null;
        const base = (m?.baseAsset || m?.asset || {}) as Record<string, unknown>;
        const pool = (m?.liquidityPool || m?.liquidity || {}) as Record<
          string,
          unknown
        >;
        const known = knownAssets.find(
          (a) => a.hash.toLowerCase() === hash,
        );
        return {
          hash,
          name: String(base.name || lp.name || known?.name || "Asset"),
          assetId: base.id != null ? Number(base.id) : undefined,
          decimals: lp.decimals,
          lpBalance: lp.balance,
          poolWart: parseDisplayAmount(pool.wart || pool.WART),
          poolAsset: parseDisplayAmount(pool.asset),
        } as LiquidityPosition;
      } catch {
        return null;
      }
    }),
  );
  return positions.filter((p): p is LiquidityPosition => p != null);
}

/** Fake-mine a block to the given address (testnet/debug only). */
export async function fakeMine(
  nodeBase: string,
  address: string,
): Promise<unknown> {
  const api = createDefiApi(nodeBase);
  const res = await api.fakeMine(address);
  if (!res.success) throw new Error(res.error || "Fake mine failed");
  return res.data;
}

/** Encode human limit price → 6-char hex (same as mobile-wallet LimitPriceEncoder). */
export function encodeLimitPriceHex(
  priceStr: string,
  decimals = 8,
  ceil = false,
): string {
  try {
    return encodeLimitPrice(String(priceStr).trim(), decimals, { ceil });
  } catch {
    if (!ceil) {
      return encodeLimitPrice(String(priceStr).trim(), decimals, { ceil: true });
    }
    throw new Error("Could not encode limit price");
  }
}

export async function createAssetTx(
  nodeBase: string,
  privateKeyHex: string,
  address: string,
  params: { name: string; supply: string; decimals: number; fee?: string },
) {
  const assetName = params.name.trim().toUpperCase();
  if (!assetName || assetName.length > 5) {
    throw new Error("Asset name must be 1–5 characters");
  }
  const precisionValue = Math.min(Math.max(params.decimals || 8, 0), 18);
  const precision = new TokenPrecision(precisionValue);
  const totalSupply = Funds.parse(String(params.supply).trim(), precision);
  if (!totalSupply) throw new Error("Invalid total supply");

  return signAndSubmit(
    nodeBase,
    privateKeyHex,
    address,
    (ctx, account) =>
      ctx.createAssets(account, totalSupply, precision, assetName),
    { fee: params.fee },
  );
}

export async function transferAssetTx(
  nodeBase: string,
  privateKeyHex: string,
  address: string,
  params: {
    assetHash: string;
    toAddress: string;
    amount: string;
    decimals: number;
    isLiquidity?: boolean;
    fee?: string;
  },
) {
  const hash = normalizeAssetHash(params.assetHash);
  if (!isValidAssetHash(hash)) throw new Error("Invalid asset hash");
  const cleanTo = params.toAddress.trim().replace(/^0x/i, "").toLowerCase();
  const recipient =
    cleanTo.length === 48
      ? Address.fromHex(cleanTo)
      : Address.fromRaw(cleanTo);
  if (!recipient) throw new Error("Invalid recipient address");

  const amountStr = String(params.amount).trim();
  return signAndSubmit(
    nodeBase,
    privateKeyHex,
    address,
    (ctx, account) => {
      if (params.isLiquidity) {
        const units = Liquidity.parse(amountStr);
        if (!units) throw new Error("Invalid liquidity amount");
        return ctx.transferLiquidity(account, hash, recipient, units);
      }
      const precision = new TokenPrecision(
        Math.min(Math.max(params.decimals || 8, 0), 18),
      );
      const tokenAmount = Funds.parse(amountStr, precision);
      if (!tokenAmount) throw new Error("Invalid token amount");
      return ctx.transferAsset(account, hash, recipient, tokenAmount);
    },
    { fee: params.fee },
  );
}

export async function limitSwapTx(
  nodeBase: string,
  privateKeyHex: string,
  address: string,
  params: {
    assetHash: string;
    isBuy: boolean;
    amount: string;
    assetDecimals: number;
    limitPrice: string;
    fee?: string;
  },
) {
  const hash = normalizeAssetHash(params.assetHash);
  if (!isValidAssetHash(hash)) throw new Error("Invalid asset hash");
  const limitHex =
    params.limitPrice.length === 6 && /^[0-9a-f]+$/i.test(params.limitPrice)
      ? params.limitPrice.toLowerCase()
      : encodeLimitPriceHex(params.limitPrice, params.assetDecimals);
  const limit = Price.fromHex(limitHex);
  if (!limit) throw new Error("Invalid limit price encoding");
  const amountStr = String(params.amount).trim().replace(",", ".");

  return signAndSubmit(
    nodeBase,
    privateKeyHex,
    address,
    (ctx, account) => {
      if (params.isBuy) {
        const wartAmount = Wart.parse(amountStr);
        if (!wartAmount) throw new Error("Invalid WART amount");
        return ctx.buy(account, hash, wartAmount, limit);
      }
      const precision = new TokenPrecision(
        Math.min(Math.max(params.assetDecimals || 8, 0), 18),
      );
      const tokenAmount = Funds.parse(amountStr, precision);
      if (!tokenAmount) throw new Error("Invalid token amount");
      return ctx.sell(account, hash, tokenAmount, limit);
    },
    { fee: params.fee },
  );
}

export async function depositLiquidityTx(
  nodeBase: string,
  privateKeyHex: string,
  address: string,
  params: {
    assetHash: string;
    assetAmount: string;
    wartAmount: string;
    decimals: number;
    fee?: string;
  },
) {
  const hash = normalizeAssetHash(params.assetHash);
  if (!isValidAssetHash(hash)) throw new Error("Invalid asset hash");
  const precision = new TokenPrecision(
    Math.min(Math.max(params.decimals || 8, 0), 18),
  );
  const tokenAmount = Funds.parse(
    String(params.assetAmount).trim().replace(",", "."),
    precision,
  );
  if (!tokenAmount) throw new Error("Invalid asset amount");
  const wart = Wart.parse(String(params.wartAmount).trim().replace(",", "."));
  if (!wart) throw new Error("Invalid WART amount");

  return signAndSubmit(
    nodeBase,
    privateKeyHex,
    address,
    (ctx, account) => ctx.depositLiquidity(account, hash, tokenAmount, wart),
    { fee: params.fee },
  );
}

export async function withdrawLiquidityTx(
  nodeBase: string,
  privateKeyHex: string,
  address: string,
  params: { assetHash: string; shares: string; fee?: string },
) {
  const hash = normalizeAssetHash(params.assetHash);
  if (!isValidAssetHash(hash)) throw new Error("Invalid asset hash");
  const units = Liquidity.parse(
    String(params.shares).trim().replace(",", "."),
  );
  if (!units) throw new Error("Invalid LP shares amount");

  return signAndSubmit(
    nodeBase,
    privateKeyHex,
    address,
    (ctx, account) => ctx.withdrawLiquidity(account, hash, units),
    { fee: params.fee },
  );
}

async function resolveOrderCancelTarget(
  api: WarthogApi,
  txHash: string,
  accountAddress: string,
): Promise<{ cancelHeight: number; cancelNonceId: number }> {
  const normalized = txHash.trim().toLowerCase();
  const lookup = await api.getNodePath(`transaction/lookup/${normalized}`);
  if (lookup.success) {
    const signedCommon = (
      lookup.data as {
        transaction?: { signedCommon?: { pinHeight?: number; nonceId?: number } };
      }
    )?.transaction?.signedCommon;
    if (signedCommon?.pinHeight != null && signedCommon?.nonceId != null) {
      return {
        cancelHeight: Number(signedCommon.pinHeight),
        cancelNonceId: Number(signedCommon.nonceId),
      };
    }
  }

  const mem = await api.getAccountMempool(accountAddress);
  if (mem.success && Array.isArray(mem.data)) {
    for (const entry of mem.data as {
      transaction?: {
        hash?: string;
        signedCommon?: { pinHeight?: number; nonceId?: number };
      };
    }[]) {
      if (entry?.transaction?.hash?.toLowerCase() !== normalized) continue;
      const sc = entry.transaction.signedCommon;
      if (sc?.pinHeight != null && sc?.nonceId != null) {
        return {
          cancelHeight: Number(sc.pinHeight),
          cancelNonceId: Number(sc.nonceId),
        };
      }
    }
  }

  throw new Error(
    (lookup as { error?: string }).error ||
      "Could not resolve order details for cancel",
  );
}

export async function cancelOrderTx(
  nodeBase: string,
  privateKeyHex: string,
  address: string,
  params: { orderTxHash: string; fee?: string },
) {
  const api = createDefiApi(nodeBase);
  const target = await resolveOrderCancelTarget(
    api,
    params.orderTxHash,
    address,
  );

  return signAndSubmit(
    nodeBase,
    privateKeyHex,
    address,
    (ctx, account) =>
      ctx.cancelTransaction(account, target.cancelHeight, target.cancelNonceId),
    { fee: params.fee },
  );
}

/** Parse open-order entries into a flat list for the UI. */
export function flattenOpenOrders(raw: unknown[]): {
  txHash: string;
  assetHash: string;
  side: string;
  amount: string;
  price: string;
}[] {
  const out: {
    txHash: string;
    assetHash: string;
    side: string;
    amount: string;
    price: string;
  }[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    // Common shapes: { txHash, assetHash, isBuy, amount, limit } or nested transaction
    const tx = (e.transaction as Record<string, unknown>) || e;
    const data = (tx.data as Record<string, unknown>) || e;
    const hash =
      String(e.txHash || tx.hash || e.hash || "").toLowerCase() || "";
    const assetHash = String(
      e.assetHash || data.assetHash || data.asset || "",
    ).toLowerCase();
    const isBuy =
      e.isBuy === true ||
      data.isBuy === true ||
      data.buy === true ||
      String(e.side || data.side || "").toLowerCase() === "buy";
    const amount = formatBalanceObj(
      data.amount ?? e.amount ?? data.amountU64 ?? e.amountU64,
    );
    const price =
      (data.limit as { doubleAdjusted?: number; hex?: string })?.doubleAdjusted !=
      null
        ? String((data.limit as { doubleAdjusted: number }).doubleAdjusted)
        : String(
            (data.limit as { hex?: string })?.hex ||
              data.limit ||
              e.limit ||
              "—",
          );

    if (hash) {
      out.push({
        txHash: hash,
        assetHash: assetHash || "—",
        side: isBuy ? "BUY" : "SELL",
        amount,
        price,
      });
    }
  }
  return out;
}

// re-export pin helper for any debug UI
export { normalizeChainPin };
