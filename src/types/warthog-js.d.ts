declare module "warthog-js" {
  export class Address {
    readonly hex: string;
    static fromHex(hex: string): Address | null;
    static fromRaw(raw: string): Address | null;
    static validate(address: string): boolean;
  }

  export class Account {
    readonly privateKeyHex: string;
    readonly publicKeyHex: string;
    readonly address: Address;
    static fromPrivateKeyHex(hex: string): Account;
    static fromRandom(): Account;
    sign(hash: string): {
      r: string;
      s: string;
      recid: number;
      signature: string;
    };
  }

  export class TokenPrecision {
    static readonly WART: TokenPrecision;
    static readonly LIQUIDITY: TokenPrecision;
    precision: number;
    constructor(precision: number);
  }

  export class Funds {
    amount: bigint;
    static parse(string: string, digits: TokenPrecision): Funds | null;
  }

  export class Wart {
    E8: bigint;
    static parse(string: string): Wart | null;
    static fromE8(E8: bigint): Wart | null;
    roundedFee(ceil: boolean): RoundedFee;
  }

  export class Liquidity {
    E8: bigint;
    static parse(string: string): Liquidity | null;
    static fromE8(E8: bigint): Liquidity | null;
  }

  export class RoundedFee {
    E8: bigint;
    static fromE8(E8: bigint, ceil: boolean): RoundedFee | null;
    static min(): RoundedFee;
  }

  export class NonceId {
    readonly value: number;
    static fromNumber(value: number): NonceId | null;
    static random(): NonceId;
  }

  export class Price {
    static fromHex(hex: string): Price | null;
    static fromNumberPrecision(
      d: number,
      basePrec: TokenPrecision,
      ceil?: boolean,
    ): Price | null;
    toHex(): string;
  }

  export type TransactionJson = Record<string, unknown> & { type: string };

  export class TransactionContext {
    chainPin: { pinHash: string; pinHeight: number };
    fee: RoundedFee;
    nonceId: NonceId;
    transferWart(account: Account, toAddr: Address, wart: Wart): TransactionJson;
    transferAsset(
      account: Account,
      assetHash: string,
      toAddr: Address,
      amount: Funds,
    ): TransactionJson;
    transferLiquidity(
      account: Account,
      assetHash: string,
      toAddr: Address,
      units: Liquidity,
    ): TransactionJson;
    buy(
      account: Account,
      assetHash: string,
      wartAmount: Wart,
      limit: Price,
    ): TransactionJson;
    sell(
      account: Account,
      assetHash: string,
      tokenAmount: Funds,
      limit: Price,
    ): TransactionJson;
    depositLiquidity(
      account: Account,
      assetHash: string,
      tokenAmount: Funds,
      wart: Wart,
    ): TransactionJson;
    withdrawLiquidity(
      account: Account,
      assetHash: string,
      units: Liquidity,
    ): TransactionJson;
    cancelTransaction(
      account: Account,
      cancelHeight: number,
      cancelNonceId: number,
    ): TransactionJson;
    createAssets(
      account: Account,
      totalSupply: Funds,
      precision: TokenPrecision,
      name: string,
    ): TransactionJson;
  }

  export type ApiResult<T> =
    | { success: true; data: T }
    | { success: false; code: number; error: string };

  export class WarthogApi {
    constructor(baseUrl: string, options?: { proxyUrl?: string | null });
    getChainHead(): Promise<ApiResult<unknown>>;
    getMinFee(): Promise<ApiResult<{ minFee: { E8: number | bigint; str?: string } }>>;
    searchAssets(namePrefix: string, hashPrefix?: string): Promise<ApiResult<unknown>>;
    lookupAsset(assetHash: string): Promise<ApiResult<unknown>>;
    getDexMarket(assetHash: string): Promise<ApiResult<unknown>>;
    getAccountBalance(address: string): Promise<ApiResult<unknown>>;
    getAccountWartBalance(address: string): Promise<ApiResult<unknown>>;
    getAccountAssetBalance(
      address: string,
      assetHash: string,
    ): Promise<ApiResult<unknown>>;
    getOpenOrders(address: string): Promise<ApiResult<unknown>>;
    getOpenOrdersForAsset(
      address: string,
      assetHash: string,
    ): Promise<ApiResult<unknown>>;
    getAccountMempool(address: string): Promise<ApiResult<unknown>>;
    getAccountHistory(
      address: string,
      beforeTxIndex?: number | string,
    ): Promise<ApiResult<unknown>>;
    getBlock(height: number | string): Promise<ApiResult<unknown>>;
    getNodePath(path: string): Promise<ApiResult<unknown>>;
    fakeMine(address: string): Promise<ApiResult<unknown>>;
    submitTransaction(tx: TransactionJson): Promise<ApiResult<{ txHash?: string }>>;
    createTransactionContext(
      fee: RoundedFee,
      nonceId: NonceId,
    ): Promise<TransactionContext>;
  }

  export function normalizeChainPin(data: unknown): {
    pinHash: string;
    pinHeight: number;
  };

  export const KNOWN_NODES: string[];
  export function generateMnemonic(): string;
  export function encodeLimitPrice(
    priceStr: string | number,
    decimals?: number,
    opts?: { ceil?: boolean },
  ): string;
  export function isValidAssetHash(hash: string): boolean;
}
