import React from "react";

export type ActivityRow = {
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
};

interface ActivityItemProps {
  activities: ActivityRow[];
  onActivityClick: (activity: ActivityRow) => void;
  walletAddress?: string | null;
}

const abbreviate = (str?: string | null) => {
  if (!str) return "N/A";
  if (str.length <= 12) return str;
  return `${str.slice(0, 6)}…${str.slice(-4)}`;
};

const copy = (text: string) => {
  if (!text) return;
  navigator.clipboard.writeText(text).catch(() => undefined);
};

const ActivityItem: React.FC<ActivityItemProps> = ({
  activities,
  onActivityClick,
  walletAddress,
}) => {
  const account = (walletAddress || "").toLowerCase();

  return (
    <div className="tx-history-list">
      {activities.map((item, index) => {
        const incoming =
          item.isIncoming != null
            ? item.isIncoming
            : item.direction === "in" || Boolean(item.isReward);
        const outgoing =
          item.direction === "out" ||
          Boolean(
            !incoming &&
              item.fromAddress &&
              account &&
              item.fromAddress.toLowerCase() === account,
          );
        const amountColor = incoming
          ? "var(--defi-buy, #34d399)"
          : outgoing
            ? "var(--defi-sell, #fb7185)"
            : "rgba(255,255,255,0.9)";
        const dirLabel = item.isReward
          ? "Reward"
          : incoming
            ? "Received"
            : outgoing
              ? "Sent"
              : "Activity";

        return (
          <div
            key={`${item.txHash || index}-${item.height || 0}-${index}`}
            className="tx-card"
            onClick={() => onActivityClick(item)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onActivityClick(item);
            }}
          >
            <div className="tx-row">
              <span className="tx-label">TxID</span>
              <button
                type="button"
                className="tx-value tx-link"
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.txHash) copy(item.txHash);
                }}
              >
                {abbreviate(item.txHash)}
              </button>
            </div>

            <div className="tx-row">
              <span className="tx-label">From</span>
              <button
                type="button"
                className="tx-value tx-link"
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.fromAddress) copy(item.fromAddress);
                }}
              >
                {item.isReward || !item.fromAddress
                  ? "Block Reward"
                  : abbreviate(item.fromAddress)}
              </button>
            </div>

            <div className="tx-row">
              <span className="tx-label">To</span>
              <button
                type="button"
                className="tx-value tx-link"
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.toAddress) copy(item.toAddress);
                }}
              >
                {abbreviate(item.toAddress)}
              </button>
            </div>

            <div className="tx-row">
              <span className="tx-label">Type</span>
              <span className="tx-value">
                {(item.type || item.action || "tx")
                  .replace(/_/g, " ")
                  .toUpperCase()}
              </span>
            </div>

            {item.description ? (
              <div className="tx-row">
                <span className="tx-label">Details</span>
                <span className="tx-value tx-desc">{item.description}</span>
              </div>
            ) : null}

            <div className="tx-row">
              <span className="tx-label">Direction</span>
              <span className="tx-value" style={{ color: amountColor }}>
                {dirLabel}
              </span>
            </div>

            <div className="tx-row">
              <span className="tx-label">Amount</span>
              <span className="tx-value" style={{ color: amountColor }}>
                {item.amountRaw ?? item.amount} {item.asset || "WART"}
              </span>
            </div>

            {item.height != null && (
              <div className="tx-row">
                <span className="tx-label">Height</span>
                <span className="tx-value">{item.height}</span>
              </div>
            )}

            {item.confirmations != null && (
              <div className="tx-row">
                <span className="tx-label">Confirmations</span>
                <span className="tx-value">{item.confirmations}</span>
              </div>
            )}

            <div className="tx-row">
              <span className="tx-label">Date</span>
              <span className="tx-value">
                {item.confirmations === 0
                  ? "Pending"
                  : item.date || "N/A"}
              </span>
            </div>

            {item.usdAmount && item.usdAmount !== "N/A" && (
              <div className="tx-row">
                <span className="tx-label">USD</span>
                <span className="tx-value tx-muted">{item.usdAmount}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ActivityItem;
