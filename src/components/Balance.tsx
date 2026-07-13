import React from "react";
import {
  formatDisplayNumber,
  getColorHex,
  loadNumberDisplayPrefs,
} from "../utils/numberDisplay";

interface BalanceProps {
  balance: number;
  usdValue: number;
  isTestnet?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  networkLabel?: string;
  nodeLabel?: string;
}

const Balance: React.FC<BalanceProps> = ({
  balance,
  usdValue,
  isTestnet,
  refreshing = false,
  onRefresh,
  networkLabel,
  nodeLabel,
}) => {
  const prefs = loadNumberDisplayPrefs();
  const display = Number.isFinite(balance)
    ? formatDisplayNumber(balance, prefs)
    : "0";

  const usd =
    Number.isFinite(balance) && Number.isFinite(usdValue) && usdValue > 0
      ? formatDisplayNumber(balance * usdValue, {
          ...prefs,
          maxDecimals: 2,
          notation: "standard",
        })
      : isTestnet
        ? "Testnet"
        : "—";

  const balanceColor = getColorHex(prefs.balanceColor);

  return (
    <div className="main-balance-hero">
      <div className="main-balance-top">
        <span className="main-balance-label">Total Balance</span>
        {onRefresh ? (
          <button
            type="button"
            className="main-balance-refresh"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <span className={refreshing ? "animate-spin inline-block" : ""}>
              ⟳
            </span>{" "}
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>
      <div className={`main-balance-row${refreshing ? " opacity-60" : ""}`}>
        <span className="main-balance-value" style={{ color: balanceColor }}>
          {display}
        </span>
        <span className="main-balance-unit">WART</span>
      </div>
      <div className={`main-balance-usd${refreshing ? " opacity-60" : ""}`}>
        ≈ {usd === "Testnet" || usd === "—" ? usd : `${usd} USD`}
      </div>
      {(networkLabel || nodeLabel) && (
        <div className="main-balance-node">
          {[nodeLabel, networkLabel].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
};

export default Balance;
