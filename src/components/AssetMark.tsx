import { useEffect, useMemo, useState } from "react";
import {
  assetDisplayName,
  assetDisplayTicker,
  assetLogoCandidates,
  useAssetMetadata,
} from "../utils/assetMetadata";

type Size = "xs" | "sm" | "md";

export default function AssetMark({
  hash,
  name,
  size = "md",
  round = false,
}: {
  hash: string;
  name?: string;
  size?: Size;
  round?: boolean;
}) {
  const meta = useAssetMetadata(hash);
  const urls = useMemo(() => {
    const list = [
      ...(meta?.logoUrl ? [meta.logoUrl] : []),
      ...(meta?.logoCandidates || assetLogoCandidates(hash)),
    ];
    return [...new Set(list)];
  }, [hash, meta]);
  const [idx, setIdx] = useState(0);
  const src = urls[idx];
  const letter = (
    assetDisplayTicker(name, meta) ||
    assetDisplayName(name, meta) ||
    "?"
  )
    .charAt(0)
    .toUpperCase();

  useEffect(() => {
    setIdx(0);
  }, [hash]);

  return (
    <div
      className={`defi-avatar defi-avatar-blue${
        size === "xs" ? " defi-avatar-xs" : size === "sm" ? " defi-avatar-sm" : ""
      }${round ? " defi-avatar-round" : ""}`}
      title={assetDisplayName(name, meta)}
    >
      {src ? (
        <img
          src={src}
          alt=""
          onError={() => setIdx((i) => i + 1)}
        />
      ) : (
        letter || "?"
      )}
    </div>
  );
}

export function AssetTitle({
  hash,
  name,
}: {
  hash: string;
  name?: string;
}) {
  const meta = useAssetMetadata(hash);
  const display = assetDisplayName(name, meta);
  const ticker = assetDisplayTicker(name, meta);
  const showTicker = ticker && ticker.toLowerCase() !== display.toLowerCase();
  return (
    <>
      {display}
      {showTicker ? (
        <span className="defi-card-sub"> · {ticker}</span>
      ) : null}
    </>
  );
}
