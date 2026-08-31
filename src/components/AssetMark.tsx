import { useEffect, useMemo, useState } from "react";
import {
  assetDisplayName,
  assetDisplayTicker,
  assetLogoCandidates,
  useAssetMetadata,
} from "../utils/assetMetadata";

type Size = "sm" | "md";

export default function AssetMark({
  hash,
  name,
  size = "md",
}: {
  hash: string;
  name?: string;
  size?: Size;
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
      className={`defi-avatar defi-avatar-blue ${size === "sm" ? "defi-avatar-sm" : ""}`}
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
