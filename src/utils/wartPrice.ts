/**
 * WART → USD price helpers with multi-source fallback + short cache.
 * Ported from website webwallet `lib/wartPrice.js`.
 */

const CACHE_KEY = "wartUsdPriceCache";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type PriceCache = { price: number; fetchedAt: number };

let memoryCache: PriceCache | null = null;

function readStorageCache(): PriceCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PriceCache;
    if (
      parsed &&
      typeof parsed.price === "number" &&
      parsed.price > 0 &&
      typeof parsed.fetchedAt === "number"
    ) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

function writeStorageCache(entry: PriceCache): void {
  memoryCache = entry;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore quota / private mode
  }
}

function getCachedPrice(allowStale = false): number | null {
  const now = Date.now();
  const candidates = [memoryCache, readStorageCache()].filter(Boolean) as PriceCache[];
  for (const entry of candidates) {
    if (entry.price > 0 && (allowStale || now - entry.fetchedAt < CACHE_TTL_MS)) {
      memoryCache = entry;
      return entry.price;
    }
  }
  return null;
}

async function fetchFromCoinGecko(): Promise<number> {
  const envUrl = import.meta.env.VITE_APP_COINGECKO_API_URL as string | undefined;
  const url =
    envUrl ||
    "https://api.coingecko.com/api/v3/simple/price?ids=warthog&vs_currencies=usd";
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();
  const price = Number(data?.warthog?.usd);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("CoinGecko returned no price");
  }
  return price;
}

async function fetchFromCoinPaprika(): Promise<number> {
  const res = await fetch("https://api.coinpaprika.com/v1/tickers/wart-warthog", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`CoinPaprika HTTP ${res.status}`);
  const data = await res.json();
  const price = Number(data?.quotes?.USD?.price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("CoinPaprika returned no price");
  }
  return price;
}

/** Fetch current WART price in USD (cached, multi-source). */
export async function fetchWartUsdPrice(): Promise<number | null> {
  const cached = getCachedPrice(false);
  if (cached != null) return cached;

  const sources = [fetchFromCoinGecko, fetchFromCoinPaprika];
  let lastError: unknown = null;

  for (const source of sources) {
    try {
      const price = await source();
      writeStorageCache({ price, fetchedAt: Date.now() });
      return price;
    } catch (err) {
      lastError = err;
      console.warn("WART price source failed:", err);
    }
  }

  const stale = getCachedPrice(true);
  if (stale != null) return stale;

  if (lastError) {
    console.warn("All WART price sources failed", lastError);
  }
  return null;
}

/** Format a WART balance as a USD display string. */
export async function formatWartUsdBalance(
  wartBalance: string | number,
  price?: number | null,
): Promise<string> {
  const amount = Number(wartBalance);
  if (!Number.isFinite(amount) || amount <= 0) {
    return "$0.00";
  }

  const usdPrice = price != null ? price : await fetchWartUsdPrice();
  if (usdPrice == null || !(usdPrice > 0)) {
    return "N/A";
  }

  const usd = amount * usdPrice;
  if (usd < 0.01 && usd > 0) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}
