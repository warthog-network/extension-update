import React from "react";
import SpendableBalanceDisplay from "./SpendableBalanceDisplay";

interface BalanceProps {
  /** Free / available balance (preferred primary). Falls back to total if omitted. */
  balance: number | string;
  available?: number | string | null;
  locked?: number | string | null;
  total?: number | string | null;
  usdValue: number;
  isTestnet?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  networkLabel?: string;
  nodeLabel?: string;
}

const Balance: React.FC<BalanceProps> = ({
  balance,
  available,
  locked,
  total,
  usdValue,
  isTestnet,
  refreshing = false,
  onRefresh,
  networkLabel,
  nodeLabel,
}) => {
  const free = available ?? balance;
  const totalVal = total ?? balance;

  return (
    <SpendableBalanceDisplay
      layout="hero"
      available={free}
      locked={locked}
      total={totalVal}
      unit="WART"
      usdValue={usdValue}
      isTestnet={isTestnet}
      refreshing={refreshing}
      onRefresh={onRefresh}
      networkLabel={networkLabel}
      nodeLabel={nodeLabel}
    />
  );
};

export default Balance;
