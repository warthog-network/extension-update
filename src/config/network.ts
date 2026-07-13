/** Official mainnet node (same as website webwallet). */
export const MAINNET_OFFICIAL_URL = "https://warthognode.duckdns.org";

/** Official Warthog DeFi testnet (same as wartbunker). */
export const DEFI_TESTNET_URL = "https://warthog-defitestnet.duckdns.org";

export const WARTHOG_NETWORK = {
  chainId: 1337,
  name: "Warthog Network",
  rpcUrl: MAINNET_OFFICIAL_URL,
  currency: {
    name: "Warthog",
    symbol: "WART",
    decimals: 8,
  },
  explorer: "https://wartscan.io/",
} as const;

export const NETWORKS = {
  WARTHOG: WARTHOG_NETWORK,
} as const;

export type PresetNode = {
  url: string;
  name: string;
  network: "mainnet" | "defi-testnet";
};

/** Built-in nodes shown in the selector (mainnet + DeFi testnet). */
export const PRESET_NODES: PresetNode[] = [
  { url: MAINNET_OFFICIAL_URL, name: "Official Mainnet", network: "mainnet" },
  { url: DEFI_TESTNET_URL, name: "DeFi Testnet (Official)", network: "defi-testnet" },
  { url: "http://104.251.219.14:3001", name: "DeFi Testnet 2", network: "defi-testnet" },
  { url: "http://65.87.7.86:3002", name: "DeFi Testnet 1", network: "defi-testnet" },
  { url: "http://85.56.145.106:3001", name: "DeFi Testnet 3", network: "defi-testnet" },
  { url: "http://209.127.34.202:3001", name: "DeFi Testnet 4", network: "defi-testnet" },
];

export const DEFAULT_NODE_LIST = PRESET_NODES.map((n) => n.url);
export const DEFAULT_NODE_NAME_LIST = PRESET_NODES.map((n) => n.name);

/** Preferred default selection index (Official Mainnet). */
export const DEFAULT_NODE_INDEX = 0;

/** Default fee preference (WART). Node min fee may raise this. */
export const DEFAULT_TX_FEE = "0.01";
