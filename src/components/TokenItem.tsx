import React from "react";
import SpendableBalanceDisplay from "./SpendableBalanceDisplay";

interface TokenItemProps {
  token: string;
  balance: number | string;
  available?: number | string | null;
  locked?: number | string | null;
  total?: number | string | null;
  usdValue: number;
}

const TokenItem: React.FC<TokenItemProps> = ({
  token,
  balance,
  available,
  locked,
  total,
  usdValue,
}) => {
  const free = available ?? balance;
  const totalVal = total ?? balance;
  const usdBase = Number(totalVal);
  const usd =
    Number.isFinite(usdBase) && Number.isFinite(usdValue) && usdValue > 0
      ? `$${(usdBase * usdValue).toFixed(2)}`
      : "N/A";

  return (
    <div className="flex justify-between items-center gap-3 my-5 w-full">
      <div className="flex items-center gap-3 min-w-0">
        <img className="w-10 h-10 shrink-0" src="logo.png" alt={`${token} logo`} />
        <div className="min-w-0">
          <h5 className="text-white text-xl font-medium">{token}</h5>
          <SpendableBalanceDisplay
            layout="row"
            available={free}
            locked={locked}
            total={totalVal}
            className="!text-left"
          />
        </div>
      </div>
      <div className="shrink-0">
        <h5 className="text-right text-white text-xl font-medium">USD</h5>
        <p className="text-right text-white/50 text-lg font-normal">{usd}</p>
      </div>
    </div>
  );
};

export default TokenItem;
