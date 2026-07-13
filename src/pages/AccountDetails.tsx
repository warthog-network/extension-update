import { useState, useEffect } from "react";
import BackButton from "../components/BackButton";
import Button from "../components/Button";
import { useNavigate } from "react-router-dom";
import useWallet from "../hooks/useWallet";
import Jazzicon from "react-jazzicon/dist/Jazzicon";
import { QRCodeSVG } from "qrcode.react";
import { encryptWallet } from "../utils/warthogWalletCrypto";

function IconButton({
  iconSrc,
  label,
  onClick,
}: {
  iconSrc: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center gap-2 cursor-pointer"
      onClick={onClick}
    >
      <div className="flex justify-center items-center w-16 h-16 bg-[#f1f1f1] rounded-full">
        <img src={iconSrc} alt={label} />
      </div>
      <div className="text-sm text-white">{label}</div>
    </div>
  );
}

function useDebounce(value: string | null, delay: number): string | null {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

function AccountDetails() {
  const {
    wallet,
    name,
    nameList,
    setNameList,
    selectedWalletIndex,
    setName,
    password,
    saveCurrentAsNamedWallet,
    seedPhrase,
    getAccountFromIndex,
  } = useWallet();
  const [copyLabel, setCopyLabel] = useState("Copy");
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState<string | null>(name);
  const debouncedName = useDebounce(tempName, 1000);
  const navigate = useNavigate();
  const [saveName, setSaveName] = useState(name || "My Wallet");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSaveNamed = async () => {
    if (!password) {
      setSaveErr("Unlock password missing — re-open the wallet");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    try {
      await saveCurrentAsNamedWallet(saveName.trim(), password);
      setSaveMsg(`Saved as "${saveName.trim()}" for quick login`);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadFile = () => {
    if (!password || !wallet) return;
    try {
      const account = getAccountFromIndex(selectedWalletIndex);
      const encrypted = encryptWallet(
        {
          privateKey: account.getPrivateKeyHex(),
          publicKey: account.getPublicKeyHex(),
          address: account.getAddress(),
          mnemonic: seedPhrase || undefined,
        },
        password,
      );
      const blob = new Blob([encrypted], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "warthog_wallet.txt";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Download failed");
    }
  };

  const handleCopyAddress = () => {
    if (wallet) {
      navigator.clipboard
        .writeText(wallet)
        .then(() => {
          setCopyLabel("Copied!");
          setTimeout(() => setCopyLabel("Copy"), 2000);
        })
        .catch((err) => {
          console.log("Failed to copy wallet address: ", err);
        });
    } else {
      alert("No wallet connected to copy.");
    }
  };

  const handleEditClick = () => {
    setIsEditing(true);
  };

  useEffect(() => {
    if (debouncedName !== name) {
      setName(debouncedName || "");
      setNameList(
        nameList.map((item, index) =>
          index === selectedWalletIndex ? debouncedName || "" : item,
        ),
      );
    }
  }, [
    debouncedName,
    name,
    nameList,
    selectedWalletIndex,
    setName,
    setNameList,
  ]);

  return (
    <div className="min-h-screen container relative">
      <BackButton />

      <div className="flex justify-center items-center gap-4 mt-6">
        {/* <img
                    className="w-20 h-20 rounded-full object-cover"
                    src="profile-image.png"
                    alt="Profile"
                /> */}
        {<Jazzicon diameter={80} seed={selectedWalletIndex} />}
        <div>
          <div className="text-xl font-semibold text-white">
            {isEditing ? (
              <input
                type="text"
                value={tempName || ""}
                onChange={(e) => setTempName(e.target.value)}
                onBlur={() => setIsEditing(false)} // Exit edit mode on blur
                className="text-xl font-semibold text-white bg-transparent border-b border-white focus:outline-none max-w-28"
                autoFocus
                placeholder="Your Name"
              />
            ) : (
              name || ""
            )}
          </div>
          <div className="text-xs text-white/50">Connected Wallet</div>
        </div>
        <img
          className="w-6 h-6 cursor-pointer"
          src="icons/edit-2.svg"
          alt="Edit Profile"
          onClick={handleEditClick}
        />
      </div>

      <div className="bg-gray-800 p-6 rounded-lg border border-gray-600 flex flex-col items-center gap-4 mt-6">
        {wallet ? (
          <QRCodeSVG
            value={wallet}
            size={128}
            bgColor="#000000"
            fgColor="#ffffff"
            level="H"
          />
        ) : (
          <></>
        )}
        {/* <img
                    src="qrCode.png"
                    alt="QR Code to receive payment"
                    className="w-32 h-32"
                /> */}
        <div
          className="text-sm text-gray-200 text-white cursor-pointer hover:underline"
          onClick={handleCopyAddress}
        >
          {wallet || "No wallet connected"}
        </div>
      </div>

      <div className="flex justify-center gap-10 mt-6">
        <IconButton
          iconSrc="icons/Icon-copy.svg"
          label={copyLabel}
          onClick={handleCopyAddress}
        />
      </div>

      <div className="mt-6 px-1 grid gap-2">
        <p className="text-white text-sm font-medium">Save for quick login</p>
        <input
          type="text"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
          placeholder="Wallet name"
          className="w-full bg-primary/10 text-white border border-primary/50 rounded-lg px-3 py-2 text-sm"
        />
        <Button
          className="w-full"
          variant="outline"
          onClick={handleSaveNamed}
          disabled={saving || !saveName.trim()}
        >
          {saving ? "Saving…" : "Save named wallet"}
        </Button>
        <Button className="w-full" variant="outline" onClick={handleDownloadFile}>
          Download warthog_wallet.txt
        </Button>
        {saveMsg && <p className="text-emerald-400 text-xs">{saveMsg}</p>}
        {saveErr && <p className="text-red-400 text-xs">{saveErr}</p>}
      </div>

      <div className="w-full mt-4 px-3 pb-4">
        <Button className="w-full" onClick={() => navigate("/private-key")}>
          Show Private Key
        </Button>
      </div>
    </div>
  );
}

export default AccountDetails;
