/**
 * Uniswap-style swap interface adapted from wartbunker DexPage.
 * Market | Limit | Pool — market = LIMIT_SWAP at spot ± slippage.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  amountExceedsAvailable,
  insufficientFreeBalanceMessage,
  mapInsufficientBalanceError,
} from "../utils/balanceBreakdown";
import {
  computePoolSpotPrice,
  depositLiquidityTx,
  encodeLimitPriceHex,
  fetchAssetBalance,
  fetchLiquidityBalance,
  getDexMarket,
  isValidAssetHash,
  limitSwapTx,
  normalizeAssetHash,
  withdrawLiquidityTx,
  type DefiAssetBalance,
} from "../utils/defiClient";
import SpendConfirm from "./SpendConfirm";

const DEFAULT_MARKET_SLIPPAGE_PCT = 5;

export type SwapOrderMode = "market" | "limit" | "pool";

type TokenOption = {
  hash: string;
  symbol: string;
  name: string;
  decimals: number;
  available: string;
  locked: string;
  total: string;
};

type PaySpendable = {
  available: string;
  locked: string;
  total: string;
  unit: string;
  hasLocked: boolean;
  decimals?: number;
};

function formatSpot(price: number | null, maxDecimals = 8): string {
  if (price == null || !Number.isFinite(price) || price <= 0) return "—";
  if (price >= 1) return price.toPrecision(6);
  if (price >= 0.0001) return price.toFixed(Math.min(maxDecimals, 8));
  return price.toExponential(4);
}

function formatEstimate(n: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1) return n.toPrecision(6);
  if (n >= 1e-6) return n.toFixed(8).replace(/\.?0+$/, "");
  return n.toExponential(4);
}

type Props = {
  nodeUrl: string;
  wallet: string;
  fee: string;
  onFeeChange: (v: string) => void;
  wartAvailable: string;
  wartLocked: string;
  wartBalance: string;
  assetBalances: DefiAssetBalance[];
  prefillHash?: string;
  prefillName?: string;
  prefillDecimals?: number;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setStatus: (v: string | null) => void;
  setError: (v: string | null) => void;
  onSuccess: () => Promise<void>;
  /** Called when selected asset changes (for chart parent). */
  onAssetChange?: (hash: string, name: string, decimals: number) => void;
  initialMode?: SwapOrderMode;
};

