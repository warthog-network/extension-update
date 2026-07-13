import React, { useState } from "react";
import BackButton from "../components/BackButton";
import Button from "../components/Button";
import { useNavigate } from "react-router-dom";
import useWallet from "../hooks/useWallet";

const SetPassword: React.FC = () => {
  const { setPassword, setToken, saveCurrentAsNamedWallet, name } = useWallet();
  const navigate = useNavigate();
  const [password, setPass] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [saveNamed, setSaveNamed] = useState(true);
  const [walletName, setWalletName] = useState(name || "My Wallet");
  const [errors, setErrors] = useState<{
    password?: string;
    confirmPassword?: string;
    save?: string;
  }>({});
  const [busy, setBusy] = useState(false);

  const validatePasswords = () => {
    const newErrors: {
      password?: string;
      confirmPassword?: string;
      save?: string;
    } = {};
    if (password.length < 8)
      newErrors.password = "Password must be at least 8 characters long.";
    if (password !== confirmPassword)
      newErrors.confirmPassword = "Passwords do not match.";
    if (saveNamed && !walletName.trim())
      newErrors.save = "Enter a name to save this wallet for quick login.";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validatePasswords()) return;
    setBusy(true);
    try {
      setPassword(password);
      setToken(password + Date.now().toString());
      if (saveNamed) {
        await saveCurrentAsNamedWallet(walletName.trim(), password);
      }
      navigate("/home");
    } catch (e) {
      setErrors({
        save: e instanceof Error ? e.message : "Failed to save wallet",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container min-h-screen relative">
      <BackButton />
      <div className="grid justify-center items-center gap-5 mt-2">
        <h1 className="text-center text-white text-xl font-semibold capitalize">
          Choose your password
        </h1>
        <p className="text-center text-white text-sm font-medium leading-tight">
          Please write this down on paper as well.
        </p>
      </div>
      <div className="mt-5 grid gap-5">
        <div>
          <label className="text-white text-sm font-normal">
            Enter Password
          </label>
          <input
            type={"password"}
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
            type={"password"}
            className="w-full bg-primary/10 placeholder:text-sm text-white border border-primary/50 rounded-lg px-4 py-2 mt-1 focus-visible:outline-primary"
            placeholder="Your password..."
            value={confirmPassword}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          {errors.confirmPassword && (
            <p className="text-red-500 text-xs mt-1">
              {errors.confirmPassword}
            </p>
          )}
        </div>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 accent-[#fdb913]"
            checked={saveNamed}
            onChange={(e) => setSaveNamed(e.target.checked)}
          />
          <span className="text-white text-sm">
            Save named wallet for quick login (website-compatible)
          </span>
        </label>
        {saveNamed && (
          <div>
            <label className="text-white text-sm font-normal">
              Wallet name
            </label>
            <input
              type="text"
              className="w-full bg-primary/10 placeholder:text-sm text-white border border-primary/50 rounded-lg px-4 py-2 mt-1 focus-visible:outline-primary"
              placeholder="e.g. Main, DeFi testnet"
              value={walletName}
              onChange={(e) => setWalletName(e.target.value)}
            />
          </div>
        )}
        {errors.save && (
          <p className="text-red-500 text-xs">{errors.save}</p>
        )}
      </div>
      <div className="absolute bottom-5 left-0 px-6 w-full">
        <Button
          className="w-full"
          variant="primary"
          onClick={handleSubmit}
          disabled={busy}
        >
          {busy ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
};

export default SetPassword;
