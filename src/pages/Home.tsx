import React, { useState, useCallback, useEffect, useMemo } from "react";
import ProfileHeader from "../components/ProfileHeader";
import WalletInfo from "../components/WalletInfo";
import Balance from "../components/Balance";
import ActionButtons from "../components/ActionButtons";
import TabNavigation from "../components/TabNavigation";
import TokenItem from "../components/TokenItem";
import ActivityItem, { type ActivityRow } from "../components/ActivityItem";
import { useNavigate } from "react-router-dom";
import useWallet from "../hooks/useWallet";
import {
  fetchAccountHistory,
  fetchBalanceAndPin,
  type HistoryItem,
} from "../utils/warthogNode";
import { fetchWartUsdPrice } from "../utils/wartPrice";
import { isDefiNode } from "../utils/nodes";

interface Activity extends ActivityRow {}

interface Props {
  setSelectedActivity: (activity: Activity) => void;
}

enum Tab {
  Tokens,
  Activity,
}

const Home: React.FC<Props> = ({ setSelectedActivity }) => {
  const { wallet, selectedNodeUrl, selectedNetworkLabel, selectedNodeIndex, nodeList } =
    useWallet();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>(Tab.Tokens);
  const [balance, setBalance] = useState(0);
  const [balanceUSD, setBalanceUSD] = useState(0);
  const [priceUsd, setPriceUsd] = useState(0);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showTransactions, setShowTransactions] = useState(true);
  const [visibleCount, setVisibleCount] = useState(7);

  const nodeUrl =
    selectedNodeUrl ||
    (nodeList.length > 0 ? nodeList[selectedNodeIndex] : null);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const handleActivityClick = (activityItem: Activity) => {
    setSelectedActivity(activityItem);
    navigate("/activity-details");
  };

  const updateBalance = useCallback(async () => {
    if (!wallet || !nodeUrl) return;
    try {
      const result = await fetchBalanceAndPin(nodeUrl, wallet);
      setBalance(parseFloat(result.balance) || 0);
      setBalanceError(null);
    } catch (error) {
      console.error("Error fetching balance:", error);
      setBalanceError(
        error instanceof Error ? error.message : "Failed to fetch balance",
      );
    }
  }, [wallet, nodeUrl]);

  const updatePrice = useCallback(async () => {
    try {
      const price = await fetchWartUsdPrice();
      setPriceUsd(price && price > 0 ? price : 0);
      setBalanceUSD(price && price > 0 ? price : 0);
    } catch (error) {
      console.error("Error fetching price:", error);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!wallet || !nodeUrl) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const items: HistoryItem[] = await fetchAccountHistory(nodeUrl, wallet);
      const price = priceUsd > 0 ? priceUsd : (await fetchWartUsdPrice()) || 0;
      const withUsd = items.map((item) => {
        const numeric =
          Math.abs(parseFloat((item.amountRaw || item.amount).replace(/[^\d.-]/g, ""))) ||
          0;
        const usd = price > 0 ? `$${(numeric * price).toFixed(2)}` : "N/A";
        return { ...item, usdAmount: usd };
      });
      setActivities(withUsd);
      setVisibleCount(7);
    } catch (error) {
      console.warn("History fetch failed:", error);
      setHistoryError(
        error instanceof Error ? error.message : "History unavailable on this node",
      );
      setActivities([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [wallet, nodeUrl, priceUsd]);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([updateBalance(), updatePrice()]);
      if (activeTab === Tab.Activity) await loadHistory();
    } finally {
      setRefreshing(false);
    }
  }, [updateBalance, updatePrice, activeTab, loadHistory]);

  useEffect(() => {
    if (!wallet || !nodeUrl) return;

    updateBalance();
    updatePrice();

    const intervalId = setInterval(updateBalance, 15_000);
    const intervalPrice = setInterval(updatePrice, 5 * 60_000);
    return () => {
      clearInterval(intervalId);
      clearInterval(intervalPrice);
    };
  }, [wallet, nodeUrl, updateBalance, updatePrice]);

  useEffect(() => {
    if (activeTab === Tab.Activity) {
      loadHistory();
    }
  }, [activeTab, loadHistory]);

  const isTestnet = nodeUrl ? isDefiNode(nodeUrl) : false;

  const blockCounts = useMemo(() => {
    const now = Date.now() / 1000;
    const rewards = activities.filter((tx) => tx.isReward);
    return {
      h24: rewards.filter((tx) => (tx.timestamp || 0) >= now - 86400).length,
      week: rewards.filter((tx) => (tx.timestamp || 0) >= now - 604800).length,
      month: rewards.filter((tx) => (tx.timestamp || 0) >= now - 2592000).length,
    };
  }, [activities]);

  const nodeLabel = nodeUrl
    ? nodeUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")
    : "";

  return (
    <div className="container min-h-screen">
      <div className="main-home-card">
        <ProfileHeader />
        <div className="w-full px-1 flex items-center justify-between mb-2">
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              isTestnet
                ? "bg-amber-500/20 text-amber-300 border border-amber-400/40"
                : "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30"
            }`}
          >
            {selectedNetworkLabel}
          </span>
          <button
            type="button"
            className="text-xs text-white/60 hover:text-primary underline"
            onClick={() => navigate("/select-node")}
          >
            Change node
          </button>
        </div>
        <Balance
          balance={balance}
          usdValue={balanceUSD}
          isTestnet={isTestnet}
          refreshing={refreshing}
          onRefresh={refreshAll}
          networkLabel={isTestnet ? "DeFi Testnet" : "Mainnet"}
          nodeLabel={nodeLabel}
        />
        <WalletInfo
          wallet={wallet}
          onCopy={() => copyToClipboard(wallet || "")}
        />
        {balanceError && (
          <p className="text-red-400 text-xs px-1 w-full mt-1">{balanceError}</p>
        )}
        <ActionButtons />
      </div>
      <TabNavigation activeTab={activeTab} setActiveTab={setActiveTab} />
      {activeTab === Tab.Tokens ? (
        <TokenItem
          token="WART"
          balance={balance}
          usdValue={balanceUSD || 0}
        />
      ) : (
        <div className="tx-history-section">
          <p className="tx-section-label">Blocks Mined</p>
          <div className="tx-reward-row">
            <span className="tx-reward-pill">24h: {blockCounts.h24}</span>
            <span className="tx-reward-pill">Week: {blockCounts.week}</span>
            <span className="tx-reward-pill">Month: {blockCounts.month}</span>
          </div>

          <h3 className="tx-section-title">Transaction History</h3>
          <p className="tx-network-note">
            {isTestnet
              ? "DeFi testnet — includes WART transfers, assets, DEX orders, liquidity, and more"
              : "Mainnet — WART transfers and block rewards"}
          </p>

          <div className="tx-btn-row">
            <button
              type="button"
              className="tx-action-btn"
              disabled={loadingHistory}
              onClick={() => loadHistory()}
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
                <p className="tx-empty">Loading transaction history…</p>
              )}
              {!loadingHistory && !historyError && activities.length === 0 && (
                <p className="tx-empty">No transactions yet</p>
              )}
              <ActivityItem
                activities={activities.slice(0, visibleCount)}
                onActivityClick={handleActivityClick}
                walletAddress={wallet}
              />
              {activities.length > visibleCount && (
                <button
                  type="button"
                  className="tx-show-more"
                  onClick={() => setVisibleCount((c) => c + 7)}
                >
                  Show More
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Home;
