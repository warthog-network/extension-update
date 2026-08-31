import React from "react";
import {
  formatDisplayNumber,
  getColorHex,
  loadNumberDisplayPrefs,
} from "../utils/numberDisplay";
import { hasPositiveLocked } from "../utils/balanceBreakdown";

export type SpendableBalanceLayout = "stack" | "inline" | "row" | "hero";

interface Props {
  /** Free to spend (total − locked − mempool) */
  available?: string | number | null;
  /** Locked in open orders / pending */
  locked?: string | number | null;
  /** Full on-chain total */
  total?: string | number | null;
  unit?: string;
  label?: string;
  layout?: SpendableBalanceLayout;
  showLabel?: boolean;
  className?: string;
  primaryClassName?: string;
  unitClassName?: string;
  /** Optional primary color override (e.g. user number-display prefs) */
  primaryColor?: string;
  /** When true, USD line for hero uses total holdings (available + locked) */
  usdValue?: number | null;
  isTestnet?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  networkLabel?: string;
  nodeLabel?: string;
}

function fmt(value: unknown): string {
  if (value == null || value === "") return "0";
  const prefs = loadNumberDisplayPrefs();
  return formatDisplayNumber(value, prefs);
}

/**
 * Consistent Available / Locked / Total presentation for WART and assets.
 * Primary number is free (available) when anything is locked; otherwise total.
 */
const SpendableBalanceDisplay: React.FC<Props> = ({
  available,
  locked,
  total,
  unit = "",
  label = "Available",
  layout = "stack",
  showLabel = true,
  className = "",
  primaryClassName = "",
  unitClassName = "",
  primaryColor,
  usdValue,
  isTestnet,
  refreshing = false,
  onRefresh,
  networkLabel,
  nodeLabel,
}) => {
  const free = available ?? total ?? "0";
  const showLocked = hasPositiveLocked(locked);
  const totalVal = total ?? free;
  const prefs = loadNumberDisplayPrefs();
  const balanceColor = primaryColor ?? getColorHex(prefs.balanceColor);

  const unitEl = unit ? (
    <span className={unitClassName || "text-[#FDB913] font-semibold"}>{unit}</span>
  ) : null;

  if (layout === "hero") {
    const usd =
      Number.isFinite(Number(totalVal)) &&
      Number.isFinite(usdValue) &&
      (usdValue ?? 0) > 0
        ? formatDisplayNumber(Number(totalVal) * (usdValue as number), {
            ...prefs,
            maxDecimals: 2,
            notation: "standard",
          })
        : isTestnet
          ? "Testnet"
          : "—";

    return (
      <div className={`main-balance-hero ${className}`.trim()}>
        <div className="main-balance-top">
          {showLabel ? (
            <span className="main-balance-label">
              {showLocked
                ? "Available Balance"
                : label === "Available"
                  ? "Total Balance"
                  : label}
            </span>
          ) : (
            <span />
          )}
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
          <span
            className={`main-balance-value ${primaryClassName}`.trim()}
            style={{ color: balanceColor }}
          >
            {fmt(free)}
          </span>
          {unit ? <span className="main-balance-unit">{unit}</span> : unitEl}
        </div>
        {showLocked ? (
          <div className="main-balance-meta">
            <span>
              Total{" "}
              <span className="main-balance-meta-total">{fmt(totalVal)}</span>
            </span>
            <span className="main-balance-meta-locked">
              Locked{" "}
              <span className="main-balance-meta-locked-val">{fmt(locked)}</span>
              <span className="main-balance-meta-hint"> (open orders)</span>
            </span>
          </div>
        ) : null}
        {usdValue !== undefined || isTestnet ? (
          <div className={`main-balance-usd${refreshing ? " opacity-60" : ""}`}>
            ≈ {usd === "Testnet" || usd === "—" ? usd : `${usd} USD`}
          </div>
        ) : null}
        {(networkLabel || nodeLabel) && (
          <div className="main-balance-node">
            {[nodeLabel, networkLabel].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
    );
  }

  if (layout === "row") {
    const alignEnd = !/\btext-left\b/.test(className);
    return (
      <div
        className={`${alignEnd ? "text-right" : "text-left"} font-mono text-sm tabular-nums min-w-0 max-w-full ${className}`.trim()}
      >
        <div
          className={`flex items-baseline gap-1 min-w-0 ${
            alignEnd ? "justify-end" : "justify-start"
          }`}
        >
          <span
            className={`text-white break-all ${primaryClassName}`.trim()}
            style={primaryColor ? { color: primaryColor } : undefined}
          >
            {fmt(free)}
          </span>
          {unit ? (
            <span
              className={`text-[10px] text-zinc-400 font-sans shrink-0 ${unitClassName}`.trim()}
            >
              {unit}
            </span>
          ) : null}
        </div>
        {showLocked ? (
          <div
            className={`mt-0.5 flex flex-col gap-0.5 text-[10px] text-zinc-500 font-sans leading-tight ${
              alignEnd ? "items-end" : "items-start"
            }`}
          >
            <span>
              Total <span className="text-zinc-400 break-all">{fmt(totalVal)}</span>
            </span>
            <span className="text-amber-400/90">
              Locked <span className="text-amber-300">{fmt(locked)}</span>
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  if (layout === "inline") {
    return (
      <span className={`tabular-nums ${className}`.trim()}>
        <span className={primaryClassName}>{fmt(free)}</span>
        {unit ? <> {unitEl ?? unit}</> : null}
        {showLocked ? (
          <span className="text-zinc-500 text-[11px] ml-2">
            (locked{" "}
            <span className="text-amber-300 font-mono">{fmt(locked)}</span>
            {total != null ? (
              <>
                {" · "}total{" "}
                <span className="text-zinc-400 font-mono">{fmt(totalVal)}</span>
              </>
            ) : null}
            )
          </span>
        ) : null}
      </span>
    );
  }

  // stack — form cards (Send, limit order)
  return (
    <div className={`text-xs space-y-1 ${className}`.trim()}>
      <div className="flex items-center justify-between gap-2">
        {showLabel ? (
          <span className="text-zinc-500">{label}</span>
        ) : (
          <span />
        )}
        <span
          className={`font-mono text-white tabular-nums ${primaryClassName}`.trim()}
          style={primaryColor ? { color: primaryColor } : undefined}
        >
          {fmt(free)}
          {unit ? (
            <>
              {" "}
              <span className={unitClassName || "text-[#FDB913]"}>{unit}</span>
            </>
          ) : null}
        </span>
      </div>
      {showLocked ? (
        <div className="flex flex-col items-end gap-0.5 text-[11px] text-zinc-500">
          <span>
            Total{" "}
            <span className="text-zinc-400 font-mono break-all">
              {fmt(totalVal)}
            </span>
          </span>
          <span>
            Locked{" "}
            <span className="text-amber-300 font-mono">{fmt(locked)}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
};

export default SpendableBalanceDisplay;
