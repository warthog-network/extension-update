import React, { useState } from "react";
import BackButton from "../components/BackButton";
import Button from "../components/Button";
import { useNavigate } from "react-router-dom";
import useWallet from "../hooks/useWallet";
import type { PathType, WordCount } from "../utils/walletKeys";

const Info: React.FC = () => {
  const { newWallet } = useWallet();
  const navigate = useNavigate();
  const [wordCount, setWordCount] = useState<WordCount>(12);
  const [pathType, setPathType] = useState<PathType>("hardened");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateWallet = async () => {
    setBusy(true);
    setError(null);
    try {
      await newWallet(wordCount, pathType);
      navigate("/recover");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create wallet");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container min-h-screen py-5 relative">
      <BackButton />
      <div className="flex flex-col mt-5 gap-4">
        <h3 className="text-xl text-center font-semibold text-white">
          Create a new wallet
        </h3>
        <p className="text-sm font-medium text-center text-white/80">
          A recovery phrase is a series of words unique to your wallet. Write it
          down and store it safely — never share it.
        </p>

        <div>
          <label className="text-white text-sm">Word count</label>
          <select
            value={wordCount}
            onChange={(e) => setWordCount(Number(e.target.value) as WordCount)}
            className="w-full bg-primary/10 text-white border border-primary/50 rounded-lg px-4 py-2 mt-1 focus:outline-none focus:border-primary"
          >
            <option value={12}>12 words</option>
            <option value={24}>24 words</option>
          </select>
        </div>

        <div>
          <label className="text-white text-sm">Derivation path</label>
          <select
            value={pathType}
            onChange={(e) => setPathType(e.target.value as PathType)}
            className="w-full bg-primary/10 text-white border border-primary/50 rounded-lg px-4 py-2 mt-1 focus:outline-none focus:border-primary"
          >
            <option value="hardened">Hardened (m/44&apos;/2070&apos;/0&apos;/0/0)</option>
            <option value="non-hardened">
              Non-hardened (m/44&apos;/2070&apos;/0/0/0)
            </option>
          </select>
          <p className="text-white/40 text-xs mt-1">
            Match the path you use on the website webwallet so addresses align.
          </p>
        </div>

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
      </div>
      <div className="absolute bottom-5 left-0 px-6 w-full">
        <Button
          onClick={generateWallet}
          variant="primary"
          ariaLabel="Continue"
          className="w-full"
          disabled={busy}
        >
          {busy ? "Creating…" : "Continue"}
        </Button>
      </div>
    </div>
  );
};

export default Info;
