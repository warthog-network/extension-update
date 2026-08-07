import React, { useEffect, useState } from "react";
import BackButton from "../components/BackButton";
import Button from "../components/Button";
import { useNavigate } from "react-router-dom";
import useWallet from "../hooks/useWallet";
import { isWebAuthnAvailable } from "../utils/passkeyWallet";
import { clearPasskeyWaiting, paintPasskeyWaiting } from "../utils/passkeyUi";

const SetPassword: React.FC = () => {
  const { setPassword, setToken, saveCurrentAsNamedWallet, name } = useWallet();
  const navigate = useNavigate();
  const [password, setPass] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [saveNamed, setSaveNamed] = useState(true);
  const [walletName, setWalletName] = useState(name || "My Wallet");
  const [enablePasskey, setEnablePasskey] = useState(false);
  const [require2fa, setRequire2fa] = useState(false);
  const [passkeysSupported, setPasskeysSupported] = useState(false);
  const [awaitingPasskey, setAwaitingPasskey] = useState(false);
  const [errors, setErrors] = useState<{
    password?: string;
    confirmPassword?: string;
    save?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ok = isWebAuthnAvailable();
    setPasskeysSupported(ok);
    setEnablePasskey(ok);
  }, []);

  const validatePasswords = () => {
    const newErrors: {
      password?: string;
      confirmPassword?: string;
      save?: string;
    } = {};
    const wantsPassword = Boolean(password) || require2fa || !enablePasskey;
    if (wantsPassword) {
      if (password.length < 8)
        newErrors.password = "Password must be at least 8 characters long.";
      if (password !== confirmPassword)
        newErrors.confirmPassword = "Passwords do not match.";
    }
    if (saveNamed && !walletName.trim())
      newErrors.save = "Enter a name to save this wallet for quick login.";
    if (saveNamed && !password && !(enablePasskey && passkeysSupported)) {
      newErrors.save = "Enable passkey and/or set a password to save.";
    }
    if (require2fa && (!password || !(enablePasskey && passkeysSupported))) {
      newErrors.save = "2FA needs both a password and passkey.";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validatePasswords()) return;
    setBusy(true);
    setErrorClear();
    try {
      if (password) {
        setPassword(password);
        setToken(password + Date.now().toString());
      } else {
        setToken("passkey-" + Date.now().toString());
      }
      if (saveNamed) {
        if (enablePasskey && passkeysSupported) {
          await paintPasskeyWaiting(setAwaitingPasskey);
        }
        await saveCurrentAsNamedWallet(
          walletName.trim(),
          password || null,
          {
            withPasskey: enablePasskey && passkeysSupported,
            require2fa: require2fa && Boolean(password),
            preferFingerprint: false,
          },
        );
      }
      navigate("/home");
    } catch (e) {
      setErrors({
        save: e instanceof Error ? e.message : "Failed to save wallet",
      });
    } finally {
      clearPasskeyWaiting(setAwaitingPasskey);
      setBusy(false);
    }
  };

  const setErrorClear = () => setErrors((prev) => ({ ...prev, save: undefined }));

  return (
    <div className="container min-h-screen relative pb-24">
      <BackButton />
      <div className="grid justify-center items-center gap-5 mt-2">
        <h1 className="text-center text-white text-xl font-semibold capitalize">
          Secure your wallet
        </h1>
        <p className="text-center text-white/60 text-sm font-medium leading-tight px-2">
          Set unlock options for next time. Passkeys work with password managers
          or this device (Face ID / fingerprint).
        </p>
      </div>
      <div className="mt-5 grid gap-5">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 accent-[#fdb913]"
            checked={saveNamed}
            onChange={(e) => setSaveNamed(e.target.checked)}
          />
          <span className="text-white text-sm">
            Save named wallet for quick login (WartBunker-compatible)
          </span>
        </label>
        {saveNamed && (
          <div>
            <label className="text-white text-sm font-normal">Wallet name</label>
            <input
              type="text"
              className="w-full bg-primary/10 placeholder:text-sm text-white border border-primary/50 rounded-lg px-4 py-2 mt-1 focus-visible:outline-primary"
              placeholder="My Wallet"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
            />
          </div>
        )}

        {saveNamed && passkeysSupported && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 accent-[#fdb913]"
              checked={enablePasskey}
              onChange={(e) => {
                setEnablePasskey(e.target.checked);
                if (!e.target.checked) setRequire2fa(false);
              }}
            />
            <span className="text-white text-sm">
              Enable passkey unlock (recommended)
            </span>
          </label>
        )}

        {saveNamed && enablePasskey && passkeysSupported && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 accent-[#fdb913]"
              checked={require2fa}
              onChange={(e) => setRequire2fa(e.target.checked)}
            />
            <span className="text-white text-sm">
              Optional 2FA: require password + passkey together
            </span>
          </label>
        )}

        <div>
          <label className="text-white text-sm font-normal">
            {require2fa
              ? "Password (required for 2FA)"
              : enablePasskey && passkeysSupported
                ? "Password (optional if passkey is on)"
                : "Enter Password"}
          </label>
          <input
            type="password"
            className="w-full bg-primary/10 placeholder:text-sm text-white border border-primary/50 rounded-lg px-4 py-2 mt-1 focus-visible:outline-primary"
            placeholder="Your password..."
            value={password}
            onChange={(e) => setPass(e.target.value)}
          />
          {errors.password && (
            <p className="text-red-500 text-xs mt-1">{errors.password}</p>
          )}
        </div>
        <div>
          <label className="text-white text-sm font-normal">
            Enter Password Again
          </label>
          <input
            type="password"
            className="w-full bg-primary/10 placeholder:text-sm text-white border border-primary/50 rounded-lg px-4 py-2 mt-1 focus-visible:outline-primary"
            placeholder="Your password..."
            value={confirmPassword}
            onKeyDown={(e) => e.key === "Enter" && void handleSubmit()}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {errors.confirmPassword && (
            <p className="text-red-500 text-xs mt-1">
              {errors.confirmPassword}
            </p>
          )}
        </div>

        {errors.save && (
          <p className="text-red-500 text-xs">{errors.save}</p>
        )}
      </div>

      <div className="absolute bottom-5 left-0 px-6 w-full">
        <Button
          className="w-full"
          onClick={() => void handleSubmit()}
          disabled={busy}
        >
          {awaitingPasskey
            ? "Waiting for passkey…"
            : busy
              ? "Saving…"
              : enablePasskey && passkeysSupported && saveNamed
                ? "Save & open (register passkey)"
                : "Continue"}
        </Button>
      </div>

      {awaitingPasskey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6"
          role="status"
          aria-live="polite"
        >
          <div className="rounded-xl border border-primary/40 bg-[#1a1a1a] px-6 py-5 max-w-sm text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-white font-medium">Waiting for passkey…</p>
            <p className="text-white/50 text-xs mt-1">
              Choose a password manager or this device when prompted.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default SetPassword;
