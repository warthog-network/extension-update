/**
 * Shared transaction history (indexer-first on DeFi, node fallback).
 * Used on Home → Activity and DeFi hub → History.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import ActivityItem, { type ActivityRow } from "./ActivityItem";
import {
  fetchAccountHistory,
  type HistoryItem,
} from "../utils/warthogNode";
import { fetchWartUsdPrice } from "../utils/wartPrice";
import { isDefiNode } from "../utils/nodes";

export type HistoryActivity = ActivityRow;

const MAINNET_FILTERS = [
  { id: "all", label: "All" },
  { id: "rewards", label: "Rewards" },
  { id: "transfers", label: "Transfers" },
  { id: "in", label: "In" },
  { id: "out", label: "Out" },
] as const;

const DEFI_FILTERS = [
  { id: "all", label: "All" },
  { id: "rewards", label: "Rewards" },
  { id: "transfers", label: "Transfers" },
  { id: "limit_swaps", label: "Limit Swaps" },
  { id: "matches", label: "Matches" },
  { id: "cancels", label: "Cancels" },
  { id: "asset_creations", label: "Asset Creation" },
  { id: "liquidity", label: "Liquidity" },
  { id: "in", label: "In" },
  { id: "out", label: "Out" },
] as const;

function matchesLocalFilter(
  tx: HistoryActivity,
  filter: string,
  account: string,
): boolean {
  if (!filter || filter === "all") return true;
  const type = String(tx.type || "").toLowerCase().replace(/-/g, "_");
  const isReward = Boolean(tx.isReward) || type === "reward";
  const dir = String(tx.direction || "").toLowerCase();

  if (filter === "rewards") return isReward;
  if (filter === "transfers") {
    return (
      type === "wart_transfer" ||
      type === "token_transfer" ||
      type === "transfer"
    );
  }
  if (filter === "limit_swaps") return type === "limit_swap";
  if (filter === "matches") return type === "match";
  if (filter === "cancels") {
    return type === "cancelation" || type.includes("cancel");
  }
  if (filter === "asset_creations") return type === "asset_creation";
  if (filter === "liquidity") {
    return type === "liquidity_deposit" || type === "liquidity_withdrawal";
  }
  if (filter === "in") {
    if (dir === "in") return true;
    if (dir === "out" || dir === "self") return false;
    return isReward || tx.isIncoming === true || type === "liquidity_withdrawal";
  }
  if (filter === "out") {
    if (dir === "out") return true;
    if (dir === "in" || dir === "self") return false;
    if (isReward) return false;
    if (tx.isIncoming === true) return false;
    if (type === "match") return false;
    if (
      account &&
      tx.fromAddress?.toLowerCase().startsWith(account.slice(0, 40))
    ) {
      return true;
    }
    return false;
  }
  return true;
}

type Props = {
  wallet: string | null | undefined;
  nodeUrl: string | null | undefined;
  /** When true, panel loads immediately (e.g. History tab open). */
  active?: boolean;
  onActivityClick?: (activity: HistoryActivity) => void;
  /** Optional external refresh token — bump to force reload. */
  refreshKey?: number | string;
  className?: string;
};

