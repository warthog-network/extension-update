import { useEffect, useState } from "react";
import Header from "../components/Header";
import Button from "../components/Button";
import { useNavigate } from "react-router-dom";
import { AiOutlineSwap } from "react-icons/ai";
import UserDropdown from "../components/UserDropdown";
import NetworkDropdown from "../components/NetworkDropdown";
import useWallet from "../hooks/useWallet";
import { formatWalletAddress } from "../utils";
import Jazzicon from "react-jazzicon/dist/Jazzicon";
import {
  computeSuggestedTxFee,
  fetchBalanceAndPin,
  sendWartTransfer,
} from "../utils/warthogNode";
import { DEFAULT_TX_FEE } from "../config/network";
import { isDefiNode } from "../utils/nodes";
import {
  amountExceedsAvailable,
  insufficientFreeBalanceMessage,
  mapInsufficientBalanceError,
} from "../utils/balanceBreakdown";
import SpendableBalanceDisplay from "../components/SpendableBalanceDisplay";

interface AccountType {
  id: number;
  name: string;
  address: string;
  balance: number;
  balanceUSD: number;
  visible: boolean;
}

interface Network {
  id: string;
  name: string;
  logo: string;
}

const networks: Network[] = [{ id: "1", name: "WART", logo: "logo.png" }];

