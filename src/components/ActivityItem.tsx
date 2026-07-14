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
  fee?: string;
  source?: "indexer" | "node";
  assetName?: string | null;
  assetHash?: string | null;
  amountSecondary?: string | null;
  side?: string;
  orderAmount?: string;
  limitPrice?: string;
  baseAmount?: string;
  quoteAmount?: string;
  swapCount?: number;
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

const abbreviateTxid = (str?: string | null) => {
  if (!str) return "N/A";
  if (str.length <= 14) return str;
  return `${str.slice(0, 6)}…${str.slice(-6)}`;
};

const copy = (text: string) => {
  if (!text) return;
  navigator.clipboard.writeText(text).catch(() => undefined);
};

function typeBadge(type?: string, isReward?: boolean): {
  label: string;
  bg: string;
  color: string;
} {
  const t = String(type || "").toLowerCase();
  if (isReward || t === "reward") {
    return { label: "REWARD", bg: "#166534", color: "#86efac" };
  }
  if (t === "wart_transfer" || t === "transfer") {
    return { label: "TRANSFER", bg: "#1e3a8a", color: "#93c5fd" };
  }
  if (t === "token_transfer") {
    return { label: "TOKEN", bg: "#312e81", color: "#a5b4fc" };
  }
  if (t === "limit_swap") {
    return { label: "LIMIT SWAP", bg: "#581c87", color: "#d8b4fe" };
  }
  if (t.includes("liquidity")) {
    return { label: t.replace(/_/g, " ").toUpperCase(), bg: "#134e4b", color: "#5eead4" };
  }
  if (t === "asset_creation") {
    return { label: "CREATE ASSET", bg: "#854d0e", color: "#fde047" };
  }
  if (t === "match") {
    return { label: "MATCH", bg: "#701a75", color: "#f0abfc" };
  }
  if (t === "cancelation" || t.includes("cancel")) {
    return { label: "CANCEL", bg: "#7f1d1d", color: "#fca5a5" };
  }
  const label = (type || "TX").replace(/_/g, " ").toUpperCase();
  return { label, bg: "#3f3f46", color: "#e4e4e7" };
}

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

        const badge = typeBadge(item.type, item.isReward);
        const amountUnit = item.asset || "WART";
        const unitIsBaseTicker = Boolean(
          item.assetHash && item.assetName && amountUnit === item.assetName,
        );
        const showSeparateAsset = Boolean(
          item.assetHash && item.assetName && amountUnit !== item.assetName,
        );
        const displayAmount = item.amountRaw ?? item.amount;
        const hideTo = item.type === "limit_swap";

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
            <div className="tx-card-head">
              <span
                className="tx-type-badge"
                style={{ background: badge.bg, color: badge.color }}
              >
                {badge.label}
              </span>
              <button
                type="button"
                className="tx-value tx-link"
                title={item.txHash || "N/A"}
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.txHash) copy(item.txHash);
                }}
              >
                {abbreviateTxid(item.txHash)}
              </button>
            </div>

            {item.description ? (
              <div className="tx-desc-block">{item.description}</div>
            ) : null}

            {(item.fromAddress || item.isReward) && (
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
                    ? "System / Reward"
                    : abbreviate(item.fromAddress)}
                </button>
              </div>
            )}

            {item.toAddress && !hideTo ? (
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
            ) : null}

            <div className="tx-row">
              <span className="tx-label">Amount</span>
              <span className="tx-value" style={{ color: amountColor }}>
                {displayAmount}{" "}
                {unitIsBaseTicker ? (
                  <button
                    type="button"
                    className="tx-asset-chip"
                    title={item.assetHash ? `Copy asset id: ${item.assetHash}` : undefined}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (item.assetHash) copy(item.assetHash);
                    }}
                  >
                    {amountUnit}
                  </button>
                ) : (
                  <span className="tx-muted">{amountUnit}</span>
                )}
                {item.amountSecondary ? (
                  <span className="tx-muted"> · {item.amountSecondary}</span>
                ) : null}
              </span>
            </div>

            {showSeparateAsset && item.assetName ? (
              <div className="tx-row">
                <span className="tx-label">Asset</span>
                <button
                  type="button"
                  className="tx-value tx-link"
                  title={item.assetHash || item.assetName}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.assetHash) copy(item.assetHash);
                  }}
                >
                  {item.assetName}
                </button>
              </div>
            ) : null}

            {item.fee && item.fee !== "0" && item.fee !== "0.00000000" && !item.isReward ? (
              <div className="tx-row">
                <span className="tx-label">Fee</span>
                <span className="tx-value tx-muted">{item.fee} WART</span>
              </div>
            ) : null}

            <div className="tx-row">
              <span className="tx-label">Direction</span>
              <span className="tx-value" style={{ color: amountColor }}>
                {dirLabel}
              </span>
            </div>

            <div className="tx-card-foot">
              <span>Conf: {item.confirmations ?? "—"}</span>
              <span>H: {item.height ?? "—"}</span>
              <span className="tx-muted">
                {item.confirmations === 0
                  ? "Pending"
                  : item.date || "N/A"}
              </span>
            </div>

            {item.usdAmount && item.usdAmount !== "N/A" && item.usdAmount !== "" ? (
              <div className="tx-row">
                <span className="tx-label">USD</span>
                <span className="tx-value tx-muted">{item.usdAmount}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default ActivityItem;
