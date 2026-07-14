import React, { useState, useCallback, useEffect } from "react";
import ProfileHeader from "../components/ProfileHeader";
import WalletInfo from "../components/WalletInfo";
import Balance from "../components/Balance";
import ActionButtons from "../components/ActionButtons";
import TabNavigation from "../components/TabNavigation";
import TokenItem from "../components/TokenItem";
import TransactionHistoryPanel, {
  type HistoryActivity,
} from "../components/TransactionHistoryPanel";
import { useNavigate } from "react-router-dom";
import useWallet from "../hooks/useWallet";
import { fetchBalanceAndPin } from "../utils/warthogNode";
import { fetchWartUsdPrice } from "../utils/wartPrice";
import { isDefiNode } from "../utils/nodes";

interface Props {
  setSelectedActivity: (activity: HistoryActivity) => void;
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
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const nodeUrl =
    selectedNodeUrl ||
    (nodeList.length > 0 ? nodeList[selectedNodeIndex] : null);

  const isTestnet = nodeUrl ? isDefiNode(nodeUrl) : false;

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
  }, []);

  const handleActivityClick = (activityItem: HistoryActivity) => {
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
      setBalanceUSD(price && price > 0 ? price : 0);
    } catch (error) {
      console.error("Error fetching price:", error);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([updateBalance(), updatePrice()]);
      if (activeTab === Tab.Activity) {
        setHistoryRefreshKey((k) => k + 1);
      }
    } finally {
      setRefreshing(false);
    }
  }, [updateBalance, updatePrice, activeTab]);

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
        <TransactionHistoryPanel
          wallet={wallet}
          nodeUrl={nodeUrl}
          active={activeTab === Tab.Activity}
          onActivityClick={handleActivityClick}
          refreshKey={historyRefreshKey}
        />
      )}
    </div>
  );
};

export default Home;
