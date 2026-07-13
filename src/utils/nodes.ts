import {
  DEFI_TESTNET_URL,
  DEFAULT_NODE_LIST,
  DEFAULT_NODE_NAME_LIST,
  MAINNET_OFFICIAL_URL,
  PRESET_NODES,
} from "../config/network";

/** Normalize a node base URL from user input. */
export function normalizeNodeUrl(nodeBase: string | null | undefined): string {
  let normalized = String(nodeBase || "")
    .trim()
    .replace(/\/+$/, "");
  if (!normalized) return "";
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
    normalized = `http://${normalized}`;
  }
  return normalized;
}

const PRESET_URLS = new Set(PRESET_NODES.map((n) => normalizeNodeUrl(n.url)));

/** True when the node URL matches a built-in preset (normalized). */
export function isPresetNodeUrl(node: string | null | undefined): boolean {
  const n = normalizeNodeUrl(node);
  return Boolean(n) && PRESET_URLS.has(n);
}

/**
 * True for DeFi / testnet nodes (wart_balance, Assets, DEX-style APIs).
 * Mirrors wartbunker `isDefiNode`.
 */
export function isDefiNode(node: string | null | undefined): boolean {
  const n = normalizeNodeUrl(node).toLowerCase();
  if (!n) return false;
  if (PRESET_NODES.some((p) => p.network === "defi-testnet" && normalizeNodeUrl(p.url) === n)) {
    return true;
  }
  if (n.includes("defitestnet") || n.includes("testnet")) return true;
  if (n.includes("localhost") || n.includes("127.0.0.1")) return true;
  if (n.includes(":3002")) return true;
  return false;
}

/** Mainnet nodes use /account/:addr/balance; DeFi testnet uses /wart_balance. */
export function isMainnetNode(node: string | null | undefined): boolean {
  return !isDefiNode(node);
}

export function networkLabel(node: string | null | undefined): "Mainnet" | "DeFi Testnet" {
  return isDefiNode(node) ? "DeFi Testnet" : "Mainnet";
}

/** Legacy browser-wallet / website node keys that should map to official mainnet. */
const LEGACY_MAINNET = new Set([
  "losthymns",
  "official2",
  "polaire",
  "blu & Asia",
  "johnnyb Us East",
  "http://51.75.21.134:3001",
  "http://62.72.44.89:3001",
  "http://dev.node-s.com:3001",
  "http://65.87.7.86:3001",
]);

/**
 * Merge stored custom nodes with current presets.
 * Migrates known-dead legacy defaults to the modern preset list.
 */
export function mergeNodeLists(
  storedUrls: string[] | null | undefined,
  storedNames: string[] | null | undefined,
): { urls: string[]; names: string[] } {
  const urls = (storedUrls || []).map(normalizeNodeUrl).filter(Boolean);
  const names = storedNames || [];

  // Fresh install or empty storage → full presets
  if (urls.length === 0) {
    return {
      urls: [...DEFAULT_NODE_LIST],
      names: [...DEFAULT_NODE_NAME_LIST],
    };
  }

  // If storage only has legacy dead nodes, replace with presets
  const allLegacy =
    urls.length > 0 &&
    urls.every(
      (u) =>
        LEGACY_MAINNET.has(u) ||
        LEGACY_MAINNET.has(u.replace(/\/$/, "")) ||
        !u.startsWith("http"),
    );

  if (allLegacy) {
    return {
      urls: [...DEFAULT_NODE_LIST],
      names: [...DEFAULT_NODE_NAME_LIST],
    };
  }

  // Ensure official mainnet + official defi testnet are always present
  const nextUrls = [...urls];
  const nextNames = urls.map((u, i) => names[i] || labelForNodeUrl(u));

  const ensure = (url: string, name: string) => {
    const n = normalizeNodeUrl(url);
    if (!nextUrls.some((u) => normalizeNodeUrl(u) === n)) {
      nextUrls.unshift(n);
      nextNames.unshift(name);
    }
  };

  ensure(DEFI_TESTNET_URL, "DeFi Testnet (Official)");
  ensure(MAINNET_OFFICIAL_URL, "Official Mainnet");

  return { urls: nextUrls, names: nextNames };
}

export function labelForNodeUrl(url: string): string {
  const preset = PRESET_NODES.find((p) => normalizeNodeUrl(p.url) === normalizeNodeUrl(url));
  if (preset) return preset.name;
  try {
    return new URL(normalizeNodeUrl(url)).host || url;
  } catch {
    return url;
  }
}

/** Ordered failover candidates for a preferred node (DeFi only hops across presets). */
export function buildFailoverCandidates(preferred: string): string[] {
  const preferredNorm = normalizeNodeUrl(preferred) || MAINNET_OFFICIAL_URL;
  const candidates = [preferredNorm];

  if (!isDefiNode(preferredNorm)) {
    return candidates;
  }

  for (const { url, network } of PRESET_NODES) {
    if (network !== "defi-testnet") continue;
    const normalized = normalizeNodeUrl(url);
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  }
  return candidates;
}