export default function SwapDexPanel({
  nodeUrl,
  wallet,
  fee,
  onFeeChange,
  wartAvailable,
  wartLocked,
  wartBalance,
  assetBalances,
  prefillHash,
  prefillName,
  prefillDecimals,
  busy,
  setBusy,
  setStatus,
  setError,
  onSuccess,
  onAssetChange,
  initialMode = "market",
}: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [orderMode, setOrderMode] = useState<SwapOrderMode>(initialMode);
  const [payingWart, setPayingWart] = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<TokenOption | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [slippagePct, setSlippagePct] = useState(String(DEFAULT_MARKET_SLIPPAGE_PCT));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [manualHashInput, setManualHashInput] = useState("");
  const [assetDecimals, setAssetDecimals] = useState(8);

  const [spotPrice, setSpotPrice] = useState<number | null>(null);
  const [marketInfo, setMarketInfo] = useState<Record<string, unknown> | null>(
    null,
  );
  const [marketLoading, setMarketLoading] = useState(false);
  const [lpBalance, setLpBalance] = useState<string | null>(null);

  const [paySpendable, setPaySpendable] = useState<PaySpendable | null>(null);
  const [liqMode, setLiqMode] = useState<"deposit" | "withdraw">("deposit");
  const [lpAssetAmt, setLpAssetAmt] = useState("");
  const [lpWartAmt, setLpWartAmt] = useState("");
  const [lpShares, setLpShares] = useState("");

  const tokenOptions = useMemo<TokenOption[]>(() => {
    return (assetBalances || [])
      .map((a) => ({
        hash: normalizeAssetHash(a.hash),
        symbol: a.name || "TOKEN",
        name: a.name || "Asset",
        decimals: a.decimals ?? 8,
        available: a.available ?? a.balance ?? "0",
        locked: a.locked ?? "0",
        total: a.balance ?? a.available ?? "0",
      }))
      .filter((t) => t.hash && t.hash.length === 64);
  }, [assetBalances]);

  const assetHash = selectedAsset?.hash || "";

  // Prefill from overview / openDexFor
  useEffect(() => {
    if (!prefillHash) return;
    const hash = normalizeAssetHash(prefillHash);
    if (!isValidAssetHash(hash)) return;
    const match = tokenOptions.find((t) => t.hash === hash);
    const token: TokenOption =
      match ||
      ({
        hash,
        symbol: prefillName || "TOKEN",
        name: prefillName || "Asset",
        decimals: prefillDecimals ?? 8,
        available: "0",
        locked: "0",
        total: "0",
      } as TokenOption);
    setSelectedAsset(token);
    setAssetDecimals(token.decimals);
    setManualHashInput(hash);
  }, [prefillHash, prefillName, prefillDecimals, tokenOptions]);

  // Auto-select first tracked asset
  useEffect(() => {
    if (!selectedAsset && tokenOptions.length > 0) {
      setSelectedAsset(tokenOptions[0]);
      setAssetDecimals(tokenOptions[0].decimals);
      setManualHashInput(tokenOptions[0].hash);
    }
  }, [tokenOptions, selectedAsset]);

  useEffect(() => {
    if (selectedAsset) {
      onAssetChange?.(
        selectedAsset.hash,
        selectedAsset.symbol,
        selectedAsset.decimals,
      );
    }
  }, [selectedAsset, onAssetChange]);

  const loadMarket = useCallback(
    async (hash: string) => {
      if (!hash || !isValidAssetHash(hash)) {
        setSpotPrice(null);
        setMarketInfo(null);
        setLpBalance(null);
        return null;
      }
      setMarketLoading(true);
      try {
        const [m, lp] = await Promise.all([
          getDexMarket(nodeUrl, hash) as Promise<Record<string, unknown>>,
          fetchLiquidityBalance(nodeUrl, wallet, hash),
        ]);
        const spot = computePoolSpotPrice(m);
        const asset = (m.baseAsset || m.asset || {}) as {
          name?: string;
          decimals?: number;
        };
        const decimals = asset.decimals ?? 8;
        setSpotPrice(spot);
        setMarketInfo(m);
        setAssetDecimals(decimals);
        if (lp) {
          setLpBalance(lp.balance);
          if (lp.name) {
            setSelectedAsset((prev) =>
              prev && prev.hash === normalizeAssetHash(hash)
                ? {
                    ...prev,
                    symbol: lp.name,
                    name: lp.name,
                    decimals: lp.decimals,
                  }
                : prev,
            );
          }
          setAssetDecimals(lp.decimals);
        } else {
          setLpBalance(null);
        }
        if (asset.name) {
          setSelectedAsset((prev) =>
            prev && prev.hash === normalizeAssetHash(hash)
              ? {
                  ...prev,
                  symbol: String(asset.name),
                  name: String(asset.name),
                  decimals,
                }
              : prev,
          );
        }
        return { spot, data: m, decimals };
      } catch {
        setSpotPrice(null);
        setMarketInfo(null);
        setLpBalance(null);
        return null;
      } finally {
        setMarketLoading(false);
      }
    },
    [nodeUrl, wallet],
  );

  useEffect(() => {
    if (assetHash) void loadMarket(assetHash);
  }, [assetHash, loadMarket]);

  const refreshPaySpendable = useCallback(async (): Promise<PaySpendable | null> => {
    if (!wallet || !nodeUrl) {
      setPaySpendable(null);
      return null;
    }
    try {
      if (payingWart) {
        const info: PaySpendable = {
          available: wartAvailable || "0",
          locked: wartLocked || "0",
          total: wartBalance || wartAvailable || "0",
          unit: "WART",
          hasLocked: parseFloat(wartLocked || "0") > 0,
          decimals: 8,
        };
        setPaySpendable(info);
        return info;
      }
      if (!isValidAssetHash(assetHash)) {
        setPaySpendable(null);
        return null;
      }
      try {
        const live = await fetchAssetBalance(nodeUrl, wallet, assetHash);
        const info: PaySpendable = {
          available: live.available,
          locked: live.locked,
          total: live.balance,
          unit: live.name || selectedAsset?.symbol || "asset",
          hasLocked: parseFloat(live.locked || "0") > 0,
          decimals: live.decimals,
        };
        setPaySpendable(info);
        if (live.decimals != null) setAssetDecimals(live.decimals);
        return info;
      } catch {
        const match = tokenOptions.find((t) => t.hash === assetHash);
        if (match) {
          const info: PaySpendable = {
            available: match.available,
            locked: match.locked,
            total: match.total,
            unit: match.symbol,
            hasLocked: parseFloat(match.locked || "0") > 0,
            decimals: match.decimals,
          };
          setPaySpendable(info);
          return info;
        }
        setPaySpendable(null);
        return null;
      }
    } catch {
      setPaySpendable(null);
      return null;
    }
  }, [
    wallet,
    nodeUrl,
    payingWart,
    wartAvailable,
    wartLocked,
    wartBalance,
    assetHash,
    selectedAsset,
    tokenOptions,
  ]);

  useEffect(() => {
    const t = setTimeout(() => void refreshPaySpendable(), 80);
    return () => clearTimeout(t);
  }, [refreshPaySpendable]);

  const displayPayAvailable = useMemo(() => {
    if (paySpendable) return paySpendable;
    if (payingWart) {
      return {
        available: wartAvailable || "0",
        locked: wartLocked || "0",
        total: wartBalance || wartAvailable || "0",
        unit: "WART",
        hasLocked: parseFloat(wartLocked || "0") > 0,
      } as PaySpendable;
    }
    const match = tokenOptions.find((t) => t.hash === assetHash);
    if (match) {
      return {
        available: match.available,
        locked: match.locked,
        total: match.total,
        unit: match.symbol,
        hasLocked: parseFloat(match.locked || "0") > 0,
      } as PaySpendable;
    }
    return null;
  }, [
    paySpendable,
    payingWart,
    wartAvailable,
    wartLocked,
    wartBalance,
    tokenOptions,
    assetHash,
  ]);

  const effectiveLimitPrice = useMemo(() => {
    if (orderMode === "limit") {
      const p = parseFloat(String(limitPrice).replace(",", "."));
      return Number.isFinite(p) && p > 0 ? p : null;
    }
    if (spotPrice == null || spotPrice <= 0) return null;
    const slip =
      Math.max(
        0,
        Math.min(50, parseFloat(slippagePct) || DEFAULT_MARKET_SLIPPAGE_PCT),
      ) / 100;
    return payingWart ? spotPrice * (1 + slip) : spotPrice * (1 - slip);
  }, [orderMode, limitPrice, spotPrice, slippagePct, payingWart]);

  const receiveEstimate = useMemo(() => {
    const amt = parseFloat(String(payAmount).replace(",", "."));
    if (
      !Number.isFinite(amt) ||
      amt <= 0 ||
      effectiveLimitPrice == null ||
      effectiveLimitPrice <= 0
    ) {
      return null;
    }
    if (payingWart) return amt / effectiveLimitPrice;
    return amt * effectiveLimitPrice;
  }, [payAmount, effectiveLimitPrice, payingWart]);

  const fillMax = async () => {
    const info = paySpendable || (await refreshPaySpendable());
    if (!info) {
      setError(
        payingWart
          ? "Could not load available WART"
          : "Select an asset and load balance first",
      );
      return;
    }
    setPayAmount(info.available);
    setStatus(`Filled available: ${info.available} ${info.unit}`);
  };

  const flipDirection = () => {
    setPayingWart((v) => !v);
    setPayAmount("");
  };

  const selectToken = (token: TokenOption) => {
    setSelectedAsset(token);
    setAssetDecimals(token.decimals ?? 8);
    setManualHashInput(token.hash);
    setShowTokenPicker(false);
  };

  const applyManualHash = () => {
    const hash = normalizeAssetHash(manualHashInput);
    if (!isValidAssetHash(hash)) {
      setError("Asset hash must be 64 hex characters");
      return;
    }
    const match = tokenOptions.find((t) => t.hash === hash);
    const token: TokenOption =
      match ||
      ({
        hash,
        symbol: hash.slice(0, 4).toUpperCase(),
        name: "Asset",
        decimals: assetDecimals || 8,
        available: "0",
        locked: "0",
        total: "0",
      } as TokenOption);
    setSelectedAsset(token);
    setStatus("Asset selected");
    setError(null);
  };

  const handleSwap = async (confirmed = false) => {
    if (!assetHash || !isValidAssetHash(assetHash)) {
      setError("Select a token to swap");
      return;
    }
    const amountStr = String(payAmount).trim().replace(",", ".");
    if (!amountStr || parseFloat(amountStr) <= 0) {
      setError("Enter an amount");
      return;
    }

    let priceForEncode = effectiveLimitPrice;
    if (orderMode === "limit") {
      const p = parseFloat(String(limitPrice).replace(",", "."));
      if (!Number.isFinite(p) || p <= 0) {
        setError("Enter a valid limit price (WART per token)");
        return;
      }
      priceForEncode = p;
    } else if (priceForEncode == null) {
      const m = await loadMarket(assetHash);
      if (!m?.spot) {
        setError(
          "No pool spot price — cannot place a market order. Try Limit instead.",
        );
        return;
      }
      const slip =
        Math.max(
          0,
          Math.min(50, parseFloat(slippagePct) || DEFAULT_MARKET_SLIPPAGE_PCT),
        ) / 100;
      priceForEncode = payingWart ? m.spot * (1 + slip) : m.spot * (1 - slip);
    }

    if (!confirmed) {
      setConfirmOpen(true);
      return;
    }
    setConfirmOpen(false);
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const spendable = await refreshPaySpendable();
      let decimalsNum = assetDecimals || 8;
      if (spendable) {
        if (!payingWart && spendable.decimals != null) {
          decimalsNum = spendable.decimals;
        }
        if (amountExceedsAvailable(amountStr, spendable.available)) {
          setPayAmount(spendable.available);
          throw new Error(
            insufficientFreeBalanceMessage({
              available: spendable.available,
              locked: spendable.locked,
              unit: spendable.unit,
            }),
          );
        }
      }

      const limitHex = encodeLimitPriceHex(
        String(priceForEncode),
        decimalsNum,
        payingWart,
      );
      if (!limitHex || limitHex.length !== 6) {
        throw new Error(
          "Failed to encode limit price — try a different price or amount",
        );
      }

      try {
        const r = await limitSwapTx(nodeUrl, wallet, {
          assetHash,
          isBuy: payingWart,
          amount: amountStr,
          assetDecimals: decimalsNum,
          limitPrice: limitHex,
          fee,
        });
        const label =
          orderMode === "market"
            ? payingWart
              ? "Market buy submitted"
              : "Market sell submitted"
            : payingWart
              ? "Limit buy placed"
              : "Limit sell placed";
        setStatus(
          orderMode === "market"
            ? `${label} — may fill against the pool · ${r.txHash || "ok"}`
            : `${label} — funds may stay locked until filled · ${r.txHash || "ok"}`,
        );
        setPayAmount("");
        await onSuccess();
        void loadMarket(assetHash);
        void refreshPaySpendable();
      } catch (e) {
        throw new Error(
          mapInsufficientBalanceError(e, {
            available: spendable?.available || "0",
            locked: spendable?.locked || "0",
            unit: spendable?.unit || "token",
          }),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Swap failed");
    } finally {
      setBusy(false);
    }
  };

  const handleLiquidityDeposit = async () => {
    if (!isValidAssetHash(assetHash)) {
      setError("Select a pool token");
      return;
    }
    if (!lpAssetAmt || !lpWartAmt) {
      setError("Asset and WART amounts required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await depositLiquidityTx(nodeUrl, wallet, {
        assetHash,
        assetAmount: lpAssetAmt,
        wartAmount: lpWartAmt,
        decimals: assetDecimals || 8,
        fee,
      });
      setStatus(`LP deposit · ${r.txHash || "ok"}`);
      setLpAssetAmt("");
      setLpWartAmt("");
      await onSuccess();
      void loadMarket(assetHash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deposit failed");
    } finally {
      setBusy(false);
    }
  };

  const handleLiquidityWithdraw = async () => {
    if (!isValidAssetHash(assetHash)) {
      setError("Select a pool token");
      return;
    }
    if (!lpShares) {
      setError("LP shares amount required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await withdrawLiquidityTx(nodeUrl, wallet, {
        assetHash,
        shares: lpShares,
        fee,
      });
      setStatus(`LP withdraw · ${r.txHash || "ok"}`);
      setLpShares("");
      await onSuccess();
      void loadMarket(assetHash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setBusy(false);
    }
  };

  const swapDisabled = busy || !assetHash;
  const submitLabel = (() => {
    if (busy) return orderMode === "market" ? "Swapping…" : "Placing order…";
    if (!selectedAsset) return "Select a token";
    if (!payAmount) return "Enter an amount";
    if (orderMode === "limit" && !limitPrice) return "Enter limit price";
    if (orderMode === "market" && spotPrice == null && !marketLoading)
      return "No pool price";
    if (orderMode === "market") return payingWart ? "Buy" : "Sell";
    return payingWart ? "Place buy limit" : "Place sell limit";
  })();

  const pairLabel = selectedAsset?.symbol
    ? payingWart
      ? `WART → ${selectedAsset.symbol}`
      : `${selectedAsset.symbol} → WART`
    : "Pick a token";

  const poolPairLabel = selectedAsset?.symbol
    ? `${selectedAsset.symbol} / WART pool`
    : "Pick a token for the pool";

  const ctaBlocked =
    submitLabel === "Select a token" ||
    submitLabel === "Enter an amount" ||
    submitLabel === "Enter limit price" ||
    submitLabel === "No pool price";

  return (
    <div className="swap-page swap-page--embedded w-full">
      <div className="dex-tabs flex w-full gap-1.5 p-1 bg-zinc-950/80 border border-zinc-800/80 rounded-full mb-2.5">
        {(
          [
            { id: "market" as const, label: "Market" },
            { id: "limit" as const, label: "Limit" },
            { id: "pool" as const, label: "Pool" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setOrderMode(tab.id);
              if (tab.id === "pool" && assetHash) {
                void loadMarket(assetHash);
              }
            }}
            className={`dex-tab-btn${orderMode === tab.id ? " dex-tab-btn--active" : ""}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Pool / Liquidity ── */}
      {orderMode === "pool" && (
        <div className="swap-card w-full swap-card--soft">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-800/50 px-3 pt-3 pb-2.5">
            <div className="min-w-0">
              <h2 className="font-semibold tracking-tight text-sm !text-zinc-100 !mb-0.5">
                Liquidity pool
              </h2>
              <p className="text-[11px] text-zinc-600 tabular-nums truncate">
                {poolPairLabel}
              </p>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => setLiqMode("deposit")}
                className={`swap-chip-btn${liqMode === "deposit" ? " swap-chip-btn--active" : ""}`}
              >
                Deposit
              </button>
              <button
                type="button"
                onClick={() => setLiqMode("withdraw")}
                className={`swap-chip-btn${liqMode === "withdraw" ? " swap-chip-btn--active" : ""}`}
              >
                Withdraw
              </button>
            </div>
          </div>

          {!selectedAsset && (
            <div className="swap-empty-banner mt-3">
              Pick a token under Your Assets, or paste a hash below. First
              deposit can create the pool.
            </div>
          )}

          <div className="p-2.5 space-y-2.5">
            <div className="swap-panel !min-h-0">
              <div className="flex items-center justify-between gap-2 mb-2.5">
                <span className="text-xs text-zinc-500">Pool token</span>
                <button
                  type="button"
                  onClick={() => void loadMarket(assetHash)}
                  disabled={marketLoading || !assetHash}
                  className="swap-chip-btn"
                >
                  {marketLoading ? "Loading…" : "Load pool"}
                </button>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setShowTokenPicker(true)}
                  className="swap-token-btn"
                >
                  <span className="w-6 h-6 rounded-full bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center">
                    {(selectedAsset?.symbol || "?")[0]}
                  </span>
                  <span>{selectedAsset?.symbol || "Select"}</span>
                  <span className="text-zinc-500 text-xs">▾</span>
                </button>
                <input
                  value={manualHashInput || assetHash}
                  onChange={(e) => setManualHashInput(e.target.value)}
                  onBlur={applyManualHash}
                  placeholder="Or paste 64-char asset hash"
                  className="defi-input !mb-0 flex-1 min-w-[10rem] font-mono text-xs"
                />
              </div>
              {lpBalance != null && (
                <p className="text-[10px] text-zinc-500 mt-2">
                  Your LP shares:{" "}
                  <span className="text-amber-400/90 tabular-nums">
                    {lpBalance}
                  </span>
                </p>
              )}
              {spotPrice != null && (
                <p className="text-[10px] text-zinc-500 mt-1">
                  Spot:{" "}
                  <span className="text-zinc-300 tabular-nums">
                    {formatSpot(spotPrice)}
                  </span>{" "}
                  WART
                </p>
              )}
            </div>

            {liqMode === "deposit" ? (
              <>
                <div className="swap-legs">
                  <div className="swap-panel">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs text-zinc-500">You deposit</span>
                      <span className="text-[10px] text-zinc-600">
                        {selectedAsset?.symbol || "Asset"}
                      </span>
                    </div>
                    <div className="swap-amount-row">
                      <div className="swap-amount-value">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={lpAssetAmt}
                          onChange={(e) => setLpAssetAmt(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowTokenPicker(true)}
                        className="swap-token-btn"
                      >
                        <span className="w-6 h-6 rounded-full bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center">
                          {(selectedAsset?.symbol || "?")[0]}
                        </span>
                        <span>{selectedAsset?.symbol || "Select"}</span>
                      </button>
                    </div>
                  </div>
                  <div className="swap-legs-flip">
                    <div
                      className="swap-flip-btn !cursor-default opacity-90"
                      aria-hidden
                    >
                      <span className="text-sm font-semibold text-zinc-400">
                        +
                      </span>
                    </div>
                  </div>
                  <div className="swap-panel">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-xs text-zinc-500">You deposit</span>
                      <span className="text-[10px] text-zinc-600">WART</span>
                    </div>
                    <div className="swap-amount-row">
                      <div className="swap-amount-value">
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={lpWartAmt}
                          onChange={(e) => setLpWartAmt(e.target.value)}
                        />
                      </div>
                      <div className="swap-token-static flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-950/80 border border-zinc-700/80">
                        <span className="w-6 h-6 rounded-full bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center">
                          W
                        </span>
                        <span className="font-semibold text-zinc-100 text-sm">
                          WART
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleLiquidityDeposit()}
                  disabled={busy || !assetHash}
                  className="swap-cta-btn"
                >
                  {busy ? "Depositing…" : "Deposit liquidity"}
                </button>
              </>
            ) : (
              <>
                <div className="swap-panel">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs text-zinc-500">
                      LP shares to redeem
                    </span>
                    {lpBalance ? (
                      <button
                        type="button"
                        onClick={() => setLpShares(lpBalance)}
                        className="swap-chip-btn"
                      >
                        Fill from position
                      </button>
                    ) : null}
                  </div>
                  <div className="swap-amount-row">
                    <div className="swap-amount-value">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0"
                        value={lpShares}
                        onChange={(e) => setLpShares(e.target.value)}
                      />
                    </div>
                    <div className="swap-token-static flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-950/80 border border-zinc-700/80">
                      <span className="w-6 h-6 rounded-full bg-amber-700/80 text-zinc-100 text-xs font-bold flex items-center justify-center">
                        LP
                      </span>
                      <span className="font-semibold text-zinc-100 text-sm">
                        Shares
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleLiquidityWithdraw()}
                  disabled={busy || !assetHash}
                  className="swap-cta-btn"
                >
                  {busy ? "Withdrawing…" : "Withdraw liquidity"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Market / Limit swap ── */}
      {orderMode !== "pool" && (
        <div className="swap-card w-full swap-card--soft">
          <div className="flex items-start justify-between gap-3 border-b border-zinc-800/50 px-3 pt-3 pb-2.5">
            <div>
              <h2 className="font-semibold tracking-tight text-sm !text-zinc-100 !mb-0.5">
                {orderMode === "market" ? "Swap" : "Limit order"}
              </h2>
              <p className="text-[11px] text-zinc-600 tabular-nums">
                {pairLabel}
              </p>
            </div>
            <div className="text-right">
              {spotPrice != null ? (
                <div className="text-[11px] text-zinc-500 tabular-nums">
                  <span className="text-zinc-600 block text-[10px] uppercase tracking-wide mb-0.5">
                    Spot
                  </span>
                  <span className="text-zinc-300">{formatSpot(spotPrice)}</span>
                  <span className="text-zinc-600"> WART</span>
                </div>
              ) : marketLoading ? (
                <div className="text-[11px] text-zinc-600">Loading price…</div>
              ) : selectedAsset ? (
                <div className="text-[11px] text-zinc-600">No pool price</div>
              ) : null}
            </div>
          </div>

          {!selectedAsset && (
            <div className="swap-empty-banner mt-3">
              No tracked tokens yet. Add one under Your Assets, then pick it
              here.
            </div>
          )}

          <div className="p-2.5 space-y-2.5">
            <div className="swap-legs">
              <div className="swap-panel">
                <div className="flex items-start justify-between gap-3 mb-2.5">
                  <span className="text-xs text-zinc-500 shrink-0 pt-0.5">
                    You pay
                  </span>
                  {displayPayAvailable && (
                    <button
                      type="button"
                      onClick={() => void fillMax()}
                      className="swap-balance-btn"
                      title="Use available balance"
                    >
                      <span className="text-zinc-500">Available </span>
                      <span className="text-zinc-300 tabular-nums">
                        {displayPayAvailable.available}
                      </span>
                      <span className="text-zinc-500">
                        {" "}
                        {displayPayAvailable.unit}
                      </span>
                      {displayPayAvailable.hasLocked ? (
                        <span className="block text-[10px] text-zinc-600 mt-0.5">
                          Locked{" "}
                          <span className="text-amber-500/80 tabular-nums">
                            {displayPayAvailable.locked}
                          </span>
                        </span>
                      ) : null}
                    </button>
                  )}
                </div>
                <div className="swap-amount-row">
                  <div className="swap-amount-value">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void fillMax()}
                    className="swap-chip-btn"
                  >
                    MAX
                  </button>
                  {payingWart ? (
                    <div className="swap-token-static flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-950/80 border border-zinc-700/80">
                      <span className="w-6 h-6 rounded-full bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center">
                        W
                      </span>
                      <span className="font-semibold text-zinc-100 text-sm">
                        WART
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowTokenPicker(true)}
                      className="swap-token-btn"
                    >
                      <span className="w-6 h-6 rounded-full bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center">
                        {(selectedAsset?.symbol || "?")[0]}
                      </span>
                      <span>{selectedAsset?.symbol || "Select"}</span>
                      <span className="text-zinc-500 text-xs">▾</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="swap-legs-flip">
                <button
                  type="button"
                  onClick={flipDirection}
                  className="swap-flip-btn"
                  title="Flip direction"
                  aria-label="Flip swap direction"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"
                    />
                  </svg>
                </button>
              </div>

              <div className="swap-panel">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs text-zinc-500">You receive</span>
                  {orderMode === "market" && (
                    <span className="text-[10px] text-zinc-600">
                      Estimate · {slippagePct}% slip
                    </span>
                  )}
                  {orderMode === "limit" && limitPrice && (
                    <span className="text-[10px] text-zinc-600">
                      At your limit
                    </span>
                  )}
                </div>
                <div className="swap-amount-row">
                  <div className="swap-amount-value text-white">
                    {receiveEstimate != null ? (
                      <span className="text-white">
                        {formatEstimate(receiveEstimate)}
                      </span>
                    ) : (
                      <span className="text-zinc-700">0</span>
                    )}
                  </div>
                  {!payingWart ? (
                    <div className="swap-token-static flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-950/80 border border-zinc-700/80">
                      <span className="w-6 h-6 rounded-full bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center">
                        W
                      </span>
                      <span className="font-semibold text-zinc-100 text-sm">
                        WART
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowTokenPicker(true)}
                      className="swap-token-btn"
                    >
                      <span className="w-6 h-6 rounded-full bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center">
                        {(selectedAsset?.symbol || "?")[0]}
                      </span>
                      <span>{selectedAsset?.symbol || "Select"}</span>
                      <span className="text-zinc-500 text-xs">▾</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {orderMode === "limit" && (
              <div className="swap-panel">
                <label className="text-xs text-zinc-500 block mb-2">
                  Limit price{" "}
                  <span className="text-zinc-600">
                    (WART per {selectedAsset?.symbol || "token"})
                  </span>
                </label>
                <div className="swap-amount-row">
                  <div className="swap-amount-value">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(e.target.value)}
                      placeholder={
                        spotPrice != null ? formatSpot(spotPrice) : "0.0"
                      }
                    />
                  </div>
                  {spotPrice != null && (
                    <button
                      type="button"
                      onClick={() => setLimitPrice(String(spotPrice))}
                      className="swap-chip-btn"
                    >
                      Use spot
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="swap-summary space-y-1.5 text-[11px] text-zinc-500">
              {orderMode === "market" && effectiveLimitPrice != null && (
                <div className="flex justify-between gap-3">
                  <span>Max price (slippage)</span>
                  <span className="text-zinc-400 tabular-nums shrink-0">
                    {formatSpot(effectiveLimitPrice)} WART
                  </span>
                </div>
              )}
              {orderMode === "limit" && effectiveLimitPrice != null && (
                <div className="flex justify-between gap-3">
                  <span>Your limit</span>
                  <span className="text-zinc-400 tabular-nums shrink-0">
                    {formatSpot(effectiveLimitPrice)} /{" "}
                    {selectedAsset?.symbol || "token"}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <span>Network fee</span>
                <span className="text-zinc-400 tabular-nums shrink-0">
                  {fee} WART
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleSwap(false)}
              disabled={swapDisabled || ctaBlocked}
              className="swap-cta-btn"
            >
              {submitLabel}
            </button>
          </div>
        </div>
      )}

      <p className="swap-hint">
        {orderMode === "market"
          ? "Market uses pool spot ± slippage so the order can fill right away."
          : orderMode === "limit"
            ? "Limit rests on the book until matched. Locked balance frees when filled or cancelled."
            : "Deposit asset + WART to mint LP shares. First deposit creates the pool and sets the initial price."}
      </p>

      {(orderMode === "market" || orderMode === "limit") && (
        <div className="swap-advanced mt-3">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="swap-advanced-btn"
            aria-expanded={showAdvanced}
          >
            <span
              className={`swap-advanced-chevron${showAdvanced ? " is-open" : ""}`}
              aria-hidden
            >
              ▶
            </span>
            <span className="flex-1 text-left">
              <span className="block font-medium text-zinc-300 text-sm">
                Advanced
              </span>
              <span className="block text-[11px] text-zinc-600 mt-0.5">
                Fee &amp; slippage
              </span>
            </span>
            <span className="text-[11px] text-zinc-600 shrink-0">
              {showAdvanced ? "Hide" : "Show"}
            </span>
          </button>
          {showAdvanced && (
            <div className="px-3 pb-4 border-t border-zinc-800/80 space-y-3 pt-3">
              <div className="swap-adv-field">
                <span className="swap-adv-label">Network fee (WART)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={fee}
                  onChange={(e) => onFeeChange(e.target.value)}
                  className="defi-input !mb-0 text-sm"
                />
              </div>
              {orderMode === "market" && (
                <div className="swap-adv-field">
                  <span className="swap-adv-label">Slippage (%)</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={slippagePct}
                    onChange={(e) => setSlippagePct(e.target.value)}
                    className="defi-input !mb-0 text-sm"
                  />
                  <p className="swap-adv-hint">
                    Buy: max price = spot × (1 + slip). Sell: min = spot × (1 −
                    slip).
                  </p>
                </div>
              )}
              {marketInfo && (
                <details>
                  <summary className="defi-hint text-left cursor-pointer">
                    Pool snapshot
                  </summary>
                  <div className="defi-stat-grid mt-2">
                    {(() => {
                      const pool = (marketInfo.liquidityPool ||
                        marketInfo.liquidity ||
                        {}) as Record<string, unknown>;
                      return (
                        <>
                          <div className="defi-stat-box">
                            <div className="defi-stat-label">WART</div>
                            <div className="defi-stat-value">
                              {String(
                                (pool.wart as { str?: string })?.str ||
                                  pool.wart ||
                                  pool.WART ||
                                  "—",
                              )}
                            </div>
                          </div>
                          <div className="defi-stat-box">
                            <div className="defi-stat-label">Asset</div>
                            <div className="defi-stat-value">
                              {String(
                                (pool.asset as { str?: string })?.str ||
                                  pool.asset ||
                                  "—",
                              )}
                            </div>
                          </div>
                          <div className="defi-stat-box">
                            <div className="defi-stat-label">Spot</div>
                            <div className="defi-stat-value">
                              {formatSpot(spotPrice)}
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}

      {/* Token picker modal */}
      {showTokenPicker && (
        <div
          className="swap-token-picker-overlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowTokenPicker(false)}
        >
          <div
            className="swap-token-picker"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-zinc-100 m-0">
                Select token
              </h3>
              <button
                type="button"
                className="swap-chip-btn"
                onClick={() => setShowTokenPicker(false)}
              >
                Close
              </button>
            </div>
            <div className="mb-3">
              <input
                className="defi-input !mb-1 font-mono text-xs"
                value={manualHashInput}
                onChange={(e) => setManualHashInput(e.target.value)}
                placeholder="Paste 64-char asset hash"
              />
              <button
                type="button"
                className="swap-chip-btn w-full"
                onClick={() => {
                  applyManualHash();
                  setShowTokenPicker(false);
                }}
              >
                Use hash
              </button>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {tokenOptions.length === 0 ? (
                <p className="text-xs text-zinc-500 py-4 text-center">
                  No tracked assets. Add tokens under Your Assets.
                </p>
              ) : (
                tokenOptions.map((t) => (
                  <button
                    key={t.hash}
                    type="button"
                    className={`swap-token-row${
                      selectedAsset?.hash === t.hash
                        ? " swap-token-row--active"
                        : ""
                    }`}
                    onClick={() => selectToken(t)}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-7 h-7 rounded-full bg-zinc-700 text-zinc-200 text-xs font-bold flex items-center justify-center shrink-0">
                        {t.symbol[0]}
                      </span>
                      <span className="min-w-0 text-left">
                        <span className="block text-sm font-semibold text-zinc-100 truncate">
                          {t.symbol}
                        </span>
                        <span className="block text-[10px] text-zinc-600 font-mono truncate">
                          {t.hash.slice(0, 10)}…
                        </span>
                      </span>
                    </span>
                    <span className="text-xs text-zinc-400 tabular-nums shrink-0">
                      {t.available}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
      <SpendConfirm
        open={confirmOpen}
        title="Confirm swap"
        rows={[
          { label: "Token", value: selectedAsset?.symbol || assetHash || "—" },
          { label: "Amount", value: `${payAmount || "—"} ${payingWart ? "WART" : selectedAsset?.symbol || "token"}` },
          { label: "Fee", value: `${fee} WART` },
          { label: "Mode", value: orderMode },
        ]}
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void handleSwap(true)}
      />
    </div>
  );
}
