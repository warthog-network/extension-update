import React from "react";

interface TokenItemProps {
  token: string;
  balance: number;
  usdValue: number;
}

const TokenItem: React.FC<TokenItemProps> = ({ token, balance, usdValue }) => {
  const bal = Number.isFinite(balance)
    ? balance.toLocaleString(undefined, { maximumFractionDigits: 8 })
    : "0";
  const usd =
    Number.isFinite(balance) && Number.isFinite(usdValue) && usdValue > 0
      ? `$${(balance * usdValue).toFixed(2)}`
      : "N/A";

  return (
    <div className="flex justify-between items-center gap-3 my-5 w-full">
      <div className="flex items-center gap-3">
        <img className="w-10 h-10" src="logo.png" alt={`${token} logo`} />
        <div>
          <h5 className="text-white text-xl font-medium">{token}</h5>
          <p className="text-white/50 text-lg font-normal">{bal}</p>
        </div>
      </div>
      <div>
        <h5 className="text-right text-white text-xl font-medium">USD</h5>
        <p className="text-right text-white/50 text-lg font-normal">{usd}</p>
      </div>
    </div>
  );
};

export default TokenItem;
