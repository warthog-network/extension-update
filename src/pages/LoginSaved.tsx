import { useEffect, useState } from "react";
import BackButton from "../components/BackButton";
import Button from "../components/Button";
import { useNavigate } from "react-router-dom";
import useWallet from "../hooks/useWallet";
import {
  getSavedWallets,
  loadNamedWalletEncrypted,
} from "../utils/warthogWalletCrypto";

function LoginSaved() {
  const { loginFromEncrypted } = useWallet();
  const navigate = useNavigate();
  const [names, setNames] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    getSavedWallets()
      .then((list) => {
        setNames(list);
        if (list.length === 1) setSelected(list[0]);
      })
      .finally(() => setLoadingList(false));
  }, []);

  const handleLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!selected) throw new Error("Please select a saved wallet");
      if (!password) throw new Error("Please enter password");
      const encrypted = await loadNamedWalletEncrypted(selected);
      if (!encrypted) throw new Error("Selected wallet not found");
      loginFromEncrypted(encrypted, password, selected);
      navigate("/home");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed";
      setError(msg === "Invalid password" ? "Invalid password" : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container min-h-screen py-5 relative overflow-y-auto pb-28">
      <BackButton />
      <div className="flex flex-col gap-4 mt-3">
        <h1 className="text-center text-white text-xl font-semibold">
          Login to saved wallet
        </h1>
        <p className="text-white/50 text-xs text-center px-2">
          Same as the website &quot;Login to Saved Wallet&quot; — wallets saved
          in this extension under a name + password.
        </p>

        {loadingList ? (
          <p className="text-white/50 text-sm text-center">Loading…</p>
        ) : names.length === 0 ? (
          <p className="text-white/50 text-sm text-center px-4">
            No saved wallets yet. Create or import a wallet, set a password, then
            save it from Account details.
          </p>
        ) : (
          <div className="grid gap-2">
            {names.map((name) => {
              const isSelected = selected === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => {
                    setSelected(name);
                    setError(null);
                  }}
                  className={`text-left rounded-lg border p-3 transition ${
                    isSelected
                      ? "border-primary bg-primary/15"
                      : "border-primary/25 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="text-white font-medium">{name}</div>
                  <div className="text-white/40 text-xs">
                    {isSelected ? "Selected" : "Saved in this extension"}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div>
          <label className="text-white text-sm">Password</label>
          <div className="relative mt-1">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="Enter password"
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

        {error && <p className="text-red-500 text-sm">{error}</p>}
      </div>

      <div className="absolute bottom-5 left-0 px-6 w-full">
        <Button
          variant="primary"
          className="w-full"
          onClick={handleLogin}
          disabled={busy || !selected || !password || names.length === 0}
        >
          {busy ? "Unlocking…" : "Login"}
        </Button>
      </div>
    </div>
  );
}

export default LoginSaved;