function SendFinalStep() {
  const {
    password,
    selectedWalletIndex,
    selectedNodeIndex,
    nameList,
    walletList,
    nodeList,
    selectedNodeUrl,
    selectedNetworkLabel,
    tmpDestinationWallet,
    visibleWalletList,
    setSelectedWalletIndex,
    setName,
    setWallet,
    getAccountFromIndex,
  } = useWallet();
  const navigate = useNavigate();

  const nodeUrl =
    selectedNodeUrl ||
    (nodeList.length > 0 ? nodeList[selectedNodeIndex] : "");

  const [accounts, setAccounts] = useState<AccountType[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState<Network | null>(
    networks[0],
  );
  const [isSwapped, setSwapped] = useState(false);
  const [amount, setAmount] = useState<number>(0);
  const [fee, setFee] = useState<string>(DEFAULT_TX_FEE);
  const [balance, setBalance] = useState<string>("0");
  const [balanceAvailable, setBalanceAvailable] = useState<string>("0");
  const [balanceLocked, setBalanceLocked] = useState<string>("0");
  const [nonce, setNonce] = useState<number>(0);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<
    "idle" | "processing" | "success" | "error"
  >("idle");
  const [transactionHash, setTransactionHash] = useState<string>("");
  const [transactionError, setTransactionError] = useState<string>("");

  const selectUser = (id: number) => {
    setName(nameList[id]);
    setWallet(walletList[id]);
    setSelectedWalletIndex(id);
  };

  const handleSwap = () => {
    setSwapped((prev) => !prev);
  };

  useEffect(() => {
    const addr = walletList[selectedWalletIndex];
    if (!addr || !nodeUrl) return;
    fetchBalanceAndPin(nodeUrl, addr)
      .then((r) => {
        setBalance(r.balance);
        setBalanceAvailable(r.available);
        setBalanceLocked(r.locked);
        setNonce(r.nextNonce);
      })
      .catch((err) => console.warn("Balance preload failed:", err));

    computeSuggestedTxFee(nodeUrl)
      .then(setFee)
      .catch(() => setFee(DEFAULT_TX_FEE));
  }, [walletList, selectedWalletIndex, nodeUrl]);

  const handleTransaction = async () => {
    if (confirmPassword !== password) {
      setPasswordError("Incorrect password. Please try again.");
      return;
    }
    if (!tmpDestinationWallet) {
      setTransactionError("Missing destination address");
      setTransactionStatus("error");
      return;
    }
    if (!amount || amount <= 0) {
      setTransactionError("Enter a valid amount");
      setTransactionStatus("error");
      return;
    }
    if (!nodeUrl) {
      setTransactionError("No node selected");
      setTransactionStatus("error");
      return;
    }

    setIsProcessing(true);
    setTransactionStatus("processing");
    setTransactionError("");

    try {
      // Live re-fetch free balance at submit (stale overview can lie)
      const addr = walletList[selectedWalletIndex];
      let free = balanceAvailable;
      let locked = balanceLocked;
      if (addr) {
        try {
          const live = await fetchBalanceAndPin(nodeUrl, addr);
          free = live.available;
          locked = live.locked;
          setBalance(live.balance);
          setBalanceAvailable(live.available);
          setBalanceLocked(live.locked);
          setNonce(live.nextNonce);
        } catch {
          /* use cached */
        }
      }

      // amount + fee must fit in free balance
      const feeN = parseFloat(fee) || 0;
      const need = amount + feeN;
      if (amountExceedsAvailable(need, free)) {
        const msg = insufficientFreeBalanceMessage({
          available: free,
          locked,
          unit: "WART",
        });
        setTransactionError(msg);
        setTransactionStatus("error");
        const cap = Math.max(0, (parseFloat(free) || 0) - feeN);
        setAmount(cap);
        return;
      }

      const account = getAccountFromIndex(selectedWalletIndex);
      const result = await sendWartTransfer({
        nodeBase: nodeUrl,
        privateKeyHex: account.getPrivateKeyHex(),
        toAddress: tmpDestinationWallet,
        amountWart: String(amount),
        feeWart: fee,
        nonceId: nonce,
      });

      setTransactionHash(result.txHash);
      setTransactionStatus("success");
      setNonce(result.nonceId + 1);
    } catch (error) {
      setTransactionStatus("error");
      setTransactionError(
        mapInsufficientBalanceError(error, {
          available: balanceAvailable,
          locked: balanceLocked,
          unit: "WART",
        }),
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMax = () => {
    const free = parseFloat(balanceAvailable) || 0;
    const feeN = parseFloat(fee) || 0;
    setAmount(Math.max(0, free - feeN));
  };

  useEffect(() => {
    if (nameList.length !== walletList.length) {
      console.log(
        `**** unmatched error in nameList and walletList:`,
        nameList.length,
        walletList.length,
      );
    } else {
      setAccounts(
        nameList.map((name, index) => ({
          id: index,
          name,
          address: walletList[index],
          balance: 0,
          balanceUSD: 0,
          visible: visibleWalletList[index],
        })),
      );
    }
  }, [walletList, nameList, visibleWalletList]);

  const explorerBase = isDefiNode(nodeUrl)
    ? null
    : "https://wartscan.io/tx/";

  return (
    <div className="min-h-screen container relative">
      <Header title="Send" />
      <p className="text-xs text-white/50 mt-1 px-1">
        Network: <span className="text-primary">{selectedNetworkLabel}</span>
      </p>
      <div className="mt-2 px-1">
        <SpendableBalanceDisplay
          layout="stack"
          label="Available"
          available={balanceAvailable}
          locked={balanceLocked}
          total={balance}
          unit="WART"
        />
        <button
          type="button"
          className="text-xs text-primary underline mt-1"
          onClick={handleMax}
        >
          Use max available
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-white text-sm">From</p>
        <UserDropdown
          users={accounts}
          selectedUser={accounts[selectedWalletIndex]}
          onSelectUser={selectUser}
        />
        <NetworkDropdown
          networks={networks}
          selectedNetwork={selectedNetwork}
          onSelectNetwork={setSelectedNetwork}
          handleSwap={handleSwap}
          isSwapped={isSwapped}
          amount={amount}
          setAmount={setAmount}
        />

        <p className="text-white text-sm mt-3">Fee (WART)</p>
        <input
          type="text"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          className="w-full bg-[#2A2A2A] border border-primary/25 rounded-lg p-3 text-white focus:outline-none focus:border-primary"
          placeholder={DEFAULT_TX_FEE}
        />

        <p className="text-white text-sm mt-3">To</p>
        <div className="flex items-center gap-3 p-4 rounded-lg border border-primary/25 backdrop-blur-md">
          {<Jazzicon diameter={48} seed={1000} />}
          <div>
            <p className="text-white text-lg font-semibold">Receiver</p>
            <p className="text-white/50 text-xs">
              {formatWalletAddress(tmpDestinationWallet || "")}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 p-4 rounded-lg border border-primary/25 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <img
              className="w-12 h-12 rounded-full"
              src={selectedNetwork?.logo}
              alt="logo"
            />
            <div>
              <p className="text-white text-lg font-semibold">
                {selectedNetwork?.name}
              </p>
            </div>
          </div>
          <div className="flex gap-3 items-center">
            <div className="text-right">
              {isSwapped ? (
                <>
                  <p className="text-white text-lg">${amount}</p>
                  <p className="text-white/50 text-sm">
                    {amount} {selectedNetwork?.name}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-white text-lg">
                    {amount} {selectedNetwork?.name}
                  </p>
                  <p className="text-white/50 text-sm">fee {fee} WART</p>
                </>
              )}
            </div>
            <AiOutlineSwap
              className="text-white rotate-90 text-2xl"
              onClick={handleSwap}
            />
          </div>
        </div>
      </div>

      <div className="flex bottom-3 absolute left-0 px-3 w-full gap-3">
        <Button
          variant="outline"
          ariaLabel="Backup"
          className="w-full mt-5 hover:bg-primary/10"
          onClick={() => navigate("/home")}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          ariaLabel="Continue"
          className="w-full mt-5"
          onClick={() => setShowConfirmation(true)}
        >
          Continue
        </Button>
      </div>

      {showConfirmation && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 backdrop-blur-sm z-50">
          <div className="bg-[#1A1A1A] rounded-lg p-6 max-w-md w-full border border-primary/25">
            {transactionStatus === "idle" && (
              <>
                <h3 className="text-white text-xl font-semibold mb-4">
                  Confirm Transaction
                </h3>
                <div className="space-y-4 mb-6">
                  <div className="bg-[#2A2A2A] p-4 rounded-lg">
                    <p className="text-white/70 text-sm">Sending</p>
                    <p className="text-white text-lg font-semibold">
                      {amount} {selectedNetwork?.name}
                    </p>
                    <p className="text-white/50 text-sm">Fee: {fee} WART</p>
                    <p className="text-white/50 text-sm">
                      Network: {selectedNetworkLabel}
                    </p>
                  </div>

                  <div className="bg-[#2A2A2A] p-4 rounded-lg">
                    <p className="text-white/70 text-sm">To</p>
                    <p className="text-white text-lg font-semibold">Receiver</p>
                    <p className="text-white/50 text-sm break-all">
                      {tmpDestinationWallet}
                    </p>
                  </div>

                  <div>
                    <label
                      htmlFor="password"
                      className="block text-white/70 text-sm mb-2"
                    >
                      Enter your password to confirm
                    </label>
                    <input
                      type="password"
                      id="password"
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setPasswordError("");
                      }}
                      className="w-full bg-[#2A2A2A] border border-primary/25 rounded-lg p-3 text-white focus:outline-none focus:border-primary"
                      placeholder="Enter your password"
                    />
                    {passwordError && (
                      <p className="text-red-500 text-sm mt-2">
                        {passwordError}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setShowConfirmation(false);
                      setConfirmPassword("");
                      setPasswordError("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={handleTransaction}
                    disabled={isProcessing}
                  >
                    {isProcessing ? "Processing..." : "Confirm"}
                  </Button>
                </div>
              </>
            )}

            {transactionStatus === "processing" && (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4"></div>
                <h3 className="text-white text-xl font-semibold mb-2">
                  Processing Transaction
                </h3>
                <p className="text-white/70">
                  Please wait while we process your transaction...
                </p>
              </div>
            )}

            {transactionStatus === "success" && (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg
                    className="w-8 h-8 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
                <h3 className="text-white text-xl font-semibold mb-2">
                  Transaction Successful!
                </h3>
                <p className="text-white/70 mb-4">
                  Your transaction has been submitted.
                </p>
                {transactionHash && (
                  <p className="text-sm text-white/50 break-all mb-6">
                    Transaction Hash:{" "}
                    {explorerBase ? (
                      <a
                        href={`${explorerBase}${transactionHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {transactionHash}
                      </a>
                    ) : (
                      transactionHash
                    )}
                  </p>
                )}
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => {
                    setShowConfirmation(false);
                    setTransactionStatus("idle");
                    navigate("/home");
                  }}
                >
                  Done
                </Button>
              </div>
            )}

            {transactionStatus === "error" && (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg
                    className="w-8 h-8 text-red-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
                <h3 className="text-white text-xl font-semibold mb-2">
                  Transaction Failed
                </h3>
                <p className="text-red-500 mb-6 break-words">
                  {transactionError}
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setShowConfirmation(false);
                      setTransactionStatus("idle");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => {
                      setTransactionStatus("idle");
                      setTransactionError("");
                    }}
                  >
                    Try Again
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SendFinalStep;
