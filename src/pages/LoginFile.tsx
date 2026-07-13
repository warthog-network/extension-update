import { useState } from "react";
import { useNavigate } from "react-router-dom";
import BackButton from "../components/BackButton";
import Button from "../components/Button";
import useWallet from "../hooks/useWallet";

/**
 * File login stays inside the extension popup.
 * Native <input type="file"> closes the popup when the OS dialog opens, so we
 * use paste / clipboard / optional drag-and-drop of the encrypted text instead.
 */
function LoginFile() {
  const { loginFromEncrypted } = useWallet();
  const navigate = useNavigate();
  const [encryptedText, setEncryptedText] = useState("");
  const [walletLabel, setWalletLabel] = useState("Imported wallet");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const acceptText = (text: string, label?: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Empty content");
      return;
    }
    setEncryptedText(trimmed);
    if (label) setWalletLabel(label.replace(/\.txt$/i, ""));
    setError(null);
  };

  const handlePasteFromClipboard = async () => {
    setError(null);
    try {
      const text = await navigator.clipboard.readText();
      acceptText(text, "Clipboard wallet");
    } catch {
      setError("Could not read clipboard — paste into the box instead (Ctrl+V)");
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    setError(null);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      try {
        const text = await file.text();
        acceptText(text, file.name);
        return;
      } catch {
        setError("Could not read dropped file");
        return;
      }
    }

    // Some environments drop plain text
    const text = e.dataTransfer.getData("text/plain");
    if (text?.trim()) {
      acceptText(text, "Dropped text");
    }
  };

  const handleLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!encryptedText.trim()) {
        throw new Error("Paste or drop your warthog_wallet.txt contents first");
      }
      if (!password) throw new Error("Please enter password");

      await loginFromEncrypted(
        encryptedText.trim(),
        password,
        walletLabel.trim() || "Imported wallet",
      );
      navigate("/home", { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed";
      setError(msg === "Invalid password" ? "Invalid password" : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container min-h-screen py-5 relative">
      <BackButton />
      <div className="flex flex-col gap-3 mt-2">
        <h1 className="text-center text-white text-xl font-semibold">
          Login with wallet file
        </h1>
        <p className="text-white/50 text-xs text-center px-1">
          Open{" "}
          <span className="text-primary">warthog_wallet.txt</span> in any
          editor, copy all, then paste below. (File pickers close the extension
          popup, so paste stays in-popup.)
        </p>

        <div
          className={`rounded-lg border-2 border-dashed p-3 transition ${
            dragActive
              ? "border-primary bg-primary/10"
              : "border-primary/30 bg-white/5"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
        >
          <label className="text-white text-sm block mb-1">
            Encrypted wallet data
          </label>
          <textarea
            className="w-full min-h-[110px] bg-black/40 text-white text-xs font-mono border border-primary/25 rounded-lg px-3 py-2 focus:outline-none focus:border-primary resize-y"
            placeholder="Paste the full contents of warthog_wallet.txt here…"
            value={encryptedText}
            onChange={(e) => {
              setEncryptedText(e.target.value);
              setError(null);
            }}
            spellCheck={false}
            autoComplete="off"
          />
          <div className="flex gap-2 mt-2 flex-wrap">
            <button
              type="button"
              className="text-xs text-primary underline"
              onClick={handlePasteFromClipboard}
            >
              Paste from clipboard
            </button>
            <span className="text-white/30 text-xs">·</span>
            <span className="text-white/40 text-xs">
              or drop the .txt onto this box
            </span>
          </div>
          {encryptedText.trim() && (
            <p className="text-emerald-400 text-[11px] mt-2">
              Loaded ({encryptedText.trim().length} chars)
              {walletLabel ? ` · ${walletLabel}` : ""}
            </p>
          )}
        </div>

        <div>
          <label className="text-white text-sm">Wallet name (optional)</label>
          <input
            type="text"
            value={walletLabel}
            onChange={(e) => setWalletLabel(e.target.value)}
            className="w-full bg-primary/10 text-white border border-primary/50 rounded-lg px-4 py-2 mt-1 focus:outline-none focus:border-primary text-sm"
            placeholder="My wallet"
          />
        </div>

        <div>
          <label className="text-white text-sm">Password</label>
          <div className="relative mt-1">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && handleLogin()}
              placeholder="Password used to encrypt the file"
              className="w-full bg-primary/10 text-white border border-primary/50 rounded-lg px-4 py-2 pr-16 focus:outline-none focus:border-primary"
              autoComplete="current-password"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-primary text-xs"
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {error && <p className="text-red-400 text-sm break-words">{error}</p>}
      </div>

      <div className="mt-6 w-full pb-4">
        <Button
          variant="primary"
          className="w-full"
          onClick={handleLogin}
          disabled={busy || !encryptedText.trim() || !password}
        >
          {busy ? "Unlocking…" : "Login"}
        </Button>
      </div>
    </div>
  );
}

export default LoginFile;
