/**
 * DeFi hub — closer match to mobile-wallet overview + send asset / DEX.
 * Nav: Overview · History · Send Asset · Assets · Tools
 * DEX swap card lives on Overview (under the tab bar, above Your Assets).
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import useWallet from "../hooks/useWallet";
import { isDefiNode } from "../utils/nodes";
import { DEFAULT_TX_FEE } from "../config/network";
import { fetchBalanceAndPin } from "../utils/warthogNode";
import { fetchWartUsdPrice } from "../utils/wartPrice";
import {
  amountExceedsAvailable,
  insufficientFreeBalanceMessage,
  mapInsufficientBalanceError,
} from "../utils/balanceBreakdown";
import SpendableBalanceDisplay from "../components/SpendableBalanceDisplay";
import {
  cancelOrderTx,
  createAssetTx,
  fetchAssetBalance,
  fetchLiquidityPositions,
  getOpenOrders,
  getSmartNonce,
  isValidAssetHash,
  lookupAsset,
  normalizeAssetHash,
  searchAssetsDetailed,
  transferAssetTx,
  type AssetInfo,
  type DefiAssetBalance,
  type LiquidityPosition,
  type OpenLimitOrder,
  type OpenOrdersByAsset,
} from "../utils/defiClient";
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
import SwapDexPanel from "../components/SwapDexPanel";
import SpendConfirm from "../components/SpendConfirm";
import AssetMark, { AssetTitle } from "../components/AssetMark";
import AssetChartPanel from "../components/AssetChartPanel";
import {
  isWebAuthnAvailable,
  inspectWalletBlob,
} from "../utils/passkeyWallet";
import { clearPasskeyWaiting, paintPasskeyWaiting } from "../utils/passkeyUi";
import { loadNamedWalletEncrypted } from "../utils/warthogWalletCrypto";

type MainTab =
  | "overview"
  | "history"
  | "send-asset"
  | "assets"
  | "dex"
  | "tools";
type AssetsSub = "search" | "create";
type ToolsSub = "passkey" | "display" | "node";

const TOOL_OPTIONS: { id: ToolsSub; label: string; subtitle: string }[] = [
  {
    id: "passkey",
    label: "Passkey & 2FA",
    subtitle: "Unlock with passkey or password + passkey",
  },
  {
    id: "display",
    label: "Number Display",
    subtitle: "Balances, orders, and colors",
  },
  { id: "node", label: "Node", subtitle: "Network and nonce" },
];

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
    signingUnlocked,
    enablePasskeyOnCurrentWallet,
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
  const [wartAvailable, setWartAvailable] = useState("0");
  const [wartLocked, setWartLocked] = useState("0");
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
  const [sendAvailable, setSendAvailable] = useState("");
  const [sendLocked, setSendLocked] = useState("");
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");


  // Assets create/search
  const [assetsSub, setAssetsSub] = useState<AssetsSub>("search");
  const [openAssetCharts, setOpenAssetCharts] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("warthogAssetCharts");
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(
        Array.isArray(arr) ? arr.map((h: unknown) => String(h).toLowerCase()) : [],
      );
    } catch {
      return new Set();
    }
  });
  const persistAssetCharts = (next: Set<string>) => {
    try {
      localStorage.setItem("warthogAssetCharts", JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  };
  const chartKey = (hash: string) => hash.replace(/^0x/i, "").toLowerCase();
  const toggleAssetChart = (hash: string) => {
    const key = chartKey(hash);
    if (!key) return;
    setOpenAssetCharts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      persistAssetCharts(next);
      return next;
    });
  };
  const chartOpen = (hash: string) => openAssetCharts.has(chartKey(hash));
  const toggleAllAssetCharts = (hashes: string[]) => {
    const keys = hashes.map(chartKey).filter(Boolean);
    if (!keys.length) return;
    setOpenAssetCharts((prev) => {
      const next = new Set(prev);
      const anyOpen = keys.some((k) => next.has(k));
      if (anyOpen) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      persistAssetCharts(next);
      return next;
    });
  };
  const [sendAssetConfirm, setSendAssetConfirm] = useState(false);
  const [toolsSub, setToolsSub] = useState<ToolsSub>("passkey");
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSupply, setCreateSupply] = useState("");
  const [createDecimals, setCreateDecimals] = useState("8");
  const [searchName, setSearchName] = useState("");
  const [searchHash, setSearchHash] = useState("");
  const [lookupHash, setLookupHash] = useState("");
  const [searchResults, setSearchResults] = useState<AssetInfo[]>([]);
  const [lookupResult, setLookupResult] = useState<unknown>(null);

  // DEX (swap panel + optional price chart)
  const [dexHash, setDexHash] = useState("");
  const [dexName, setDexName] = useState("");
  const [dexDecimals, setDexDecimals] = useState("8");
  const [dexPrefillKey, setDexPrefillKey] = useState(0);
  const [dexInitialMode, setDexInitialMode] = useState<
    "market" | "limit" | "pool"
  >("market");

  // Number display (Tools)
  const [numPrefs, setNumPrefs] = useState<NumberDisplayPrefs>(() =>
    loadNumberDisplayPrefs(),
  );

  // Passkey / 2FA (Tools — wartbunker parity)
  const [passkeysSupported] = useState(() => isWebAuthnAvailable());
  const [hasPasskey, setHasPasskey] = useState(false);
  const [hasPasswordAuth, setHasPasswordAuth] = useState(false);
  const [require2faActive, setRequire2faActive] = useState(false);
  const [want2fa, setWant2fa] = useState(false);
  const [passkeyPassword, setPasskeyPassword] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [awaitingPasskey, setAwaitingPasskey] = useState(false);

  const refreshPasskeyStatus = useCallback(async () => {
    const tag = (name || "").trim();
    if (!tag) {
      setHasPasskey(false);
      setHasPasswordAuth(false);
      setRequire2faActive(false);
      return;
    }
    try {
      const raw = await loadNamedWalletEncrypted(tag);
      const info = inspectWalletBlob(raw);
      setHasPasskey(Boolean(info.hasPasskey));
      setHasPasswordAuth(Boolean(info.hasPassword));
      setRequire2faActive(Boolean(info.require2fa));
      if (info.require2fa) setWant2fa(true);
    } catch {
      setHasPasskey(false);
      setHasPasswordAuth(false);
      setRequire2faActive(false);
    }
  }, [name]);

  useEffect(() => {
    if (tab === "tools") void refreshPasskeyStatus();
  }, [tab, refreshPasskeyStatus, wallet, signingUnlocked]);

  const handleEnablePasskey = async (force2fa?: boolean) => {
    if (!wallet || !signingUnlocked) {
      setError("Unlock your wallet first");
      return;
    }
    if (!passkeysSupported) {
      setError("Passkeys need HTTPS and a modern browser");
      return;
    }
    const twoFactor = Boolean(force2fa ?? want2fa);
    const pwd = passkeyPassword.trim() || null;
    if (twoFactor && !pwd && !hasPasswordAuth) {
      setError("2FA needs a password — enter it below");
      return;
    }
    setError(null);
    setStatus(null);
    try {
      await paintPasskeyWaiting(setAwaitingPasskey, setPasskeyBusy);
      const ok = await enablePasskeyOnCurrentWallet({
        password: pwd,
        name: name || "Main",
        preferFingerprint: false,
        require2fa: twoFactor,
      });
      if (ok) {
        setStatus(
          twoFactor
            ? `2FA enabled for “${name || "Main"}” — next login: password + passkey`
            : hasPasskey
              ? `Passkey re-registered for “${name || "Main"}”`
              : `Passkey enabled for “${name || "Main"}” — next login: Unlock with passkey`,
        );
        setPasskeyPassword("");
        await refreshPasskeyStatus();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable passkey");
    } finally {
      clearPasskeyWaiting(setAwaitingPasskey, setPasskeyBusy);
    }
  };

  const patchNumPrefs = (patch: Partial<NumberDisplayPrefs>) => {
    setNumPrefs((prev) => saveNumberDisplayPrefs({ ...prev, ...patch }));
  };

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
      setWartAvailable(bal.available);
      setWartLocked(bal.locked);
      const price = await fetchWartUsdPrice();
      // USD priced on total holdings (available + locked)
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
          available: "—",
          locked: "0",
          hasLocked: false,
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

  const openSendAsset = (asset: DefiAssetBalance) => {
    setSendHash(asset.hash);
    setSendName(asset.name);
    setSendDecimals(String(asset.decimals));
    setSendBalance(asset.balance);
    setSendAvailable(asset.available ?? asset.balance);
    setSendLocked(asset.locked ?? "0");
    setSendAmount("");
    setSendTo("");
    setTab("send-asset");
  };

  const openDexFor = (
    hash: string,
    assetName: string,
    decimals = 8,
    mode: "market" | "limit" | "pool" = "market",
  ) => {
    setDexHash(hash);
    setDexName(assetName);
    setDexDecimals(String(decimals));
    setDexInitialMode(mode);
    setDexPrefillKey((k) => k + 1);
    setTab("overview");
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
            <span className="defi-hero-label">
              {parseFloat(wartLocked) > 0
                ? "Available Balance"
                : "Total Balance"}
            </span>
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
              {formatDisplayNumber(
                parseFloat(wartLocked) > 0 ? wartAvailable : wartBalance,
                numPrefs,
              )}
            </span>
            <span className="defi-hero-unit">WART</span>
          </div>
          {parseFloat(wartLocked) > 0 ? (
            <div className="main-balance-meta" style={{ marginTop: 6 }}>
              <span>
                Total{" "}
                <span className="main-balance-meta-total">
                  {formatDisplayNumber(wartBalance, numPrefs)}
                </span>
              </span>
              <span className="main-balance-meta-locked">
                Locked{" "}
                <span className="main-balance-meta-locked-val">
                  {formatDisplayNumber(wartLocked, numPrefs)}
                </span>
                <span className="main-balance-meta-hint"> (open orders)</span>
              </span>
            </div>
          ) : null}
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

      {(tab === "overview" || tab === "dex") && (
        <>
          <SwapDexPanel
            key={`dex-${dexPrefillKey}-${dexHash || "none"}`}
            nodeUrl={nodeUrl}
            wallet={wallet || ""}
            fee={fee}
            onFeeChange={setFee}
            wartAvailable={wartAvailable}
            wartLocked={wartLocked}
            wartBalance={wartBalance}
            assetBalances={assetBalances}
            prefillHash={dexHash || undefined}
            prefillName={dexName || undefined}
            prefillDecimals={parseInt(dexDecimals, 10) || 8}
            busy={busy}
            setBusy={setBusy}
            setStatus={setStatus}
            setError={setError}
            onSuccess={async () => {
              await refreshBalance();
              await refreshAssets();
              await refreshOrders();
            }}
            onAssetChange={(hash, name, decimals) => {
              setDexHash(hash);
              setDexName(name);
              setDexDecimals(String(decimals));
            }}
            initialMode={dexInitialMode}
          />

          {/* Your Assets — collapsible bar (wartbunker / mobile overview) */}
          <section className="defi-section">
            <div className="defi-section-header defi-section-header-toggle">
              <button
                type="button"
                className="defi-section-header-left"
                onClick={() => setShowAssets((v) => !v)}
                aria-expanded={showAssets}
              >
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
              </button>
              <div className="flex items-center gap-2">
                {showAssets && assetBalances.length > 0 ? (
                  <button
                    type="button"
                    className={`defi-compact-btn ${
                      assetBalances.some((a) => chartOpen(a.hash))
                        ? "defi-compact-btn-active"
                        : ""
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleAllAssetCharts(assetBalances.map((a) => a.hash));
                    }}
                  >
                    Charts
                  </button>
                ) : null}
                {assetBalances.length > 1 && showAssets && (
                  <span className="defi-hint mt-0 mb-0 text-[10px]">
                    Drag ⋮⋮ to reorder
                  </span>
                )}
              </div>
            </div>
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
                    <div className="defi-asset-head">
                      <div className="defi-asset-id">
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
                        <AssetMark hash={asset.hash} name={asset.name} />
                        <div className="ml-2 min-w-0">
                          <div className="defi-card-title">
                            <AssetTitle hash={asset.hash} name={asset.name} />
                          </div>
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
                      <div className="defi-asset-amounts">
                        <SpendableBalanceDisplay
                          layout="row"
                          available={asset.available ?? asset.balance}
                          locked={asset.locked}
                          total={asset.balance}
                          unit={asset.name}
                          primaryColor={getColorHex(numPrefs.balanceColor)}
                          primaryClassName="defi-balance"
                        />
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
                        className={`defi-compact-btn ${
                          chartOpen(asset.hash) ? "defi-compact-btn-active" : ""
                        }`}
                        onClick={() => toggleAssetChart(asset.hash)}
                      >
                        Chart
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
                    {chartOpen(asset.hash) ? (
                      <AssetChartPanel
                        nodeUrl={nodeUrl}
                        hash={asset.hash}
                        assetName={asset.name}
                      />
                    ) : null}
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
                          openDexFor(pos.hash, pos.name, pos.decimals, "pool");
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
            <label className="defi-label">Asset</label>
            <select
              className="defi-input"
              value={sendHash}
              onChange={(e) => {
                const hash = e.target.value;
                const match = assetBalances.find(
                  (a) => a.hash.toLowerCase() === hash.toLowerCase(),
                );
                if (match) openSendAsset(match);
                else setSendHash(hash);
              }}
            >
              <option value="">Select token</option>
              {sendHash &&
                !assetBalances.some(
                  (a) => a.hash.toLowerCase() === sendHash.toLowerCase(),
                ) && (
                  <option value={sendHash}>{sendName || "Selected asset"}</option>
                )}
              {assetBalances.map((a) => (
                <option key={a.hash} value={a.hash}>
                  {a.name}
                </option>
              ))}
            </select>
            {assetBalances.length === 0 && (
              <p className="defi-hint text-left mt-0 mb-2">
                Track a token on Overview or Search first.
              </p>
            )}
            <label className="defi-label">To</label>
            <input
              className="defi-input"
              value={sendTo}
              onChange={(e) => setSendTo(e.target.value)}
              placeholder="Enter public address"
            />
            {(sendAvailable || sendBalance) && (
              <div className="mb-2">
                <SpendableBalanceDisplay
                  layout="stack"
                  label="Available"
                  available={sendAvailable || sendBalance}
                  locked={sendLocked}
                  total={sendBalance}
                  unit={sendName || undefined}
                />
              </div>
            )}
            <label className="defi-label">Amount</label>
            <div className="defi-row" style={{ alignItems: "center", marginBottom: 8 }}>
              <input
                className="defi-input mb-0"
                value={sendAmount}
                onChange={(e) => setSendAmount(e.target.value)}
                placeholder="0"
              />
              {(sendAvailable || sendBalance) &&
                (sendAvailable || sendBalance) !== "—" && (
                <button
                  type="button"
                  className="defi-compact-btn shrink-0"
                  onClick={() =>
                    setSendAmount(sendAvailable || sendBalance)
                  }
                >
                  Max
                </button>
              )}
            </div>
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
              onClick={() => setSendAssetConfirm(true)}
            >
              {busy ? "Sending…" : "Send Asset"}
            </button>
            <SpendConfirm
              open={sendAssetConfirm}
              title="Confirm send asset"
              rows={[
                { label: "Asset", value: sendName || sendHash || "—" },
                { label: "To", value: sendTo || "—" },
                { label: "Amount", value: sendAmount || "—" },
                { label: "Fee", value: `${fee} WART` },
              ]}
              busy={busy}
              onCancel={() => setSendAssetConfirm(false)}
              onConfirm={() => {
                setSendAssetConfirm(false);
                void run(async () => {
                  if (!wallet || !nodeUrl) return;
                  if (!sendHash || !sendTo || !sendAmount) {
                    throw new Error(
                      "Asset hash, recipient, and amount are required",
                    );
                  }
                  // Live re-fetch free balance at submit
                  let free = sendAvailable || sendBalance;
                  let locked = sendLocked || "0";
                  try {
                    const live = await fetchAssetBalance(
                      nodeUrl,
                      wallet,
                      sendHash,
                    );
                    free = live.available;
                    locked = live.locked;
                    setSendBalance(live.balance);
                    setSendAvailable(live.available);
                    setSendLocked(live.locked);
                  } catch {
                    /* use cached */
                  }
                  if (amountExceedsAvailable(sendAmount, free)) {
                    setSendAmount(free);
                    throw new Error(
                      insufficientFreeBalanceMessage({
                        available: free,
                        locked,
                        unit: sendName || undefined,
                      }),
                    );
                  }
                  try {
                    const r = await transferAssetTx(nodeUrl, wallet, {
                      assetHash: sendHash,
                      toAddress: sendTo,
                      amount: sendAmount,
                      decimals: parseInt(sendDecimals, 10) || 8,
                      isLiquidity: false,
                      fee,
                    });
                    setStatus(`Sent · ${r.txHash || "submitted"}`);
                    setSendAmount("");
                    setSendTo("");
                    await refreshAssets();
                  } catch (e) {
                    throw new Error(
                      mapInsufficientBalanceError(e, {
                        available: free,
                        locked,
                        unit: sendName || undefined,
                      }),
                    );
                  }
                });
              }}
            />
          </div>
        </section>
      )}

      {/* ════════ ASSETS create / search ════════ */}
      {tab === "assets" && (
        <>
          <div className="defi-subtabs">
            {(
              [
                ["search", "Search"],
                ["create", "Create"],
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
                      const decRaw = parseInt(createDecimals, 10);
                      const decimals = Number.isFinite(decRaw) ? decRaw : 8;
                      const r = await createAssetTx(nodeUrl, wallet, {
                        name: createName,
                        supply: createSupply,
                        decimals,
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
                {searchResults.length > 0 ? (
                  <div className="defi-btn-row mt-2">
                    <button
                      type="button"
                      className={`defi-compact-btn ${
                        searchResults.some((a) =>
                          chartOpen(String(a.hash || a.assetHash || "")),
                        )
                          ? "defi-compact-btn-active"
                          : ""
                      }`}
                      onClick={() =>
                        toggleAllAssetCharts(
                          searchResults
                            .map((a) => String(a.hash || a.assetHash || ""))
                            .filter(Boolean),
                        )
                      }
                    >
                      Charts
                    </button>
                  </div>
                ) : null}
                {searchResults.map((asset, i) => {
                  const hash = asset.hash || asset.assetHash || "";
                  const tracked = hash ? isTracked(hash) : false;
                  return (
                    <div key={hash || i} className="defi-card mt-2">
                      <div className="defi-row" style={{ marginBottom: 6 }}>
                        {hash ? (
                          <AssetMark hash={hash} name={asset.name || "Asset"} />
                        ) : null}
                        <div className="defi-card-title min-w-0">
                          {hash ? (
                            <AssetTitle hash={hash} name={asset.name || "Asset"} />
                          ) : (
                            asset.name || "Asset"
                          )}
                          {tracked && (
                            <span className="defi-badge defi-badge-blue ml-2">
                              Tracked
                            </span>
                          )}
                        </div>
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
                                available: "—",
                                locked: "0",
                                hasLocked: false,
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
                            DEX
                          </button>
                          <button
                            type="button"
                            className={`defi-compact-btn ${
                              chartOpen(hash) ? "defi-compact-btn-active" : ""
                            }`}
                            onClick={() => toggleAssetChart(hash)}
                          >
                            Chart
                          </button>
                        </div>
                      )}
                      {hash && chartOpen(hash) ? (
                        <AssetChartPanel
                          nodeUrl={nodeUrl}
                          hash={hash}
                          assetName={asset.name || "Asset"}
                        />
                      ) : null}
                    </div>
                  );
                })}
                {lookupResult != null && (
                  <>
                    <pre className="defi-pre">
                      {JSON.stringify(lookupResult, null, 2)}
                    </pre>
                    {(lookupResult as { hash?: string; name?: string }).hash ? (
                      <div className="defi-btn-row mt-2">
                        <button
                          type="button"
                          className={`defi-compact-btn ${
                            chartOpen(
                              (lookupResult as { hash: string }).hash,
                            )
                              ? "defi-compact-btn-active"
                              : ""
                          }`}
                          onClick={() =>
                            toggleAssetChart(
                              (lookupResult as { hash: string }).hash,
                            )
                          }
                        >
                          Chart
                        </button>
                      </div>
                    ) : null}
                    {(lookupResult as { hash?: string }).hash &&
                    chartOpen((lookupResult as { hash: string }).hash) ? (
                      <AssetChartPanel
                        nodeUrl={nodeUrl}
                        hash={(lookupResult as { hash: string }).hash}
                        assetName={
                          (lookupResult as { name?: string }).name || "Asset"
                        }
                      />
                    ) : null}
                  </>
                )}
              </div>
            </section>
          )}
        </>
      )}

      {/* ════════ TOOLS — one card at a time (tx-filter style dropdown) ════════ */}
      {tab === "tools" && (
        <>
          <div className="tx-filter-dropdown">
            <button
              type="button"
              className="tx-filter-summary"
              onClick={() => setShowToolsMenu((v) => !v)}
              aria-expanded={showToolsMenu}
              aria-controls="tools-picker-options"
            >
              <span className="tx-filter-summary-left">
                <span className="tx-filter-chevron" aria-hidden="true">
                  {showToolsMenu ? "▼" : "▶"}
                </span>
                <span className="tx-filter-summary-text">
                  <span className="tx-filter-title">Tool</span>
                  <span className="tx-filter-subtitle">
                    {TOOL_OPTIONS.find((t) => t.id === toolsSub)?.subtitle ||
                      "Choose a tool"}
                  </span>
                </span>
              </span>
              <span className="tx-action-btn tx-action-btn-active tx-filter-active-chip">
                {TOOL_OPTIONS.find((t) => t.id === toolsSub)?.label || "Passkey"}
              </span>
            </button>
            {showToolsMenu && (
              <div
                id="tools-picker-options"
                className="tx-filter-body"
                role="listbox"
                aria-label="Tools"
              >
                <div className="tx-filter-row">
                  {TOOL_OPTIONS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      role="option"
                      aria-selected={toolsSub === t.id}
                      className={`tx-action-btn ${
                        toolsSub === t.id ? "tx-action-btn-active" : ""
                      }`}
                      onClick={() => {
                        setToolsSub(t.id);
                        setShowToolsMenu(false);
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {toolsSub === "passkey" &&
            (wallet && signingUnlocked ? (
            <section
              className="defi-section"
              style={{
                borderColor: require2faActive
                  ? "rgba(56, 189, 248, 0.4)"
                  : hasPasskey
                    ? "rgba(52, 211, 153, 0.35)"
                    : "rgba(245, 158, 11, 0.45)",
              }}
            >
              <div className="defi-section-header">
                <div className="defi-section-header-left">
                  <span className="defi-section-title defi-section-title-dex">
                    Passkey &amp; 2FA login
                  </span>
                </div>
              </div>
              <div className="defi-section-body">
                <p className="defi-hint text-left mt-0 mb-2">
                  Enable one-tap passkey unlock, or require password + passkey
                  (2FA). Chrome may offer Scan QR, a security key, or this
                  device.
                </p>
                {!passkeysSupported ? (
                  <p className="defi-error text-left">
                    Passkeys need HTTPS and a modern browser.
                  </p>
                ) : (
                  <>
                    {require2faActive ? (
                      <p className="defi-hint text-left mt-0 mb-2" style={{ color: "#7dd3fc" }}>
                        ✓ 2FA active{name ? <> for <span className="font-mono">{name}</span></> : null}
                        {" "}— password then passkey at login
                      </p>
                    ) : hasPasskey ? (
                      <p className="defi-hint text-left mt-0 mb-2" style={{ color: "#6ee7b7" }}>
                        ✓ Passkey enabled{name ? <> for <span className="font-mono">{name}</span></> : null}
                      </p>
                    ) : (
                      <p className="defi-hint text-left mt-0 mb-2">
                        Not enabled yet for this saved name.
                      </p>
                    )}

                    <label className="defi-check-row">
                      <span
                        className={`defi-check ${want2fa ? "defi-check-on" : ""}`}
                        onClick={() => setWant2fa(!want2fa)}
                      />
                      <span onClick={() => setWant2fa(!want2fa)}>
                        Require 2FA — password and passkey every login
                      </span>
                    </label>

                    {(want2fa || !hasPasswordAuth) && (
                      <>
                        <label className="defi-label">
                          Wallet password
                          {want2fa ? " (required for 2FA)" : " (optional)"}
                        </label>
                        <input
                          className="defi-input"
                          type="password"
                          autoComplete="current-password"
                          value={passkeyPassword}
                          onChange={(e) => setPasskeyPassword(e.target.value)}
                          placeholder={want2fa ? "Password for 2FA" : "Optional"}
                          disabled={passkeyBusy}
                        />
                      </>
                    )}

                    <button
                      type="button"
                      className="defi-btn-primary"
                      disabled={passkeyBusy || !passkeysSupported}
                      onClick={() => void handleEnablePasskey(want2fa)}
                    >
                      {awaitingPasskey || passkeyBusy
                        ? "Waiting for passkey…"
                        : want2fa
                          ? hasPasskey
                            ? "Update passkey + keep 2FA"
                            : "Enable passkey with 2FA"
                          : hasPasskey
                            ? "Re-register passkey"
                            : "Enable passkey"}
                    </button>

                    {hasPasskey && !require2faActive ? (
                      <button
                        type="button"
                        className="defi-compact-btn mt-2"
                        style={{ width: "100%" }}
                        disabled={passkeyBusy}
                        onClick={() => {
                          setWant2fa(true);
                          void handleEnablePasskey(true);
                        }}
                      >
                        Enable 2FA (password + passkey)
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </section>
          ) : (
            <section className="defi-section">
              <div className="defi-section-body">
                <p className="defi-hint text-left mt-0 mb-0">
                  Unlock your wallet to enable passkey / 2FA login from Tools.
                </p>
              </div>
            </section>
          ))}

          {toolsSub === "display" && (
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
          )}

          {toolsSub === "node" && (
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
          )}
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
