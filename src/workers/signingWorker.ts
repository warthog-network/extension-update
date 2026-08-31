/**
 * Holds seed/private key off the React tree. Main thread talks via postMessage.
 */
let privateKey: string | null = null;
let publicKey: string | null = null;
let address: string | null = null;
let mnemonic: string | null = null;

function normalizeHex(raw: unknown): string {
  return String(raw || "")
    .trim()
    .replace(/^0x/i, "");
}

function respond(requestId: number, payload: Record<string, unknown>) {
  self.postMessage({ requestId, ok: true, ...payload });
}

function respondError(requestId: number, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  self.postMessage({ requestId, ok: false, error: message });
}

self.onmessage = async (event: MessageEvent) => {
  const { requestId, action, payload = {} } = event.data || {};
  try {
    switch (action) {
      case "unlock": {
        const pk = normalizeHex(payload.privateKey);
        if (pk.length !== 64 || !/^[0-9a-fA-F]+$/.test(pk)) {
          throw new Error("Invalid private key");
        }
        privateKey = pk;
        publicKey = normalizeHex(payload.publicKey) || null;
        address = normalizeHex(payload.address) || null;
        mnemonic = payload.mnemonic ? String(payload.mnemonic) : null;
        respond(requestId, {
          unlocked: true,
          address,
          publicKey,
          hasMnemonic: Boolean(mnemonic),
        });
        break;
      }
      case "lock": {
        privateKey = null;
        publicKey = null;
        address = null;
        mnemonic = null;
        respond(requestId, { unlocked: false, hasMnemonic: false });
        break;
      }
      case "status": {
        respond(requestId, {
          unlocked: Boolean(privateKey),
          address,
          publicKey,
          hasMnemonic: Boolean(mnemonic),
        });
        break;
      }
      case "exportWallet": {
        if (!privateKey) throw new Error("Wallet is locked");
        respond(requestId, {
          wallet: {
            privateKey,
            publicKey,
            address,
            mnemonic,
          },
        });
        break;
      }
      default:
        throw new Error(`Unknown signing worker action: ${action}`);
    }
  } catch (error) {
    respondError(requestId, error);
  }
};