const TransactionHistoryPanel: React.FC<Props> = ({
  wallet,
  nodeUrl,
  active = true,
  onActivityClick,
  refreshKey,
  className = "",
}) => {
  const isTestnet = nodeUrl ? isDefiNode(nodeUrl) : false;
  const filters = isTestnet ? DEFI_FILTERS : MAINNET_FILTERS;

  const [activities, setActivities] = useState<HistoryActivity[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showTransactions, setShowTransactions] = useState(true);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [visibleCount, setVisibleCount] = useState(7);
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historySource, setHistorySource] = useState<"indexer" | "node" | null>(
    null,
  );
  const [hasMore, setHasMore] = useState(false);
  const [nextPage, setNextPage] = useState(2);
  const [nodeCursor, setNodeCursor] = useState<number | string | null>(null);
  const [priceUsd, setPriceUsd] = useState(0);

  const withUsd = useCallback(
    (items: HistoryItem[], price: number): HistoryActivity[] =>
      items.map((item) => {
        const numeric =
          Math.abs(
            parseFloat(
              (item.amountRaw || item.amount || "0").replace(/[^\d.-]/g, ""),
            ),
          ) || 0;
        const usd = price > 0 ? `$${(numeric * price).toFixed(2)}` : "N/A";
        return { ...item, usdAmount: usd };
      }),
    [],
  );

  const loadHistory = useCallback(
    async (opts?: { filter?: string; append?: boolean }) => {
      if (!wallet || !nodeUrl) return;
      const filter = opts?.filter ?? historyFilter;
      const append = Boolean(opts?.append);

      if (append) setLoadingMore(true);
      else setLoadingHistory(true);
      setHistoryError(null);

      try {
        const price =
          priceUsd > 0 ? priceUsd : (await fetchWartUsdPrice()) || 0;
        if (price > 0) setPriceUsd(price);

        if (append && historySource === "indexer") {
          const result = await fetchAccountHistory(nodeUrl, wallet, {
            page: nextPage,
            filter,
          });
          setHistorySource(result.source);
          setHasMore(result.hasMore);
          if (result.nextPage) setNextPage(result.nextPage);
          setActivities((prev) => [...prev, ...withUsd(result.items, price)]);
        } else if (append && historySource === "node" && nodeCursor != null) {
          const result = await fetchAccountHistory(nodeUrl, wallet, {
            beforeTxIndex: nodeCursor,
            filter: "all",
          });
          setHistorySource(result.source);
          setHasMore(result.hasMore);
          setNodeCursor(result.fromId ?? null);
          const account = wallet.toLowerCase();
          const mapped = withUsd(result.items, price).filter((tx) =>
            matchesLocalFilter(tx, filter, account),
          );
          setActivities((prev) => [...prev, ...mapped]);
        } else {
          const result = await fetchAccountHistory(nodeUrl, wallet, {
            page: 1,
            filter,
          });
          setHistorySource(result.source);
          setHasMore(result.hasMore);
          setNextPage(result.nextPage ?? 2);
          setNodeCursor(result.fromId ?? null);
          setVisibleCount(7);

          if (result.source === "indexer") {
            setActivities(withUsd(result.items, price));
          } else {
            const account = wallet.toLowerCase();
            setActivities(
              withUsd(result.items, price).filter((tx) =>
                matchesLocalFilter(tx, filter, account),
              ),
            );
          }
        }
      } catch (error) {
        console.warn("History fetch failed:", error);
        setHistoryError(
          error instanceof Error
            ? error.message
            : "History unavailable on this node",
        );
        if (!append) setActivities([]);
      } finally {
        setLoadingHistory(false);
        setLoadingMore(false);
      }
    },
    [
      wallet,
      nodeUrl,
      priceUsd,
      historyFilter,
      historySource,
      nextPage,
      nodeCursor,
      withUsd,
    ],
  );

  // Reset when wallet/node changes
  useEffect(() => {
    setHistoryFilter("all");
    setHistorySource(null);
    setActivities([]);
    setNextPage(2);
    setNodeCursor(null);
  }, [wallet, nodeUrl]);

  useEffect(() => {
    if (!active || !wallet || !nodeUrl) return;
    loadHistory({ filter: historyFilter, append: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on filter/active/identity
  }, [active, historyFilter, wallet, nodeUrl, refreshKey]);

  const blockCounts = useMemo(() => {
    const now = Date.now() / 1000;
    const rewards = activities.filter((tx) => tx.isReward);
    return {
      h24: rewards.filter((tx) => (tx.timestamp || 0) >= now - 86400).length,
      week: rewards.filter((tx) => (tx.timestamp || 0) >= now - 604800).length,
      month: rewards.filter((tx) => (tx.timestamp || 0) >= now - 2592000).length,
    };
  }, [activities]);

  const visible = activities.slice(0, visibleCount);
  const canShowMoreLocal = activities.length > visibleCount;
  const canLoadMore = hasMore || canShowMoreLocal;

  const handleClick = (item: HistoryActivity) => {
    onActivityClick?.(item);
  };

  return (
    <div className={`tx-history-section ${className}`.trim()}>
      <p className="tx-section-label">Blocks Mined</p>
      <div className="tx-reward-row">
        <span className="tx-reward-pill">24h: {blockCounts.h24}</span>
        <span className="tx-reward-pill">Week: {blockCounts.week}</span>
        <span className="tx-reward-pill">Month: {blockCounts.month}</span>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="tx-section-title !mt-0.5">Transaction History</h3>
        {historySource && (
          <span className="tx-source-pill">
            {historySource === "indexer" ? "Indexer" : "Node"}
          </span>
        )}
      </div>
      <p className="tx-network-note">
        {isTestnet
          ? historySource === "indexer"
            ? "DeFi testnet — indexer history with rich DEX cards"
            : "DeFi testnet — node history (indexer unavailable)"
          : "Mainnet — WART transfers and block rewards"}
      </p>

      <div className="tx-filter-dropdown">
        <button
          type="button"
          className="tx-filter-summary"
          onClick={() => setShowFilterPanel((v) => !v)}
          aria-expanded={showFilterPanel}
          aria-controls="tx-filter-options"
        >
          <span className="tx-filter-summary-left">
            <span className="tx-filter-chevron" aria-hidden="true">
              {showFilterPanel ? "▼" : "▶"}
            </span>
            <span className="tx-filter-summary-text">
              <span className="tx-filter-title">Filter</span>
              <span className="tx-filter-subtitle">Type and direction</span>
            </span>
          </span>
          <span className="tx-action-btn tx-action-btn-active tx-filter-active-chip">
            {filters.find((f) => f.id === historyFilter)?.label || "All"}
          </span>
        </button>
        {showFilterPanel && (
          <div
            id="tx-filter-options"
            className="tx-filter-body"
            role="listbox"
            aria-label="History filter"
          >
            <div className="tx-filter-row">
              {filters.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="option"
                  aria-selected={historyFilter === f.id}
                  className={`tx-action-btn ${historyFilter === f.id ? "tx-action-btn-active" : ""}`}
                  onClick={() => {
                    setHistoryFilter(f.id);
                    setVisibleCount(7);
                    setShowFilterPanel(false);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="tx-btn-row">
        <button
          type="button"
          className="tx-action-btn"
          disabled={loadingHistory}
          onClick={() =>
            loadHistory({ filter: historyFilter, append: false })
          }
        >
          {loadingHistory ? "Refreshing…" : "Refresh"}
        </button>
        <button
          type="button"
          className={`tx-action-btn ${showTransactions ? "tx-action-btn-active" : ""}`}
          onClick={() => setShowTransactions((v) => !v)}
        >
          {showTransactions ? "Hide Transactions" : "Show Transactions"}
        </button>
      </div>

      {historyError && !loadingHistory && (
        <p className="tx-error">{historyError}</p>
      )}

      {showTransactions && (
        <>
          {loadingHistory && activities.length === 0 && (
            <p className="tx-empty">
              {historySource === "indexer" || isTestnet
                ? "Loading from indexer…"
                : "Loading transaction history…"}
            </p>
          )}
          {!loadingHistory && !historyError && activities.length === 0 && (
            <p className="tx-empty">
              {historyFilter === "all"
                ? "No transactions yet"
                : `No ${filters.find((f) => f.id === historyFilter)?.label.toLowerCase() || "matching"} transactions found.`}
            </p>
          )}
          <ActivityItem
            activities={visible}
            onActivityClick={handleClick}
            walletAddress={wallet}
          />
          {canLoadMore && (
            <button
              type="button"
              className="tx-show-more"
              disabled={loadingMore || loadingHistory}
              onClick={() => {
                if (canShowMoreLocal) {
                  setVisibleCount((c) => c + 7);
                } else if (hasMore) {
                  loadHistory({ filter: historyFilter, append: true });
                  setVisibleCount((c) => c + 7);
                }
              }}
            >
              {loadingMore ? "Loading…" : "Show More"}
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default TransactionHistoryPanel;
