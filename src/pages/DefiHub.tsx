/**
 * DeFi hub — closer match to mobile-wallet overview + send asset / DEX.
 * Nav: Overview · Send Asset · Assets · DEX · Tools
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import AssetPriceChart from "../components/AssetPriceChart";
import useWallet from "../hooks/useWallet";
import { isDefiNode } from "../utils/nodes";
import { DEFAULT_TX_FEE } from "../config/network";
import { fetchBalanceAndPin } from "../utils/warthogNode";
import { fetchWartUsdPrice } from "../utils/wartPrice";
import {
  cancelOrderTx,
  computePoolSpotPrice,
  createAssetTx,
  depositLiquidityTx,
  encodeLimitPriceHex,
  fetchAssetBalance,
  fetchLiquidityBalance,
  fetchLiquidityPositions,
  getDexMarket,
  getOpenOrders,
  getSmartNonce,
  isValidAssetHash,
  limitSwapTx,
  lookupAsset,
  normalizeAssetHash,
  searchAssetsDetailed,
  transferAssetTx,
  withdrawLiquidityTx,
  type AssetInfo,
  type DefiAssetBalance,
  type LiquidityPosition,
  type OpenLimitOrder,
  type OpenOrdersByAsset,
} from "../utils/defiClient";
import {
  CHART_INTERVALS,
  loadAssetPriceChart,
  type CandlePoint,
  type ChartInterval,
  type ChartMode,
  type TradePoint,
} from "../utils/assetChart";
import {
  BRAND_COLOR_OPTIONS,
  DEFAULT_NUMBER_DISPLAY_PREFS,
  FUN_COLOR_OPTIONS,
  NUMBER_DISPLAY_MODES,
  detectMode,
  formatDisplayNumber,
  getBrandColorStyles,
  getColorHex,
  loadNumberDisplayPrefs,
  prefsForMode,
  saveNumberDisplayPrefs,
  type NumberDisplayMode,
  type NumberDisplayPrefs,
  type NumberColorId,
  type NumberNotation,
} from "../utils/numberDisplay";
import TransactionHistoryPanel from "../components/TransactionHistoryPanel";

type MainTab =
  | "overview"
  | "history"
  | "send-asset"
  | "assets"
  | "dex"
  | "tools";
type AssetsSub = "create" | "search";
type DexSub = "limit" | "liquidity" | "market";

const WATCHED_KEY = (addr: string) =>
  `warthogWatchedAssets_${addr.toLowerCase()}`;

function loadWatched(address: string): { hash: string; customName?: string }[] {
  try {
    const raw = localStorage.getItem(WATCHED_KEY(address));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x: { hash?: string; customName?: string } | string) =>
        typeof x === "string"
          ? { hash: x }
          : { hash: x.hash || "", customName: x.customName },
      )
      .filter((x) => x.hash);
  } catch {
    return [];
  }
}

function saveWatched(
  address: string,
  items: { hash: string; customName?: string }[],
) {
  try {
    localStorage.setItem(WATCHED_KEY(address), JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

function abbreviate(hex: string, head = 8, tail = 6) {
  if (!hex || hex.length <= head + tail) return hex || "—";
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`;
}

function assetGroupKey(asset: { hash?: string; id?: number }) {
  return (asset?.hash || String(asset?.id ?? "")).toLowerCase();
}

function DefiHub() {
  const navigate = useNavigate();
  const {
    wallet,
    name,
    selectedNodeUrl,
    nodeList,
    selectedNodeIndex,
    getAccountFromIndex,
    selectedWalletIndex,
    privateKey,
  } = useWallet();

  const nodeUrl =
    selectedNodeUrl ||
    (nodeList.length > 0 ? nodeList[selectedNodeIndex] : "");

  const [tab, setTab] = useState<MainTab>("overview");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fee, setFee] = useState(DEFAULT_TX_FEE);

  const [wartBalance, setWartBalance] = useState("0");
  const [usdBalance, setUsdBalance] = useState("N/A");
  const [refreshing, setRefreshing] = useState(false);

  const [watched, setWatched] = useState<
    { hash: string; customName?: string }[]
  >([]);
  const [assetBalances, setAssetBalances] = useState<DefiAssetBalance[]>([]);
  const [manualHash, setManualHash] = useState("");
  /** HTML5 drag reorder of watched assets (overview list). */
  const [dragAssetIndex, setDragAssetIndex] = useState<number | null>(null);
  const [dropAssetIndex, setDropAssetIndex] = useState<number | null>(null);

  const [openOrders, setOpenOrders] = useState<OpenOrdersByAsset[] | null>(
    null,
  );
  const [liquidity, setLiquidity] = useState<LiquidityPosition[] | null>(null);
  /** Overview section open state — single-bar collapsibles like wartbunker */
  const [showAssets, setShowAssets] = useState(true);
  const [showOrders, setShowOrders] = useState(false);
  const [showLiquidity, setShowLiquidity] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingLiquidity, setLoadingLiquidity] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const [cancelling, setCancelling] = useState<string | null>(null);

  // Send Asset tab
  const [sendHash, setSendHash] = useState("");
  const [sendName, setSendName] = useState("");
  const [sendDecimals, setSendDecimals] = useState("8");
  const [sendBalance, setSendBalance] = useState("");
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendIsLp, setSendIsLp] = useState(false);

  // Assets create/search
  const [assetsSub, setAssetsSub] = useState<AssetsSub>("create");
  const [createName, setCreateName] = useState("");
  const [createSupply, setCreateSupply] = useState("");
  const [createDecimals, setCreateDecimals] = useState("8");
  const [searchName, setSearchName] = useState("");
  const [searchHash, setSearchHash] = useState("");
  const [lookupHash, setLookupHash] = useState("");
  const [searchResults, setSearchResults] = useState<AssetInfo[]>([]);
  const [lookupResult, setLookupResult] = useState<unknown>(null);

  // DEX
  const [dexSub, setDexSub] = useState<DexSub>("limit");
  const [dexHash, setDexHash] = useState("");
  const [dexName, setDexName] = useState("");
  const [dexDecimals, setDexDecimals] = useState("8");
  const [marketData, setMarketData] = useState<Record<string, unknown> | null>(
    null,
  );
  const [chartPoints, setChartPoints] = useState<
    CandlePoint[] | TradePoint[]
  >([]);
  const [chartInterval, setChartInterval] = useState<ChartInterval>("1h");
  const [chartMode, setChartMode] = useState<ChartMode>("candles");
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartNote, setChartNote] = useState<string | null>(null);
  const [chartPoolSpot, setChartPoolSpot] = useState<number | null>(null);
  const [lpBalance, setLpBalance] = useState<string | null>(null);
  const [limitMode, setLimitMode] = useState<"buy" | "sell">("buy");
  const [limitAmount, setLimitAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [limitEncoded, setLimitEncoded] = useState("");
  const [liqMode, setLiqMode] = useState<"deposit" | "withdraw">("deposit");
  const [lpAssetAmt, setLpAssetAmt] = useState("");
  const [lpWartAmt, setLpWartAmt] = useState("");
  const [lpShares, setLpShares] = useState("");

  // Number display (Tools)
  const [numPrefs, setNumPrefs] = useState<NumberDisplayPrefs>(() =>
    loadNumberDisplayPrefs(),
  );

  const patchNumPrefs = (patch: Partial<NumberDisplayPrefs>) => {
    setNumPrefs((prev) => saveNumberDisplayPrefs({ ...prev, ...patch }));
  };

  const getPk = useCallback((): string => {
    if (privateKey) return privateKey;
    return getAccountFromIndex(selectedWalletIndex).getPrivateKeyHex();
  }, [privateKey, getAccountFromIndex, selectedWalletIndex]);

  const clearMsg = () => {
    setStatus(null);
    setError(null);
  };

  const run = async (fn: () => Promise<void>, okMsg?: string) => {
    if (!wallet || !nodeUrl) {
      setError("Wallet or node not ready");
      return;
    }
    if (!isDefiNode(nodeUrl)) {
      setError("Switch to a DeFi testnet node");
      return;
    }
    setBusy(true);
    clearMsg();
    try {
      await fn();
      if (okMsg) setStatus(okMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  };

  const refreshBalance = useCallback(async () => {
    if (!wallet || !nodeUrl) return;
    setRefreshing(true);
    try {
      const bal = await fetchBalanceAndPin(nodeUrl, wallet);
      setWartBalance(bal.balance);
      const price = await fetchWartUsdPrice();
      setUsdBalance(
        price && price > 0
          ? (parseFloat(bal.balance) * price).toFixed(2)
          : "N/A",
      );
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false);
    }
  }, [wallet, nodeUrl]);

  const refreshAssets = useCallback(async () => {
    if (!wallet || !nodeUrl) return;
    const w = loadWatched(wallet);
    setWatched(w);
    const results: DefiAssetBalance[] = [];
    for (const item of w) {
      try {
        const bal = await fetchAssetBalance(nodeUrl, wallet, item.hash);
        if (item.customName) bal.name = item.customName;
        results.push(bal);
      } catch {
        results.push({
          hash: item.hash,
          name: item.customName || "?",
          balance: "—",
          decimals: 8,
        });
      }
    }
    setAssetBalances(results);
  }, [wallet, nodeUrl]);

  const refreshOrders = useCallback(async () => {
    if (!wallet || !nodeUrl) return null;
    setLoadingOrders(true);
    try {
      const orders = await getOpenOrders(nodeUrl, wallet);
      setOpenOrders(orders);
      if (orders.length > 0) {
        setCollapsedGroups(
          new Set(
            orders
              .map((g) => assetGroupKey(g.baseAsset))
              .filter(Boolean),
          ),
        );
      }
      return orders;
    } finally {
      setLoadingOrders(false);
    }
  }, [wallet, nodeUrl]);

  const refreshLiquidity = useCallback(async () => {
    if (!wallet || !nodeUrl) return;
    setLoadingLiquidity(true);
    try {
      const hashes = [
        ...assetBalances.map((a) => a.hash),
        ...((openOrders || [])
          .map((o) => o.baseAsset?.hash)
          .filter(Boolean) as string[]),
      ];
      const positions = await fetchLiquidityPositions(
        nodeUrl,
        wallet,
        hashes,
        assetBalances,
      );
      setLiquidity(positions);
    } finally {
      setLoadingLiquidity(false);
    }
  }, [wallet, nodeUrl, assetBalances, openOrders]);

  const refreshAll = useCallback(async () => {
    await refreshBalance();
    await refreshAssets();
  }, [refreshBalance, refreshAssets]);

  useEffect(() => {
    if (wallet && nodeUrl && isDefiNode(nodeUrl)) {
      refreshAll().catch(() => undefined);
    }
  }, [wallet, nodeUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderAssetCount = openOrders?.length ?? 0;

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isTracked = (hashRaw: string) => {
    const h = normalizeAssetHash(hashRaw).toLowerCase();
    return watched.some((w) => w.hash.toLowerCase() === h);
  };

  const addWatched = async (hashRaw: string, customName = "") => {
    if (!wallet || !nodeUrl) return;
    const hash = normalizeAssetHash(hashRaw);
    if (!isValidAssetHash(hash)) throw new Error("Invalid 64-char asset hash");
    const next = [
      ...watched.filter((w) => w.hash.toLowerCase() !== hash),
      { hash, customName: customName || undefined },
    ];
    saveWatched(wallet, next);
    setWatched(next);
    const bal = await fetchAssetBalance(nodeUrl, wallet, hash);
    if (customName) bal.name = customName;
    setAssetBalances((prev) => {
      const rest = prev.filter((a) => a.hash.toLowerCase() !== hash);
      return [...rest, bal];
    });
    setManualHash("");
  };

  const removeWatched = (hash: string) => {
    if (!wallet) return;
    const h = normalizeAssetHash(hash).toLowerCase() || hash.toLowerCase();
    const next = watched.filter((w) => w.hash.toLowerCase() !== h);
    saveWatched(wallet, next);
    setWatched(next);
    setAssetBalances((prev) => prev.filter((a) => a.hash.toLowerCase() !== h));
  };

  /** Reorder watched list + keep balance cards in the same order (wartbunker-style). */
  const reorderWatchedAssets = (fromIndex: number, toIndex: number) => {
    if (!wallet || fromIndex === toIndex) return;
    if (fromIndex < 0 || toIndex < 0) return;

    setWatched((prevWatched) => {
      if (
        fromIndex >= prevWatched.length ||
        toIndex >= prevWatched.length
      ) {
        return prevWatched;
      }
      const nextWatched = [...prevWatched];
      const [moved] = nextWatched.splice(fromIndex, 1);
      nextWatched.splice(toIndex, 0, moved);
      saveWatched(wallet, nextWatched);

      setAssetBalances((prevBalances) => {
        const byHash = new Map(
          prevBalances.map((a) => [a.hash.toLowerCase(), a]),
        );
        return nextWatched
          .map((w) => byHash.get(w.hash.toLowerCase()))
          .filter((x): x is DefiAssetBalance => x != null);
      });

      return nextWatched;
    });
  };

  const toggleWatched = async (hashRaw: string, customName = "") => {
    const hash = normalizeAssetHash(hashRaw);
    if (isTracked(hash)) {
      removeWatched(hash);
      setStatus(`Untracked ${customName || abbreviate(hash)}`);
      return;
    }
    await addWatched(hash, customName);
    setStatus(`Tracking ${customName || abbreviate(hash)}`);
  };

  const loadChart = async (
    hash: string,
    {
      interval = chartInterval,
      mode = chartMode,
    }: { interval?: ChartInterval; mode?: ChartMode } = {},
  ) => {
    if (!nodeUrl || !isValidAssetHash(normalizeAssetHash(hash))) {
      setChartPoints([]);
      setChartError(null);
      setChartNote(null);
      setChartPoolSpot(null);
      return;
    }
    setChartLoading(true);
    setChartError(null);
    setChartNote(null);
    try {
      const result = await loadAssetPriceChart(nodeUrl, hash, {
        mode,
        interval,
        n: 80,
      });
      setChartPoints(result.points);
      setChartError(result.error);
      setChartMode(result.mode);
      setChartNote(result.note);
      setChartPoolSpot(result.poolSpot);
      if (result.interval === "5m" || result.interval === "1h" || result.interval === "1d") {
        setChartInterval(result.interval);
      }
    } finally {
      setChartLoading(false);
    }
  };

  const openSendAsset = (asset: DefiAssetBalance) => {
    setSendHash(asset.hash);
    setSendName(asset.name);
    setSendDecimals(String(asset.decimals));
    setSendBalance(asset.balance);
    setSendAmount("");
    setSendTo("");
    setSendIsLp(false);
    setTab("send-asset");
  };

  const openDexFor = (hash: string, assetName: string, decimals = 8) => {
    setDexHash(hash);
    setDexName(assetName);
    setDexDecimals(String(decimals));
    setTab("dex");
    // Jump to Market so the chart is visible; limit/LP still one subtab away.
    setDexSub("market");
    void loadChart(hash, { interval: chartInterval, mode: chartMode });
  };

  if (!nodeUrl || !isDefiNode(nodeUrl)) {
    return (
      <div className="defi-page container">
        <Header title="DeFi" />
        <p className="defi-empty">
          Switch to a DeFi testnet node to use Assets, DEX, and orders.
        </p>
        <button
          type="button"
          className="defi-btn-primary"
          onClick={() => navigate("/select-node")}
        >
          Select DeFi node
        </button>
      </div>
    );
  }

  const navTabs: { id: MainTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "history", label: "History" },
    { id: "send-asset", label: "Send Asset" },
    { id: "assets", label: "Assets" },
    { id: "dex", label: "DEX" },
    { id: "tools", label: "Tools" },
  ];

  return (
    <div className="defi-page container">
      <Header title="DeFi Testnet" />

      {/* Hero */}
      <section className="defi-hero">
        <div className="defi-hero-body">
          {name ? (
            <div className="text-[10px] text-[var(--defi-muted)] mb-1.5">
              Saved as{" "}
              <span className="text-[var(--defi-gold)] font-mono">{name}</span>
            </div>
          ) : null}
          <div className="defi-hero-top">
            <span className="defi-hero-label">Total Balance</span>
            <button
              type="button"
              className="defi-refresh"
              disabled={refreshing}
              onClick={() => run(async () => refreshAll(), "Refreshed")}
            >
              {refreshing ? "…" : "⟳"} Refresh
            </button>
          </div>
          <div>
            <span
              className="defi-hero-balance"
              style={{ color: getColorHex(numPrefs.balanceColor) }}
            >
              {formatDisplayNumber(wartBalance, numPrefs)}
            </span>
            <span className="defi-hero-unit">WART</span>
          </div>
          <div className="defi-hero-usd">
            ≈{" "}
            {usdBalance === "N/A"
              ? "N/A"
              : formatDisplayNumber(usdBalance, {
                  ...numPrefs,
                  maxDecimals: 2,
                  notation: "standard",
                })}{" "}
            USD
          </div>
          <div className="defi-hero-node">
            {nodeUrl.replace(/^https?:\/\//, "")} · DeFi Testnet
          </div>
          <div className="defi-hero-actions">
            <button
              type="button"
              className="defi-btn-gold"
              onClick={() => navigate("/send")}
            >
              Send WART
            </button>
            <button
              type="button"
              className="defi-btn-gold"
              onClick={() => setTab("send-asset")}
            >
              Send Asset
            </button>
            <button
              type="button"
              className="defi-addr"
              title="Copy address"
              onClick={() => {
                if (wallet) {
                  navigator.clipboard.writeText(wallet);
                  setStatus("Address copied");
                }
              }}
            >
              {wallet ? `${wallet.slice(0, 10)}…${wallet.slice(-8)}` : "—"}
            </button>
          </div>
        </div>
      </section>

      {/* Mobile-style gold/zinc nav */}
      <nav className="defi-tab-bar">
        {navTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`defi-tab ${tab === t.id ? "defi-tab-active" : ""}`}
            onClick={() => {
              setTab(t.id);
              clearMsg();
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {status && <p className="defi-success">{status}</p>}
      {error && <p className="defi-error">{error}</p>}

      {/* ════════ OVERVIEW ════════ */}
      {/* ════════ HISTORY — indexer rich cards ════════ */}
      {tab === "history" && (
        <section className="defi-section">
          <div className="defi-section-body !pt-2">
            <TransactionHistoryPanel
              wallet={wallet}
              nodeUrl={nodeUrl}
              active={tab === "history"}
            />
          </div>
        </section>
      )}

      {tab === "overview" && (
        <>
          {/* Your Assets — collapsible bar (wartbunker / mobile overview) */}
          <section className="defi-section">
            <button
              type="button"
              className="defi-section-header defi-section-header-toggle"
              onClick={() => setShowAssets((v) => !v)}
              aria-expanded={showAssets}
            >
              <div className="defi-section-header-left">
                <span className="defi-section-chevron" aria-hidden="true">
                  {showAssets ? "▼" : "▶"}
                </span>
                <span className="defi-section-title defi-section-title-assets">
                  Your Assets
                </span>
                {assetBalances.length > 0 && (
                  <span className="defi-badge defi-badge-blue">
                    {assetBalances.length}
                  </span>
                )}
              </div>
              {assetBalances.length > 1 && showAssets && (
                <span className="defi-hint mt-0 mb-0 text-[10px]">
                  Drag ⋮⋮ to reorder
                </span>
              )}
            </button>
            {showAssets && (
            <div className="defi-section-body">
              {assetBalances.length === 0 ? (
                <p className="defi-empty">No custom tokens tracked yet</p>
              ) : (
                assetBalances.map((asset, index) => (
                  <div
                    key={asset.hash}
                    className={`defi-card defi-card-draggable${
                      dragAssetIndex === index
                        ? " defi-card-dragging"
                        : dropAssetIndex === index
                          ? " defi-card-drop-target"
                          : ""
                    }`}
                    draggable={assetBalances.length > 1}
                    onDragStart={(e) => {
                      setDragAssetIndex(index);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(index));
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dropAssetIndex !== index) setDropAssetIndex(index);
                    }}
                    onDragLeave={() => {
                      if (dropAssetIndex === index) setDropAssetIndex(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const fromRaw = e.dataTransfer.getData("text/plain");
                      const fromBal =
                        dragAssetIndex ?? parseInt(fromRaw, 10);
                      if (!Number.isFinite(fromBal)) {
                        setDragAssetIndex(null);
                        setDropAssetIndex(null);
                        return;
                      }
                      // Map balance-row indices → watched list (source of truth).
                      const fromHash =
                        assetBalances[fromBal]?.hash?.toLowerCase();
                      const toHash = asset.hash.toLowerCase();
                      const fromW = watched.findIndex(
                        (w) => w.hash.toLowerCase() === fromHash,
                      );
                      const toW = watched.findIndex(
                        (w) => w.hash.toLowerCase() === toHash,
                      );
                      if (fromW >= 0 && toW >= 0) {
                        reorderWatchedAssets(fromW, toW);
                      }
                      setDragAssetIndex(null);
                      setDropAssetIndex(null);
                    }}
                    onDragEnd={() => {
                      setDragAssetIndex(null);
                      setDropAssetIndex(null);
                    }}
                  >
                    <div className="defi-row">
                      <div
                        className="defi-row"
                        style={{ justifyContent: "flex-start", flex: 1 }}
                      >
                        {assetBalances.length > 1 && (
                          <button
                            type="button"
                            className="defi-drag-grip"
                            aria-label={`Drag to reorder ${asset.name}`}
                            title="Drag to reorder"
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <span className="defi-drag-dots" aria-hidden="true">
                              {[0, 1, 2, 3, 4, 5].map((dot) => (
                                <span key={dot} />
                              ))}
                            </span>
                          </button>
                        )}
                        <div className="defi-avatar defi-avatar-blue">
                          {asset.name?.[0]?.toUpperCase() || "?"}
                        </div>
                        <div className="ml-2 min-w-0">
                          <div className="defi-card-title">{asset.name}</div>
                          <button
                            type="button"
                            className="defi-card-sub text-left"
                            onClick={() => {
                              navigator.clipboard.writeText(asset.hash);
                              setStatus("Asset hash copied");
                            }}
                          >
                            {abbreviate(asset.hash)}
                          </button>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className="defi-balance"
                          style={{ color: getColorHex(numPrefs.balanceColor) }}
                        >
                          {formatDisplayNumber(asset.balance, numPrefs)}
                        </div>
                        <div className="text-[10px] text-[var(--defi-muted)]">
                          {asset.name}
                        </div>
                      </div>
                    </div>
                    <div className="defi-btn-row">
                      <button
                        type="button"
                        className="defi-compact-btn"
                        onClick={() => openSendAsset(asset)}
                      >
                        Send Asset
                      </button>
                      <button
                        type="button"
                        className="defi-compact-btn"
                        onClick={() =>
                          openDexFor(asset.hash, asset.name, asset.decimals)
                        }
                      >
                        DEX
                      </button>
                      <button
                        type="button"
                        className="defi-compact-btn defi-compact-btn-accent"
                        onClick={() => {
                          navigator.clipboard.writeText(asset.hash);
                          setStatus("Hash copied");
                        }}
                      >
                        Copy Hash
                      </button>
                      <button
                        type="button"
                        className="defi-compact-btn defi-danger"
                        onClick={() => removeWatched(asset.hash)}
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))
              )}
              <div className="defi-section-footer">
                <input
                  className="defi-input"
                  placeholder="Paste 64-char asset hash to track"
                  value={manualHash}
                  onChange={(e) => setManualHash(e.target.value.trim())}
                />
                <button
                  type="button"
                  className="defi-compact-btn"
                  disabled={busy || !manualHash}
                  onClick={() =>
                    run(async () => {
                      await addWatched(manualHash);
                    }, "Asset added")
                  }
                >
                  + Add Token
                </button>
              </div>
            </div>
            )}
          </section>

          {/* Open Limit Orders — collapsible single bar */}
          <section className="defi-section">
            <button
              type="button"
              className="defi-section-header defi-section-header-toggle"
              onClick={() =>
                run(async () => {
                  if (showOrders) {
                    setShowOrders(false);
                    return;
                  }
                  if (!openOrders) await refreshOrders();
                  setShowOrders(true);
                })
              }
              aria-expanded={showOrders}
            >
              <div className="defi-section-header-left">
                <span className="defi-section-chevron" aria-hidden="true">
                  {showOrders ? "▼" : "▶"}
                </span>
                <span className="defi-section-title defi-section-title-orders">
                  Open Limit Orders
                </span>
                {(orderAssetCount > 0 || (openOrders && openOrders.length > 0)) && (
                  <span className="defi-badge defi-badge-purple">
                    {openOrders?.length ?? orderAssetCount} asset
                    {(openOrders?.length ?? orderAssetCount) !== 1 ? "s" : ""}
                  </span>
                )}
                {loadingOrders && !openOrders && (
                  <span className="defi-badge defi-badge-purple">…</span>
                )}
              </div>
            </button>
            {showOrders && (
            <div className="defi-section-body">
              <div className="defi-btn-row" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className="defi-compact-btn"
                  disabled={loadingOrders}
                  onClick={() =>
                    run(async () => {
                      await refreshOrders();
                    })
                  }
                >
                  {loadingOrders
                    ? "Loading Open Orders…"
                    : "⟳ Refresh Open Orders"}
                </button>
              </div>

              {openOrders && openOrders.length > 1 && (
                <div className="defi-btn-row justify-end">
                  <button
                    type="button"
                    className="defi-compact-btn"
                    onClick={() => setCollapsedGroups(new Set())}
                  >
                    Show all orders
                  </button>
                  <button
                    type="button"
                    className="defi-compact-btn"
                    onClick={() =>
                      setCollapsedGroups(
                        new Set(
                          openOrders
                            .map((g) => assetGroupKey(g.baseAsset))
                            .filter(Boolean),
                        ),
                      )
                    }
                  >
                    Close all orders
                  </button>
                </div>
              )}

              {openOrders &&
                openOrders.map((group, idx) => {
                  const asset = group.baseAsset;
                  const buys = group.wartToAssetSwaps || [];
                  const sells = group.assetToWartSwaps || [];
                  const key = assetGroupKey(asset) || String(idx);
                  const collapsed = collapsedGroups.has(key);
                  const total = buys.length + sells.length;
                  const countLabel =
                    total > 0
                      ? buys.length > 0 && sells.length > 0
                        ? ` · ${buys.length}B / ${sells.length}S`
                        : buys.length > 0
                          ? " · buy"
                          : " · sell"
                      : "";

                  return (
                    <div key={key} className="defi-order-group">
                      <div
                        className={`defi-order-group-header ${!collapsed ? "defi-order-group-header-open" : ""}`}
                      >
                        <div className="defi-order-group-top">
                          <button
                            type="button"
                            className="defi-order-group-btn"
                            onClick={() => toggleGroup(key)}
                          >
                            <span className="defi-chevron">
                              {collapsed ? "▸" : "▾"}
                            </span>
                            <div className="defi-avatar defi-avatar-purple">
                              {asset.name?.[0]?.toUpperCase() || "?"}
                            </div>
                            <span className="defi-card-title truncate">
                              {asset.name || "Asset"}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="defi-compact-btn"
                            onClick={() => toggleGroup(key)}
                          >
                            {collapsed ? "Show" : "Hide"}
                          </button>
                        </div>
                        <div className="defi-order-meta">
                          {asset.id != null && (
                            <span className="defi-meta-badge">
                              ID {asset.id}
                            </span>
                          )}
                          {asset.decimals != null && (
                            <span className="defi-meta-badge">
                              {asset.decimals} decimals
                            </span>
                          )}
                          {total > 0 && (
                            <span className="defi-meta-badge defi-meta-badge-purple">
                              {total} order{total !== 1 ? "s" : ""}
                              {countLabel}
                            </span>
                          )}
                        </div>
                        {asset.hash && (
                          <button
                            type="button"
                            className="defi-card-sub text-left"
                            onClick={() => {
                              navigator.clipboard.writeText(asset.hash!);
                              setStatus("Hash copied");
                            }}
                          >
                            {abbreviate(asset.hash)}
                          </button>
                        )}
                      </div>

                      {!collapsed && (
                        <div className="defi-order-group-body">
                          {buys.length > 0 && (
                            <div>
                              <div className="defi-order-subhead">
                                <span className="defi-order-dot defi-order-dot-buy" />
                                <span className="defi-order-sub-title defi-order-sub-title-buy">
                                  Buy Orders
                                </span>
                                <span className="defi-order-sub-count defi-order-sub-count-buy">
                                  ({buys.length})
                                </span>
                              </div>
                              {buys.map((o, i) => (
                                <OrderCard
                                  key={o.txHash || `b-${key}-${i}`}
                                  order={o}
                                  side="buy"
                                  assetName={asset.name || "Asset"}
                                  cancelling={cancelling}
                                  buyColor={numPrefs.limitOrderBuyColor}
                                  sellColor={numPrefs.limitOrderSellColor}
                                  formatNum={(v) =>
                                    formatDisplayNumber(v, numPrefs)
                                  }
                                  onCancel={(tx) =>
                                    run(async () => {
                                      if (!wallet || !nodeUrl) return;
                                      setCancelling(tx);
                                      try {
                                        const r = await cancelOrderTx(
                                          nodeUrl,
                                          getPk(),
                                          wallet,
                                          { orderTxHash: tx, fee },
                                        );
                                        setStatus(
                                          `Cancel · ${r.txHash || "ok"}`,
                                        );
                                        await refreshOrders();
                                      } finally {
                                        setCancelling(null);
                                      }
                                    })
                                  }
                                />
                              ))}
                            </div>
                          )}
                          {sells.length > 0 && (
                            <div>
                              <div className="defi-order-subhead">
                                <span className="defi-order-dot defi-order-dot-sell" />
                                <span className="defi-order-sub-title defi-order-sub-title-sell">
                                  Sell Orders
                                </span>
                                <span className="defi-order-sub-count defi-order-sub-count-sell">
                                  ({sells.length})
                                </span>
                              </div>
                              {sells.map((o, i) => (
                                <OrderCard
                                  key={o.txHash || `s-${key}-${i}`}
                                  order={o}
                                  side="sell"
                                  assetName={asset.name || "Asset"}
                                  cancelling={cancelling}
                                  buyColor={numPrefs.limitOrderBuyColor}
                                  sellColor={numPrefs.limitOrderSellColor}
                                  formatNum={(v) =>
                                    formatDisplayNumber(v, numPrefs)
                                  }
                                  onCancel={(tx) =>
                                    run(async () => {
                                      if (!wallet || !nodeUrl) return;
                                      setCancelling(tx);
                                      try {
                                        const r = await cancelOrderTx(
                                          nodeUrl,
                                          getPk(),
                                          wallet,
                                          { orderTxHash: tx, fee },
                                        );
                                        setStatus(
                                          `Cancel · ${r.txHash || "ok"}`,
                                        );
                                        await refreshOrders();
                                      } finally {
                                        setCancelling(null);
                                      }
                                    })
                                  }
                                />
                              ))}
                            </div>
                          )}
                          {total === 0 && (
                            <p className="defi-empty">
                              No open orders for this asset
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

              {openOrders && openOrders.length === 0 && (
                <p className="defi-empty">No open limit orders</p>
              )}
              {loadingOrders && !openOrders && (
                <p className="defi-hint">Loading open orders…</p>
              )}
            </div>
            )}
          </section>

          {/* My Liquidity Positions — collapsible single bar */}
          <section className="defi-section">
            <button
              type="button"
              className="defi-section-header defi-section-header-toggle"
              onClick={() =>
                run(async () => {
                  if (showLiquidity) {
                    setShowLiquidity(false);
                    return;
                  }
                  if (liquidity == null) await refreshLiquidity();
                  setShowLiquidity(true);
                })
              }
              aria-expanded={showLiquidity}
            >
              <div className="defi-section-header-left">
                <span className="defi-section-chevron" aria-hidden="true">
                  {showLiquidity ? "▼" : "▶"}
                </span>
                <span className="defi-section-title defi-section-title-liquidity">
                  My Liquidity Positions
                </span>
                {(liquidity?.length || 0) > 0 && (
                  <span className="defi-badge defi-badge-amber">
                    {liquidity!.length} pool
                    {liquidity!.length !== 1 ? "s" : ""}
                  </span>
                )}
                {loadingLiquidity && liquidity == null && (
                  <span className="defi-badge defi-badge-amber">…</span>
                )}
              </div>
            </button>
            {showLiquidity && (
            <div className="defi-section-body">
              <div className="defi-btn-row" style={{ marginTop: 0 }}>
                <button
                  type="button"
                  className="defi-compact-btn"
                  disabled={loadingLiquidity}
                  onClick={() =>
                    run(async () => {
                      await refreshLiquidity();
                    })
                  }
                >
                  {loadingLiquidity
                    ? "Loading Liquidity…"
                    : "⟳ Refresh Liquidity"}
                </button>
              </div>

              {liquidity?.map((pos) => (
                  <div key={pos.hash} className="defi-card-inset">
                    <div className="defi-row">
                      <div
                        className="defi-row"
                        style={{ justifyContent: "flex-start", flex: 1 }}
                      >
                        <div className="defi-avatar defi-avatar-amber">
                          {pos.name?.[0] || "L"}
                        </div>
                        <div className="ml-2 min-w-0">
                          <div className="defi-card-title">
                            {pos.name}{" "}
                            <span className="defi-card-sub">LP</span>
                          </div>
                          <div className="defi-card-sub">
                            {pos.assetId != null ? `ID ${pos.assetId} · ` : ""}
                            {pos.decimals} decimals
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="defi-compact-btn font-mono text-[10px]"
                        onClick={() => {
                          navigator.clipboard.writeText(pos.hash);
                          setStatus("Hash copied");
                        }}
                      >
                        {abbreviate(pos.hash)}
                      </button>
                    </div>
                    <div className="defi-stat-grid">
                      <div className="defi-stat-box">
                        <div className="defi-stat-label">Your LP Shares</div>
                        <div className="defi-stat-value">{pos.lpBalance}</div>
                      </div>
                      <div className="defi-stat-box">
                        <div className="defi-stat-label">Pool WART</div>
                        <div className="defi-stat-value">{pos.poolWart}</div>
                      </div>
                      <div className="defi-stat-box">
                        <div className="defi-stat-label">Pool {pos.name}</div>
                        <div className="defi-stat-value">{pos.poolAsset}</div>
                      </div>
                    </div>
                    <div className="defi-section-footer defi-row justify-end">
                      <button
                        type="button"
                        className="defi-compact-btn"
                        onClick={() => {
                          openDexFor(pos.hash, pos.name, pos.decimals);
                          setDexSub("liquidity");
                        }}
                      >
                        Manage in DEX
                      </button>
                    </div>
                  </div>
                ))}

              {liquidity && liquidity.length === 0 && (
                <div className="defi-card mt-2">
                  <p className="defi-empty">No liquidity positions found</p>
                  <p className="defi-hint">
                    LP shares appear here for tracked assets after you deposit
                    into a pool on the DEX.
                  </p>
                </div>
              )}
              {loadingLiquidity && liquidity == null && (
                <p className="defi-hint">Loading liquidity positions…</p>
              )}
            </div>
            )}
          </section>
        </>
      )}

      {/* ════════ SEND ASSET (dedicated — like mobile Send Asset) ════════ */}
      {tab === "send-asset" && (
        <section className="defi-section">
          <div className="defi-section-header">
            <span className="defi-section-title defi-section-title-send">
              Send Asset
            </span>
          </div>
          <div className="defi-section-body">
            <p className="defi-hint text-left mb-2 mt-0">
              Transfer tokens or LP shares on the DeFi testnet.
              {sendName ? ` Transferring ${sendName}.` : ""}
            </p>

            {assetBalances.length > 0 && (
              <>
                <label className="defi-label">Quick pick</label>
                <div className="defi-subtabs mb-2">
                  {assetBalances.map((a) => (
                    <button
                      key={a.hash}
                      type="button"
                      className={`defi-compact-btn ${sendHash.toLowerCase() === a.hash.toLowerCase() ? "defi-compact-btn-active" : ""}`}
                      onClick={() => openSendAsset(a)}
                    >
                      {a.name}
                    </button>
                  ))}
                </div>
              </>
            )}

            {sendName && (
              <p className="defi-label">Asset: {sendName}</p>
            )}
            <label className="defi-label">Asset hash (64 hex)</label>
            <input
              className="defi-input"
              value={sendHash}
              onChange={(e) => setSendHash(e.target.value)}
              placeholder="64-char hash"
            />
            <label className="defi-label">Recipient address</label>
            <input
              className="defi-input"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              placeholder="40 or 48 hex chars"
            />
            <label className="defi-label">
              Amount{sendBalance ? ` (balance: ${sendBalance})` : ""}
            </label>
            <input
              className="defi-input"
              value={sendAmount}
              onChange={(e) => setSendAmount(e.target.value)}
            />
            {sendBalance && sendBalance !== "—" && (
              <button
                type="button"
                className="defi-compact-btn mb-2"
                onClick={() => setSendAmount(sendBalance)}
              >
                Max
              </button>
            )}
            <label className="defi-label">Decimals</label>
            <input
              className="defi-input"
              value={sendDecimals}
              onChange={(e) => setSendDecimals(e.target.value)}
            />
            <label
              className="defi-check-row"
              onClick={() => setSendIsLp((v) => !v)}
            >
              <span
                className={`defi-check ${sendIsLp ? "defi-check-on" : ""}`}
              />
              Transfer LP shares (liquidity)
            </label>
            <label className="defi-label">Fee (WART)</label>
            <input
              className="defi-input"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
            <button
              type="button"
              className="defi-btn-primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (!wallet || !nodeUrl) return;
                  if (!sendHash || !sendTo || !sendAmount) {
                    throw new Error(
                      "Asset hash, recipient, and amount are required",
                    );
                  }
                  const r = await transferAssetTx(nodeUrl, getPk(), wallet, {
                    assetHash: sendHash,
                    toAddress: sendTo,
                    amount: sendAmount,
                    decimals: parseInt(sendDecimals, 10) || 8,
                    isLiquidity: sendIsLp,
                    fee,
                  });
                  setStatus(`Sent · ${r.txHash || "submitted"}`);
                  setSendAmount("");
                  setSendTo("");
                  await refreshAssets();
                })
              }
            >
              {busy ? "Sending…" : "Send Asset"}
            </button>
          </div>
        </section>
      )}

      {/* ════════ ASSETS create / search ════════ */}
      {tab === "assets" && (
        <>
          <div className="defi-subtabs">
            {(
              [
                ["create", "Create"],
                ["search", "Search"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`defi-compact-btn ${assetsSub === id ? "defi-compact-btn-active" : ""}`}
                onClick={() => setAssetsSub(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {assetsSub === "create" && (
            <section className="defi-section">
              <div className="defi-section-header">
                <span className="defi-section-title defi-section-title-assets">
                  Create Asset
                </span>
              </div>
              <div className="defi-section-body">
                <label className="defi-label">Name (1–5 chars)</label>
                <input
                  className="defi-input"
                  value={createName}
                  maxLength={5}
                  onChange={(e) => setCreateName(e.target.value.toUpperCase())}
                />
                <label className="defi-label">Total supply</label>
                <input
                  className="defi-input"
                  value={createSupply}
                  onChange={(e) => setCreateSupply(e.target.value)}
                />
                <label className="defi-label">Decimals (0–18)</label>
                <input
                  className="defi-input"
                  value={createDecimals}
                  onChange={(e) => setCreateDecimals(e.target.value)}
                />
                <label className="defi-label">Fee (WART)</label>
                <input
                  className="defi-input"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                />
                <button
                  type="button"
                  className="defi-btn-primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (!wallet || !nodeUrl) return;
                      const r = await createAssetTx(nodeUrl, getPk(), wallet, {
                        name: createName,
                        supply: createSupply,
                        decimals: parseInt(createDecimals, 10) || 8,
                        fee,
                      });
                      setStatus(`Created · ${r.txHash || "ok"}`);
                      setCreateName("");
                      setCreateSupply("");
                    })
                  }
                >
                  Create asset
                </button>
              </div>
            </section>
          )}

          {assetsSub === "search" && (
            <section className="defi-section">
              <div className="defi-section-header">
                <span className="defi-section-title defi-section-title-assets">
                  Search / Lookup
                </span>
              </div>
              <div className="defi-section-body">
                <p className="defi-hint text-left mt-0 mb-2">
                  Leave name empty and tap Search to list all assets on this
                  node.
                </p>
                <label className="defi-label">Name prefix</label>
                <input
                  className="defi-input"
                  value={searchName}
                  onChange={(e) => setSearchName(e.target.value.toUpperCase())}
                  placeholder="empty = list all"
                />
                <label className="defi-label">Hash prefix (optional)</label>
                <input
                  className="defi-input"
                  value={searchHash}
                  onChange={(e) => setSearchHash(e.target.value)}
                />
                <button
                  type="button"
                  className="defi-btn-primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (!nodeUrl) return;
                      const data = await searchAssetsDetailed(
                        nodeUrl,
                        searchName.trim(),
                        searchHash.trim() || undefined,
                      );
                      setSearchResults(data.matches);
                      setLookupResult(null);
                      setStatus(
                        data.matches.length
                          ? `${data.matches.length} asset(s)`
                          : "No matches",
                      );
                    })
                  }
                >
                  {searchName.trim() || searchHash.trim()
                    ? "Search"
                    : "List all assets"}
                </button>
                <label className="defi-label mt-3">
                  Full hash lookup (64 hex)
                </label>
                <input
                  className="defi-input"
                  value={lookupHash}
                  onChange={(e) => setLookupHash(e.target.value)}
                  placeholder="required for single-asset lookup"
                />
                <button
                  type="button"
                  className="defi-compact-btn w-full"
                  disabled={busy || !lookupHash.trim()}
                  onClick={() =>
                    run(async () => {
                      if (!nodeUrl) return;
                      // Empty was hitting /asset/lookup/ → HTML 502; require full hash
                      if (!lookupHash.trim()) {
                        const data = await searchAssetsDetailed(nodeUrl, "");
                        setSearchResults(data.matches);
                        setLookupResult(null);
                        setStatus(`${data.matches.length} asset(s)`);
                        return;
                      }
                      setLookupResult(await lookupAsset(nodeUrl, lookupHash));
                      setSearchResults([]);
                    }, "Lookup OK")
                  }
                >
                  Lookup hash
                </button>
                {searchResults.map((asset, i) => {
                  const hash = asset.hash || asset.assetHash || "";
                  const tracked = hash ? isTracked(hash) : false;
                  return (
                    <div key={hash || i} className="defi-card mt-2">
                      <div className="defi-card-title">
                        {asset.name || "Asset"}
                        {tracked && (
                          <span className="defi-badge defi-badge-blue ml-2">
                            Tracked
                          </span>
                        )}
                      </div>
                      <div className="defi-card-sub">
                        ID {asset.id ?? "—"} · {asset.decimals ?? "?"} decimals
                      </div>
                      <div className="defi-card-sub">{abbreviate(hash, 12, 8)}</div>
                      {hash && (
                        <div className="defi-btn-row">
                          <button
                            type="button"
                            className={`defi-compact-btn ${
                              tracked
                                ? "defi-danger"
                                : "defi-compact-btn-active"
                            }`}
                            onClick={() =>
                              run(async () => {
                                await toggleWatched(hash, asset.name || "");
                              })
                            }
                          >
                            {tracked ? "Untrack" : "+ Track"}
                          </button>
                          <button
                            type="button"
                            className="defi-compact-btn"
                            onClick={() =>
                              openSendAsset({
                                hash,
                                name: asset.name || "Asset",
                                balance: "—",
                                decimals: asset.decimals ?? 8,
                              })
                            }
                          >
                            Send Asset
                          </button>
                          <button
                            type="button"
                            className="defi-compact-btn"
                            onClick={() => {
                              openDexFor(
                                hash,
                                asset.name || "Asset",
                                asset.decimals ?? 8,
                              );
                            }}
                          >
                            Chart / DEX
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {lookupResult != null && (
                  <pre className="defi-pre">
                    {JSON.stringify(lookupResult, null, 2)}
                  </pre>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {/* ════════ DEX ════════ */}
      {tab === "dex" && (
        <>
          <div className="defi-subtabs">
            {(
              [
                ["limit", "Limit Order"],
                ["liquidity", "Liquidity"],
                ["market", "Market"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`defi-compact-btn ${dexSub === id ? "defi-compact-btn-active" : ""}`}
                onClick={() => setDexSub(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <section className="defi-section">
            <div className="defi-section-header">
              <span className="defi-section-title defi-section-title-dex">
                Pool / Asset
              </span>
            </div>
            <div className="defi-section-body">
              <label className="defi-label">Asset hash</label>
              <input
                className="defi-input"
                value={dexHash}
                onChange={(e) => setDexHash(e.target.value)}
              />
              <label className="defi-label">Name</label>
              <input
                className="defi-input"
                value={dexName}
                onChange={(e) => setDexName(e.target.value)}
              />
              <label className="defi-label">Decimals</label>
              <input
                className="defi-input"
                value={dexDecimals}
                onChange={(e) => setDexDecimals(e.target.value)}
              />
              <button
                type="button"
                className="defi-btn-primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (!nodeUrl || !wallet) return;
                    const m = (await getDexMarket(
                      nodeUrl,
                      dexHash,
                    )) as Record<string, unknown>;
                    setMarketData(m);
                    const asset = (m.baseAsset || m.asset) as {
                      name?: string;
                      decimals?: number;
                    };
                    if (asset?.name) setDexName(String(asset.name));
                    if (asset?.decimals != null)
                      setDexDecimals(String(asset.decimals));
                    const spot = computePoolSpotPrice(m);
                    if (spot != null && spot > 0) setLimitPrice(String(spot));
                    const lp = await fetchLiquidityBalance(
                      nodeUrl,
                      wallet,
                      dexHash,
                    );
                    setLpBalance(lp?.balance ?? null);
                    if (lp) {
                      setDexName(lp.name);
                      setDexDecimals(String(lp.decimals));
                    }
                    await loadChart(dexHash, {
                      interval: chartInterval,
                      mode: chartMode,
                    });
                  }, "Market loaded")
                }
              >
                Load market
              </button>
              {lpBalance != null && (
                <div className="defi-lp-shares mt-3">
                  <div className="defi-lp-shares-label">Your LP shares</div>
                  <div className="defi-lp-shares-value">{lpBalance}</div>
                  <div className="defi-lp-shares-footer">
                    Redeemable in {dexName || "asset"} pool. Withdraw below to
                    receive asset + WART.
                  </div>
                </div>
              )}
              {marketData && (
                <div className="defi-stat-grid mt-2">
                  {(() => {
                    const pool = (marketData.liquidityPool ||
                      marketData.liquidity ||
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
                            {(() => {
                              const s = computePoolSpotPrice(marketData);
                              return s != null ? s.toPrecision(4) : "—";
                            })()}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </section>

          {dexSub === "limit" && (
            <section className="defi-section">
              <div className="defi-section-header">
                <span className="defi-section-title defi-section-title-orders">
                  Limit Order
                </span>
              </div>
              <div className="defi-section-body">
                <div className="defi-subtabs">
                  <button
                    type="button"
                    className={`defi-compact-btn ${limitMode === "buy" ? "defi-compact-btn-buy" : ""}`}
                    onClick={() => setLimitMode("buy")}
                  >
                    BUY
                  </button>
                  <button
                    type="button"
                    className={`defi-compact-btn ${limitMode === "sell" ? "defi-compact-btn-sell" : ""}`}
                    onClick={() => setLimitMode("sell")}
                  >
                    SELL
                  </button>
                </div>
                <div
                  className="defi-encoder"
                  style={{
                    borderColor:
                      limitMode === "buy"
                        ? "rgba(52, 211, 153, 0.45)"
                        : "rgba(251, 113, 133, 0.45)",
                  }}
                >
                  <div className="defi-encoder-title">
                    Quick Limit Price Encoder
                  </div>
                  <p className="defi-encoder-hint">
                    Price in WART per {dexName || "asset"}, then Encode → 6-char
                    hex.
                  </p>
                  <label className="defi-label">Price</label>
                  <input
                    className="defi-input"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                    placeholder="e.g. 0.0005"
                  />
                  <div className="defi-field-row">
                    <div>
                      <label className="defi-label">Decimals</label>
                      <input
                        className="defi-input"
                        value={dexDecimals}
                        onChange={(e) => setDexDecimals(e.target.value)}
                      />
                    </div>
                    <div className="pb-2">
                      <button
                        type="button"
                        className="defi-compact-btn defi-compact-btn-active w-full"
                        onClick={() => {
                          try {
                            setLimitEncoded(
                              encodeLimitPriceHex(
                                limitPrice,
                                parseInt(dexDecimals, 10) || 8,
                              ),
                            );
                            setStatus("Encoded");
                          } catch (e) {
                            setError(
                              e instanceof Error ? e.message : "Encode failed",
                            );
                          }
                        }}
                      >
                        Encode
                      </button>
                    </div>
                  </div>
                  {limitEncoded && (
                    <div className="defi-encoder-result">
                      limit hex: {limitEncoded}
                    </div>
                  )}
                </div>
                <label className="defi-label">
                  Amount ({limitMode === "buy" ? "WART" : dexName || "token"})
                </label>
                <input
                  className="defi-input"
                  value={limitAmount}
                  onChange={(e) => setLimitAmount(e.target.value)}
                />
                <label className="defi-label">Encoded limit (6 hex)</label>
                <input
                  className="defi-input"
                  value={limitEncoded}
                  onChange={(e) => setLimitEncoded(e.target.value)}
                />
                <label className="defi-label">Fee (WART)</label>
                <input
                  className="defi-input"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                />
                <button
                  type="button"
                  className="defi-btn-primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (!wallet || !nodeUrl) return;
                      if (!limitEncoded.trim()) {
                        throw new Error("Encode a limit price first");
                      }
                      const r = await limitSwapTx(nodeUrl, getPk(), wallet, {
                        assetHash: dexHash,
                        isBuy: limitMode === "buy",
                        amount: limitAmount,
                        assetDecimals: parseInt(dexDecimals, 10) || 8,
                        limitPrice: limitEncoded.trim(),
                        fee,
                      });
                      setStatus(
                        `${limitMode.toUpperCase()} · ${r.txHash || "ok"}`,
                      );
                      setLimitAmount("");
                      setLimitEncoded("");
                    })
                  }
                >
                  Place {limitMode} order
                </button>
              </div>
            </section>
          )}

          {dexSub === "liquidity" && (
            <section className="defi-section">
              <div className="defi-section-header">
                <span className="defi-section-title defi-section-title-liquidity">
                  Liquidity
                </span>
              </div>
              <div className="defi-section-body">
                <div className="defi-subtabs">
                  <button
                    type="button"
                    className={`defi-compact-btn ${liqMode === "deposit" ? "defi-compact-btn-active" : ""}`}
                    onClick={() => setLiqMode("deposit")}
                  >
                    Deposit
                  </button>
                  <button
                    type="button"
                    className={`defi-compact-btn ${liqMode === "withdraw" ? "defi-compact-btn-active" : ""}`}
                    onClick={() => setLiqMode("withdraw")}
                  >
                    Withdraw
                  </button>
                </div>
                {liqMode === "deposit" ? (
                  <>
                    <label className="defi-label">Asset amount</label>
                    <input
                      className="defi-input"
                      value={lpAssetAmt}
                      onChange={(e) => setLpAssetAmt(e.target.value)}
                    />
                    <label className="defi-label">WART amount</label>
                    <input
                      className="defi-input"
                      value={lpWartAmt}
                      onChange={(e) => setLpWartAmt(e.target.value)}
                    />
                    <button
                      type="button"
                      className="defi-btn-primary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          if (!wallet || !nodeUrl) return;
                          const r = await depositLiquidityTx(
                            nodeUrl,
                            getPk(),
                            wallet,
                            {
                              assetHash: dexHash,
                              assetAmount: lpAssetAmt,
                              wartAmount: lpWartAmt,
                              decimals: parseInt(dexDecimals, 10) || 8,
                              fee,
                            },
                          );
                          setStatus(`LP deposit · ${r.txHash || "ok"}`);
                        })
                      }
                    >
                      Deposit liquidity
                    </button>
                  </>
                ) : (
                  <>
                    <label className="defi-label">LP shares</label>
                    <input
                      className="defi-input"
                      value={lpShares}
                      onChange={(e) => setLpShares(e.target.value)}
                    />
                    <button
                      type="button"
                      className="defi-btn-primary"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          if (!wallet || !nodeUrl) return;
                          const r = await withdrawLiquidityTx(
                            nodeUrl,
                            getPk(),
                            wallet,
                            { assetHash: dexHash, shares: lpShares, fee },
                          );
                          setStatus(`LP withdraw · ${r.txHash || "ok"}`);
                        })
                      }
                    >
                      Withdraw liquidity
                    </button>
                  </>
                )}
              </div>
            </section>
          )}

          {dexSub === "market" && (
            <section className="defi-section">
              <div className="defi-section-header">
                <span className="defi-section-title defi-section-title-dex">
                  Price chart
                </span>
              </div>
              <div className="defi-section-body">
                <p className="defi-hint text-left mt-0">
                  Same data path as WartBunker: node{" "}
                  <code>/chart/*</code>, then recent matches, then pool spot.
                </p>
                <div className="defi-subtabs">
                  {(
                    [
                      ["candles", "Candles"],
                      ["trades", "Trades"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`defi-compact-btn ${
                        chartMode === id ? "defi-compact-btn-active" : ""
                      }`}
                      disabled={chartLoading || !dexHash}
                      onClick={() =>
                        run(async () => {
                          setChartMode(id);
                          await loadChart(dexHash, {
                            mode: id,
                            interval: chartInterval,
                          });
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {chartMode === "candles" && (
                  <div className="defi-subtabs">
                    {CHART_INTERVALS.map((iv) => (
                      <button
                        key={iv.id}
                        type="button"
                        className={`defi-compact-btn ${
                          chartInterval === iv.id
                            ? "defi-compact-btn-active"
                            : ""
                        }`}
                        disabled={chartLoading || !dexHash}
                        onClick={() =>
                          run(async () => {
                            setChartInterval(iv.id);
                            await loadChart(dexHash, {
                              interval: iv.id,
                              mode: "candles",
                            });
                          })
                        }
                      >
                        {iv.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="defi-subtabs">
                  <button
                    type="button"
                    className="defi-compact-btn"
                    disabled={chartLoading || !dexHash}
                    onClick={() =>
                      run(async () => {
                        await loadChart(dexHash, {
                          interval: chartInterval,
                          mode: chartMode,
                        });
                      })
                    }
                  >
                    {chartLoading ? "…" : "↻ Refresh"}
                  </button>
                  <button
                    type="button"
                    className="defi-btn-primary"
                    disabled={busy || !dexHash}
                    onClick={() =>
                      run(async () => {
                        if (!nodeUrl || !wallet) return;
                        const m = (await getDexMarket(
                          nodeUrl,
                          dexHash,
                        )) as Record<string, unknown>;
                        setMarketData(m);
                        const asset = (m.baseAsset || m.asset) as {
                          name?: string;
                          decimals?: number;
                        };
                        if (asset?.name) setDexName(String(asset.name));
                        if (asset?.decimals != null)
                          setDexDecimals(String(asset.decimals));
                        const spot = computePoolSpotPrice(m);
                        if (spot != null && spot > 0)
                          setLimitPrice(String(spot));
                        await loadChart(dexHash, {
                          interval: chartInterval,
                          mode: chartMode,
                        });
                      }, "Market + chart loaded")
                    }
                  >
                    Load market + chart
                  </button>
                </div>
                <AssetPriceChart
                  points={chartPoints}
                  mode={chartMode}
                  assetName={dexName || "Asset"}
                  intervalLabel={
                    chartMode === "trades"
                      ? "Trades"
                      : CHART_INTERVALS.find((i) => i.id === chartInterval)
                          ?.label
                  }
                  loading={chartLoading}
                  error={chartError}
                  note={chartNote}
                  poolSpot={
                    chartPoolSpot ??
                    (marketData ? computePoolSpotPrice(marketData) : null)
                  }
                />
                {marketData && (
                  <details className="mt-2">
                    <summary className="defi-hint text-left cursor-pointer">
                      Raw market JSON
                    </summary>
                    <pre className="defi-pre">
                      {JSON.stringify(marketData, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {/* ════════ TOOLS — number display (mobile parity) ════════ */}
      {tab === "tools" && (
        <>
          <section className="defi-section">
            <div className="defi-section-header">
              <div className="defi-section-header-left">
                <span className="defi-section-title defi-section-title-dex">
                  Number Display
                </span>
              </div>
              <button
                type="button"
                className="defi-compact-btn"
                onClick={() =>
                  patchNumPrefs({ ...DEFAULT_NUMBER_DISPLAY_PREFS })
                }
              >
                Reset
              </button>
            </div>
            <div className="defi-section-body">
              <p className="defi-hint text-left mt-0 mb-2">
                Choose a quick preset or fine-tune how numbers, balances, limit
                orders, and pool UI appear — same options as mobile wallet.
              </p>

              <label className="defi-label">Quick presets</label>
              <div className="defi-subtabs">
                {(
                  Object.keys(NUMBER_DISPLAY_MODES) as NumberDisplayMode[]
                ).map((modeId) => {
                  const active = detectMode(numPrefs) === modeId;
                  return (
                    <button
                      key={modeId}
                      type="button"
                      className={`defi-compact-btn ${active ? "defi-compact-btn-active" : ""}`}
                      onClick={() => patchNumPrefs(prefsForMode(modeId))}
                    >
                      {NUMBER_DISPLAY_MODES[modeId].label}
                    </button>
                  );
                })}
              </div>
              <p className="defi-hint text-left mt-0 mb-2">
                {detectMode(numPrefs)
                  ? NUMBER_DISPLAY_MODES[detectMode(numPrefs)!].description
                  : "Custom — manual tweaks differ from all presets."}
              </p>

              <label className="defi-label">Decimal places (max)</label>
              <div className="defi-subtabs">
                {[
                  { label: "Full precision", value: null as number | null },
                  { label: "0", value: 0 },
                  { label: "2", value: 2 },
                  { label: "4", value: 4 },
                  { label: "6", value: 6 },
                  { label: "8", value: 8 },
                  { label: "10", value: 10 },
                  { label: "12", value: 12 },
                ].map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    className={`defi-compact-btn ${numPrefs.maxDecimals === opt.value ? "defi-compact-btn-active" : ""}`}
                    onClick={() => patchNumPrefs({ maxDecimals: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <label className="defi-label">Significant figures</label>
              <div className="defi-subtabs">
                {[
                  { label: "Off (use decimals)", value: null as number | null },
                  { label: "2", value: 2 },
                  { label: "3", value: 3 },
                  { label: "4", value: 4 },
                  { label: "5", value: 5 },
                  { label: "6", value: 6 },
                  { label: "8", value: 8 },
                ].map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    className={`defi-compact-btn ${numPrefs.sigFigs === opt.value ? "defi-compact-btn-active" : ""}`}
                    onClick={() => patchNumPrefs({ sigFigs: opt.value })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <label className="defi-label">Notation</label>
              <div className="defi-subtabs">
                {(
                  [
                    ["standard", "Standard (1,234.56)"],
                    ["compact", "Compact (1.23M)"],
                    ["scientific", "Scientific (1.23e+6)"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`defi-compact-btn ${numPrefs.notation === id ? "defi-compact-btn-active" : ""}`}
                    onClick={() =>
                      patchNumPrefs({ notation: id as NumberNotation })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>

              <label className="defi-check-row">
                <span
                  className={`defi-check ${numPrefs.useGrouping ? "defi-check-on" : ""}`}
                  onClick={() =>
                    patchNumPrefs({ useGrouping: !numPrefs.useGrouping })
                  }
                />
                <span
                  onClick={() =>
                    patchNumPrefs({ useGrouping: !numPrefs.useGrouping })
                  }
                >
                  Thousand separators
                </span>
              </label>
              <label className="defi-check-row">
                <span
                  className={`defi-check ${numPrefs.trimTrailingZeros ? "defi-check-on" : ""}`}
                  onClick={() =>
                    patchNumPrefs({
                      trimTrailingZeros: !numPrefs.trimTrailingZeros,
                    })
                  }
                />
                <span
                  onClick={() =>
                    patchNumPrefs({
                      trimTrailingZeros: !numPrefs.trimTrailingZeros,
                    })
                  }
                >
                  Trim trailing zeros
                </span>
              </label>

              <div className="defi-card mt-2">
                <div className="defi-row" style={{ marginBottom: 8 }}>
                  <span className="defi-label mb-0">Accent colors</span>
                  <button
                    type="button"
                    className="defi-compact-btn"
                    onClick={() =>
                      patchNumPrefs({
                        numberColor: DEFAULT_NUMBER_DISPLAY_PREFS.numberColor,
                        balanceColor: DEFAULT_NUMBER_DISPLAY_PREFS.balanceColor,
                        limitOrderBuyColor:
                          DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderBuyColor,
                        limitOrderSellColor:
                          DEFAULT_NUMBER_DISPLAY_PREFS.limitOrderSellColor,
                        liquidityPoolColor:
                          DEFAULT_NUMBER_DISPLAY_PREFS.liquidityPoolColor,
                      })
                    }
                  >
                    Color defaults
                  </button>
                </div>

                {(
                  [
                    ["numberColor", "Number color", "Prices & general numbers"],
                    [
                      "balanceColor",
                      "Balance color",
                      "Wallet balances & reserves",
                    ],
                    [
                      "limitOrderBuyColor",
                      "Buy order color",
                      "Limit buy badges & bars",
                    ],
                    [
                      "limitOrderSellColor",
                      "Sell order color",
                      "Limit sell badges & bars",
                    ],
                    [
                      "liquidityPoolColor",
                      "Liquidity pool color",
                      "Pool cards & LP labels",
                    ],
                  ] as const
                ).map(([key, label, desc]) => (
                  <div key={key} className="mb-3">
                    <label className="defi-label">{label}</label>
                    <p className="defi-hint text-left mt-0 mb-1">{desc}</p>
                    <div className="defi-subtabs">
                      {BRAND_COLOR_OPTIONS.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`defi-compact-btn ${
                            numPrefs[key] === c.id
                              ? "defi-compact-btn-active"
                              : ""
                          }`}
                          onClick={() =>
                            patchNumPrefs({
                              [key]: c.id as NumberColorId,
                            })
                          }
                        >
                          <span
                            className="defi-swatch"
                            style={{ background: c.hex }}
                          />
                          {c.id === DEFAULT_NUMBER_DISPLAY_PREFS[key]
                            ? "Default"
                            : c.label}
                        </button>
                      ))}
                    </div>
                    <p className="defi-hint text-left mt-1 mb-1">Fun colors</p>
                    <div className="defi-subtabs">
                      {FUN_COLOR_OPTIONS.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={`defi-compact-btn ${
                            numPrefs[key] === c.id
                              ? "defi-compact-btn-active"
                              : ""
                          }`}
                          onClick={() =>
                            patchNumPrefs({
                              [key]: c.id as NumberColorId,
                            })
                          }
                        >
                          <span
                            className="defi-swatch"
                            style={{ background: c.hex }}
                          />
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="defi-btn-row">
                  <span
                    className="defi-order-badge"
                    style={{
                      color: getBrandColorStyles(numPrefs.limitOrderBuyColor)
                        .text,
                      background: getBrandColorStyles(
                        numPrefs.limitOrderBuyColor,
                      ).bgMuted,
                    }}
                  >
                    BUY
                  </span>
                  <span
                    className="defi-order-badge"
                    style={{
                      color: getBrandColorStyles(numPrefs.limitOrderSellColor)
                        .text,
                      background: getBrandColorStyles(
                        numPrefs.limitOrderSellColor,
                      ).bgMuted,
                    }}
                  >
                    SELL
                  </span>
                  <span
                    className="defi-order-badge"
                    style={{
                      color: getBrandColorStyles(numPrefs.liquidityPoolColor)
                        .text,
                      background: getBrandColorStyles(
                        numPrefs.liquidityPoolColor,
                      ).bgMuted,
                    }}
                  >
                    LP POOL
                  </span>
                </div>
              </div>

              <div className="defi-card mt-2">
                <div className="defi-label">Preview</div>
                {(
                  [
                    ["Large supply", 1000000000],
                    ["Pool reserve", 2456789.12345678],
                    ["Tiny price", 0.0000000342],
                    ["Limit price", 0.0001523],
                  ] as const
                ).map(([label, value]) => (
                  <div className="defi-row" key={label}>
                    <span className="defi-card-sub">{label}</span>
                    <span
                      className="font-mono text-sm font-semibold"
                      style={{
                        color: getColorHex(
                          label.includes("reserve")
                            ? numPrefs.balanceColor
                            : numPrefs.numberColor,
                        ),
                      }}
                    >
                      {formatDisplayNumber(value, numPrefs)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="defi-section">
            <div className="defi-section-header">
              <span className="defi-section-title defi-section-title-dex">
                Node
              </span>
            </div>
            <div className="defi-section-body">
              <button
                type="button"
                className="defi-compact-btn w-full"
                onClick={() => navigate("/select-node")}
              >
                Change node
              </button>
              <button
                type="button"
                className="defi-compact-btn w-full mt-2"
                onClick={() => navigate("/home")}
              >
                Back to home
              </button>
              <p className="defi-hint">
                Nonce {wallet ? getSmartNonce(wallet) : 0} · fee default{" "}
                {DEFAULT_TX_FEE}
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function OrderCard({
  order,
  side,
  assetName,
  cancelling,
  onCancel,
  buyColor,
  sellColor,
  formatNum,
}: {
  order: OpenLimitOrder;
  side: "buy" | "sell";
  assetName: string;
  cancelling: string | null;
  onCancel: (txHash: string) => void;
  buyColor?: NumberColorId;
  sellColor?: NumberColorId;
  formatNum?: (v: unknown) => string;
}) {
  const amountRaw = order.amount?.str || "0";
  const filledRaw = order.filled?.str || "0";
  const amountNum = parseFloat(amountRaw);
  const filledNum = parseFloat(filledRaw);
  const fillPct =
    Number.isFinite(amountNum) && amountNum > 0
      ? Math.min(100, Math.floor((filledNum / amountNum) * 100))
      : 0;
  const limitValue =
    order.formattedLimitPrice ?? order.limit?.doubleAdjusted ?? "—";
  const sideStyles = getBrandColorStyles(
    side === "buy" ? buyColor || "blue" : sellColor || "rose",
  );
  const fmt = formatNum || ((v: unknown) => String(v ?? "—"));

  return (
    <div className="defi-order-card">
      <div className="defi-row">
        <span
          className="defi-order-badge"
          style={{
            color: sideStyles.text,
            background: sideStyles.bgMuted,
          }}
        >
          {side === "buy" ? "BUY" : "SELL"}
        </span>
        <div className="text-right">
          <div className="defi-order-label">Limit Price</div>
          <div className="defi-order-value">
            {fmt(limitValue)}{" "}
            <span className="defi-order-label">WART/{assetName}</span>
          </div>
        </div>
      </div>
      <div className="defi-row mt-2">
        <div>
          <div className="defi-order-label">Amount</div>
          <div className="defi-order-value font-mono">
            {fmt(amountRaw)}{" "}
            <span className="defi-order-label">{assetName}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="defi-order-label">Filled</div>
          <div className="defi-order-value font-mono">
            {fmt(filledRaw)}{" "}
            <span className="defi-order-label">{assetName}</span>
          </div>
        </div>
      </div>
      <div className="mt-2">
        <div className="defi-row">
          <span className="defi-order-label">Fill Progress</span>
          <span className="defi-order-label">{fillPct}%</span>
        </div>
        <div className="defi-progress-track">
          <div
            style={{
              width: `${fillPct}%`,
              height: "100%",
              borderRadius: 999,
              background: sideStyles.bgSolid,
            }}
          />
        </div>
      </div>
      {order.txHash && (
        <div className="defi-order-tx">
          <span className="defi-order-label">
            Tx{" "}
            <button
              type="button"
              className="defi-order-tx-hash"
              onClick={() => navigator.clipboard.writeText(order.txHash!)}
            >
              {abbreviate(order.txHash)}
            </button>
          </span>
          <button
            type="button"
            className="defi-compact-btn defi-danger"
            disabled={cancelling === order.txHash || fillPct >= 100}
            onClick={() => onCancel(order.txHash!)}
          >
            {cancelling === order.txHash ? "Canceling…" : "Cancel Order"}
          </button>
        </div>
      )}
    </div>
  );
}

export default DefiHub;
