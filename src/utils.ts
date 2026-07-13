const formatWalletAddress = (
  address: string,
  startLength: number = 10,
  endLength: number = 10,
): string => {
  if (!address) return "";
  if (address.length <= startLength + endLength) return address;
  return `${address.slice(0, startLength)}....${address.slice(-endLength)}`;
};

/** Account address helper compatible with warthog-ts Account. */
const accountAddress = (account: { address?: { hex?: string }; getAddress?: () => string }): string => {
  if (account?.address?.hex) return account.address.hex;
  if (typeof account?.getAddress === "function") return account.getAddress();
  return "";
};

/** Account private key helper compatible with warthog-ts Account. */
const accountPrivateKeyHex = (account: {
  privateKeyHex?: string;
  getPrivateKeyHex?: () => string;
}): string => {
  if (account?.privateKeyHex) return account.privateKeyHex;
  if (typeof account?.getPrivateKeyHex === "function") return account.getPrivateKeyHex();
  return "";
};

export { formatWalletAddress, accountAddress, accountPrivateKeyHex };
