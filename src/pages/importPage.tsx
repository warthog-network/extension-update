import { useState, useCallback } from "react";
import BackButton from "../components/BackButton";
import Button from "../components/Button";
import { useNavigate } from "react-router-dom";
import useWallet from "../hooks/useWallet";
import type { PathType, WordCount } from "../utils/walletKeys";

function ImportPage() {
  const { importWallet } = useWallet();
  const navigate = useNavigate();
  const [wordCount, setWordCount] = useState<WordCount>(12);
  const [pathType, setPathType] = useState<PathType>("hardened");
  const [mnemonicText, setMnemonicText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const words = mnemonicText.trim().split(/\s+/).filter(Boolean);
  const isCompleted = words.length === wordCount;

  const handleWordCountChange = (wc: WordCount) => {
    setWordCount(wc);
    setError(null);
  };

  const recoverWallet = useCallback(async () => {
    setIsProcessing(true);
    setError(null);
    try {
      if (words.length !== wordCount) {
        throw new Error(`Seed phrase must have exactly ${wordCount} words`);
      }
      importWallet(words.join(" "), pathType, wordCount);
      navigate("/set-password");
    } catch (e) {
      console.log("Failed to recover wallet:", e);
      setError(
        e instanceof Error
          ? e.message
          : "Invalid recovery phrase. Please try again.",
      );
    } finally {
      setIsProcessing(false);
    }
  }, [words, wordCount, pathType, importWallet, navigate]);

  return (
    <section className="container min-h-screen py-5 relative overflow-y-auto pb-28">
      <BackButton />
      <div className="flex flex-col justify-center items-center gap-3 mt-3">
        <h1 className="text-center text-white text-xl font-semibold leading-[30px]">
          Derive from seed phrase
        </h1>
        <p className="text-white/50 text-xs text-center px-2">
          Same as the website &quot;Derive Wallet from Seed Phrase&quot; option
        </p>
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
      </div>

      <div className="mt-4 grid gap-3">
        <div>
          <label className="text-white text-sm">Word count</label>
          <select
            value={wordCount}
            onChange={(e) =>
              handleWordCountChange(Number(e.target.value) as WordCount)
            }
            className="w-full bg-primary/10 text-white border border-primary/50 rounded-lg px-4 py-2 mt-1"
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
            className="w-full bg-primary/10 text-white border border-primary/50 rounded-lg px-4 py-2 mt-1"
          >
            <option value="hardened">Hardened (m/44&apos;/2070&apos;/0&apos;/0/0)</option>
            <option value="non-hardened">
              Non-hardened (m/44&apos;/2070&apos;/0/0/0)
            </option>
          </select>
        </div>
        <div>
          <label className="text-white text-sm">Seed phrase</label>
          <textarea
            className="w-full min-h-[120px] bg-primary/10 text-white border border-primary/50 rounded-lg px-4 py-3 mt-1 focus:outline-none focus:border-primary resize-y"
            placeholder={`Paste or type your ${wordCount}-word seed phrase`}
            value={mnemonicText}
            onChange={(e) => setMnemonicText(e.target.value)}
            disabled={isProcessing}
          />
          <p className="text-white/40 text-xs mt-1">
            {words.length} / {wordCount} words
          </p>
        </div>
      </div>

      <div className="grid gap-5 w-full absolute bottom-5 left-0 px-6">
        <Button
          onClick={recoverWallet}
          variant="primary"
          ariaLabel="Continue"
          className="w-full"
          disabled={!isCompleted || isProcessing}
        >
          {isProcessing ? "Processing..." : "Continue"}
        </Button>
      </div>
    </section>
  );
}

export default ImportPage;
