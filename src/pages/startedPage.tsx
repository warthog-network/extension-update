import { useNavigate } from "react-router-dom";
import Button from "../components/Button";

const OPTIONS = [
  {
    path: "/intro",
    label: "Create a new wallet",
    description: "Generate a new seed phrase (12 or 24 words)",
    variant: "primary" as const,
  },
  {
    path: "/import",
    label: "Derive from seed phrase",
    description: "Restore from a 12 or 24-word recovery phrase",
    variant: "outline" as const,
  },
  {
    path: "/import-key",
    label: "Import private key",
    description: "Use a 64-character hex private key",
    variant: "outline" as const,
  },
  {
    path: "/login-saved",
    label: "Login to saved wallet",
    description: "Unlock a wallet saved in this extension",
    variant: "outline" as const,
  },
  {
    path: "/login-file",
    label: "Login with wallet file",
    description: "Paste warthog_wallet.txt contents (stays in popup)",
    variant: "outline" as const,
  },
];

function StartedPage() {
  const navigate = useNavigate();

  return (
    <div className="container min-h-screen flex flex-col py-4">
      <div className="flex justify-center items-center pt-2 pb-4">
        <img
          src="/fullLogo.png"
          alt="WARTHOG NETWORK"
          className="max-h-28 object-contain"
        />
      </div>
      <p className="text-center text-white/60 text-xs mb-3 px-2">
        Same login options as the website webwallet
      </p>
      <div className="flex-col flex gap-2.5 justify-center flex-1 pb-4">
        {OPTIONS.map((opt) => (
          <div key={opt.path}>
            <Button
              onClick={() => navigate(opt.path)}
              variant={opt.variant}
              ariaLabel={opt.label}
              className="w-full"
            >
              {opt.label}
            </Button>
            <p className="text-[11px] text-white/40 text-center mt-0.5 px-2">
              {opt.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
export default StartedPage;
