/**
 * Paint helpers for passkey UX.
 * WebAuthn prompts can take a moment; flush React state and yield a frame so
 * spinners appear immediately on click before navigator.credentials.* blocks.
 */
import { flushSync } from "react-dom";

type BoolSetter = (v: boolean) => void;

/** Force React to commit waiting state(s), then wait until the browser can paint. */
export async function paintPasskeyWaiting(...setters: BoolSetter[]): Promise<void> {
  const list = setters.filter((s) => typeof s === "function");
  if (list.length) {
    flushSync(() => {
      for (const set of list) set(true);
    });
  }
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    } else {
      setTimeout(() => resolve(), 16);
    }
  });
}

export function clearPasskeyWaiting(...setters: BoolSetter[]): void {
  for (const set of setters) {
    if (typeof set === "function") set(false);
  }
}
