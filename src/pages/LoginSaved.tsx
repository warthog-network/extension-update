import { useEffect, useState } from "react";
import BackButton from "../components/BackButton";
import Button from "../components/Button";
import { useNavigate } from "react-router-dom";
import useWallet from "../hooks/useWallet";
import {
  getSavedWalletEntries,
  loadNamedWalletEncrypted,
  type SavedWalletEntry,
} from "../utils/warthogWalletCrypto";
import { isWebAuthnAvailable } from "../utils/passkeyWallet";
import { clearPasskeyWaiting, paintPasskeyWaiting } from "../utils/passkeyUi";

function LoginSaved() {
  const { loginFromEncrypted, loginFromPasskey } = useWallet();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<SavedWalletEntry[]>([]);
  const [selected, setSelected] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [awaitingPasskey, setAwaitingPasskey] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [passkeysSupported, setPasskeysSupported] = useState(false);

  useEffect(() => {
    setPasskeysSupported(isWebAuthnAvailable());
    getSavedWalletEntries()
      .then((list) => {
        setEntries(list);
        if (list.length === 1) setSelected(list[0].name);
      })
      .finally(() => setLoadingList(false));
  }, []);

  const selectedEntry = entries.find((e) => e.name === selected) || null;

  const handlePasswordLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!selected) throw new Error("Please select a saved wallet");
      if (!password) throw new Error("Please enter password");
      const encrypted = await loadNamedWalletEncrypted(selected);
      if (!encrypted) throw new Error("Selected wallet not found");
      if (selectedEntry?.require2fa) {
        throw new Error(
          "2FA wallet: enter password, then tap Unlock with password + passkey",
        );
      }
      await loginFromEncrypted(encrypted, password, selected);
      navigate("/home");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Login failed";
      setError(msg === "Invalid password" ? "Invalid password" : msg);
    } finally {
      setBusy(false);
    }
  };

  const handlePasskeyLogin = async (withPassword: boolean) => {
    setError(null);
    try {
      if (!selected) throw new Error("Please select a saved wallet");
      if (!passkeysSupported) {
        throw new Error("Passkeys are not available in this browser");
      }
      if (withPassword && !password) {
        throw new Error("Enter password, then confirm with passkey");
      }
      if (!withPassword && selectedEntry?.require2fa) {
        throw new Error(
          "This wallet requires password + passkey. Enter password, then tap Unlock (2FA).",
        );
      }
      const encrypted = await loadNamedWalletEncrypted(selected);
      if (!encrypted) throw new Error("Selected wallet not found");

      await paintPasskeyWaiting(setAwaitingPasskey, setBusy);
      await loginFromPasskey(
        encrypted,
        selected,
        withPassword ? password : null,
      );
      navigate("/home");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Passkey unlock failed";
      setError(msg);
    } finally {
      clearPasskeyWaiting(setAwaitingPasskey, setBusy);
    }
  };

  const canPassword =
    selectedEntry &&
    selectedEntry.hasPassword &&
    !selectedEntry.require2fa &&
    Boolean(password);
  const canPasskey =
    selectedEntry && selectedEntry.hasPasskey && passkeysSupported;
  const can2fa =
    selectedEntry?.require2fa &&
    selectedEntry.hasPasskey &&
    selectedEntry.hasPassword &&
    passkeysSupported &&
    Boolean(password);

  return (
    <div className="container min-h-screen py-5 relative overflow-y-auto pb-28">
      <BackButton />
      <div className="flex flex-col gap-4 mt-3">
        <h1 className="text-center text-white text-xl font-semibold">
          Unlock wallet
        </h1>
        <p className="text-white/50 text-xs text-center px-2">
          {entries.some((e) => e.require2fa)
            ? "2FA: enter password, then confirm with passkey."
            : entries.some((e) => e.hasPasskey)
              ? "Tap Unlock with passkey, or use password if you set one."
              : "Choose a saved wallet and enter its password. You can add a passkey after unlock."}
        </p>

        {loadingList ? (
          <p className="text-white/50 text-sm text-center">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="text-white/50 text-sm text-center px-4">
            No saved wallets yet. Create or import a wallet, then save it with a
            password and/or passkey from Account details.
          </p>
        ) : (
          <div className="grid gap-2">
            {entries.map((entry) => {
              const isSelected = selected === entry.name;
              return (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => {
                    setSelected(entry.name);
                    setError(null);
                  }}
                  className={`text-left rounded-lg border p-3 transition ${
                    isSelected
                      ? "border-primary bg-primary/15"
                      : "border-primary/25 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="text-white font-medium">{entry.name}</div>
                  <div className="text-white/40 text-xs mt-0.5">
                    {entry.badge}
                    {entry.addressHint ? ` · ${entry.addressHint}` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {selectedEntry && (
          <div>
            <label className="text-white text-sm">
              {selectedEntry.require2fa
                ? "Password (required for 2FA)"
                : selectedEntry.hasPassword
                  ? "Password"
                  : "Password (not set on this wallet)"}
            </label>
            <div className="relative mt-1">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canPassword) void handlePasswordLogin();
                }}
                placeholder={
                  selectedEntry.hasPassword
                    ? "Enter password"
                    : "No password on this wallet"
                }
                disabled={!selectedEntry.hasPassword}
                className="w-full bg-primary/10 text-white border border-primary/50 rounded-lg px-4 py-2 pr-16 focus:outline-none focus:border-primary disabled:opacity-40"
                autoComplete="current-password"
              />
              {selectedEntry.hasPassword && (
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-primary text-xs"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              )}
            </div>
          </div>
        )}

        {error && <p className="text-red-500 text-sm">{error}</p>}
      </div>

      <div className="absolute bottom-5 left-0 px-6 w-full grid gap-2">
        {selectedEntry?.require2fa ? (
          <Button
            variant="primary"
            className="w-full"
            onClick={() => void handlePasskeyLogin(true)}
            disabled={busy || !can2fa}
          >
            {awaitingPasskey
              ? "Waiting for passkey…"
              : "Unlock with password + passkey"}
          </Button>
        ) : (
          <>
            {canPasskey && (
              <Button
                variant="primary"
                className="w-full"
                onClick={() => void handlePasskeyLogin(false)}
                disabled={busy}
              >
                {awaitingPasskey ? "Waiting for passkey…" : "Unlock with passkey"}
              </Button>
            )}
            {selectedEntry?.hasPassword && (
              <>
                {selectedEntry.hasPasskey && (
                  <p className="text-white/40 text-xs text-center">Or use password</p>
                )}
                <Button
                  variant={canPasskey ? "outline" : "primary"}
                  className="w-full"
                  onClick={() => void handlePasswordLogin()}
                  disabled={busy || !canPassword}
                >
                  {busy && !awaitingPasskey
                    ? "Unlocking…"
                    : "Unlock with password"}
                </Button>
              </>
            )}
          </>
        )}
        {!selectedEntry && entries.length > 0 && (
          <Button
            variant="primary"
            className="w-full"
            disabled
            onClick={() => undefined}
          >
            Select a wallet
          </Button>
        )}
      </div>

      {awaitingPasskey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="rounded-xl border border-primary/40 bg-[#1a1a1a] px-6 py-5 max-w-sm text-center shadow-xl">
            <div
              className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
              aria-hidden
            />
            <p className="text-white font-medium">Waiting for passkey…</p>
            <p className="text-white/50 text-xs mt-1">
              Use your password manager, Face ID, fingerprint, or security key.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default LoginSaved;
