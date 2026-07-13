import { useState } from "react";
import BackButton from "../components/BackButton";
import Button from "../components/Button";
import { useNavigate } from "react-router-dom";
import useWallet from "../hooks/useWallet";

function ImportPrivateKey() {
  const { importPrivateKey } = useWallet();
  const navigate = useNavigate();
  const [privateKey, setPrivateKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const handleSubmit = () => {
    setBusy(true);
    setError(null);
    try {
      importPrivateKey(privateKey);
      navigate("/set-password");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid private key");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container min-h-screen py-5 relative">
      <BackButton />
      <div className="flex flex-col gap-4 mt-3">
        <h1 className="text-center text-white text-xl font-semibold">
          Import private key
        </h1>
        <p className="text-white/50 text-xs text-center px-2">
          Same as the website &quot;Import from Private Key&quot; option. This
          creates a single-account wallet (no seed phrase).
        </p>

        <div>
          <label className="text-white text-sm">Private key (64 hex chars)</label>
          <div className="relative mt-1">
            <input
              type={showKey ? "text" : "password"}
              value={privateKey}
              onChange={(e) =>
                setPrivateKey(e.target.value.replace(/\s/g, ""))
              }
              placeholder="Enter 64-character hex private key"
              className="w-full bg-primary/10 text-white border border-primary/50 rounded-lg px-4 py-2 pr-16 focus:outline-none focus:border-primary font-mono text-sm"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-primary text-xs"
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? "Hide" : "Show"}
            </button>
          </div>
          <p className="text-white/40 text-xs mt-1">
            {privateKey.replace(/^0x/i, "").length} / 64 characters
          </p>
        </div>

        {error && <p className="text-red-500 text-sm">{error}</p>}
      </div>

      <div className="absolute bottom-5 left-0 px-6 w-full">
        <Button
          variant="primary"
          className="w-full"
          onClick={handleSubmit}
          disabled={busy || privateKey.replace(/^0x/i, "").length < 64}
        >
          {busy ? "Importing…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}

export default ImportPrivateKey;
