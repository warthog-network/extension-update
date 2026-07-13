/**
 * Chrome extension popups close when a native file picker steals focus.
 *
 * File-login flow:
 *  1. Open a full helper tab (file picker works)
 *  2. On success: persist session, open a 410×640 popup window
 *  3. Only then close the helper tab
 *
 * Do NOT use chrome.action.openPopup() here — it often no-ops from a tab,
 * and we previously closed the helper afterward, leaving the user logged in
 * with no UI.
 */
import browser from "webextension-polyfill";

const HELPER_FLAG = "warthogHelperTab";
const COMPACT_SHELL_FLAG = "warthogCompactShell";

/** True when this document is the browser action popup (small, temporary). */
export function isExtensionPopup(): boolean {
  try {
    const chromeApi = (
      globalThis as {
        chrome?: {
          extension?: {
            getViews?: (opts: { type: string }) => Window[];
          };
        };
      }
    ).chrome;
    const views = chromeApi?.extension?.getViews?.({ type: "popup" });
    if (views && views.includes(window)) return true;
  } catch {
    // ignore
  }

  const isExt =
    typeof location !== "undefined" &&
    (location.protocol === "chrome-extension:" ||
      location.protocol === "moz-extension:");
  return isExt && window.innerWidth <= 450 && window.innerHeight <= 650;
}

export function isHelperTab(): boolean {
  try {
    if (sessionStorage.getItem(HELPER_FLAG) === "1") return true;
    const hash = location.hash || "";
    return /[?&]helper=1(?:&|$)/.test(hash) || hash.includes("helper=1");
  } catch {
    return false;
  }
}

export function markHelperTab(): void {
  try {
    sessionStorage.setItem(HELPER_FLAG, "1");
  } catch {
    // ignore
  }
}

export function clearHelperTab(): void {
  try {
    sessionStorage.removeItem(HELPER_FLAG);
  } catch {
    // ignore
  }
}

export function isCompactShellPreferred(): boolean {
  try {
    return sessionStorage.getItem(COMPACT_SHELL_FLAG) === "1";
  } catch {
    return false;
  }
}

export function clearCompactShellPreferred(): void {
  try {
    sessionStorage.removeItem(COMPACT_SHELL_FLAG);
  } catch {
    // ignore
  }
}

export function applyExtensionShellClass(forceCompact = false): void {
  try {
    const compact =
      forceCompact || isExtensionPopup() || isCompactShellPreferred();
    document.documentElement.classList.toggle("extension-popup", compact);
    document.documentElement.classList.toggle("extension-tab", !compact);
    if (
      compact &&
      (forceCompact || isCompactShellPreferred()) &&
      !isExtensionPopup()
    ) {
      document.documentElement.classList.add("extension-centered");
    } else {
      document.documentElement.classList.remove("extension-centered");
    }
  } catch {
    // ignore
  }
}

/** URL for the logged-in home screen (hash router). */
export function getWalletHomeUrl(): string {
  // Hash must be appended after getURL path (not inside it)
  return `${browser.runtime.getURL("index.html")}#/home`;
}

/**
 * Open an extension route in a dedicated helper tab (full page for file picker).
 */
export function openExtensionRouteInTab(routePath: string): void {
  const path = routePath.startsWith("/") ? routePath : `/${routePath}`;
  const sep = path.includes("?") ? "&" : "?";
  const hash = `#${path}${sep}helper=1`;

  let url: string;
  try {
    url = `${browser.runtime.getURL("index.html")}${hash}`;
  } catch {
    window.location.hash = `${path}${sep}helper=1`;
    markHelperTab();
    applyExtensionShellClass(false);
    return;
  }

  browser.tabs
    .create({ url })
    .then(() => {
      try {
        window.close(); // close toolbar popup only
      } catch {
        // ignore
      }
    })
    .catch(() => {
      window.open(url, "_blank");
      try {
        window.close();
      } catch {
        // ignore
      }
    });
}

export type ReopenResult =
  | { ok: true; mode: "window" | "tab" }
  | { ok: false; error: string };

/**
 * Create a normal-size wallet popup window. Returns only after the window exists.
 * Does not close the current tab — caller decides.
 */
export async function openWalletPopupWindow(): Promise<ReopenResult> {
  const homeUrl = getWalletHomeUrl();
  const createOpts = {
    url: homeUrl,
    type: "popup" as const,
    width: 420,
    height: 660,
    focused: true,
  };

  // 1) webextension-polyfill
  try {
    const win = await browser.windows.create(createOpts);
    if (win && (win.id != null || win.tabs?.length)) {
      return { ok: true, mode: "window" };
    }
  } catch (err) {
    console.warn("[warthog] browser.windows.create failed:", err);
  }

  // 2) raw chrome.windows (callback API)
  try {
    const chromeApi = (
      globalThis as {
        chrome?: {
          windows?: {
            create: (
              opts: Record<string, unknown>,
              cb?: (w: { id?: number } | undefined) => void,
            ) => void;
          };
          runtime?: { lastError?: { message?: string } };
        };
      }
    ).chrome;

    if (chromeApi?.windows?.create) {
      const win = await new Promise<{ id?: number } | undefined>(
        (resolve, reject) => {
          chromeApi.windows!.create(createOpts, (w) => {
            const lastErr = chromeApi.runtime?.lastError;
            if (lastErr?.message) {
              reject(new Error(lastErr.message));
              return;
            }
            resolve(w);
          });
        },
      );
      if (win?.id != null) {
        return { ok: true, mode: "window" };
      }
    }
  } catch (err) {
    console.warn("[warthog] chrome.windows.create failed:", err);
  }

  // 3) window.open as popup features
  try {
    const features = "popup=yes,width=420,height=660,left=80,top=80";
    const opened = window.open(homeUrl, "warthog_wallet", features);
    if (opened) {
      try {
        opened.focus();
      } catch {
        // ignore
      }
      return { ok: true, mode: "window" };
    }
  } catch (err) {
    console.warn("[warthog] window.open failed:", err);
  }

  // 4) last resort: normal tab (still better than nothing)
  try {
    await browser.tabs.create({ url: homeUrl, active: true });
    return { ok: true, mode: "tab" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message || "Could not open wallet window" };
  }
}

/**
 * After successful file login: open popup window, then close this helper tab.
 * Never closes the helper until a new UI is confirmed open.
 */
export async function reopenPopupWindowAndCloseHelper(): Promise<ReopenResult> {
  clearHelperTab();
  clearCompactShellPreferred();

  const result = await openWalletPopupWindow();
  if (!result.ok) {
    return result;
  }

  // Give the new window a moment to start loading before we tear down this tab
  await new Promise((r) => setTimeout(r, 150));
  await closeCurrentHelperTab();
  return result;
}

async function closeCurrentHelperTab(): Promise<void> {
  try {
    const tab = await browser.tabs.getCurrent();
    if (tab?.id != null) {
      await browser.tabs.remove(tab.id);
      return;
    }
  } catch {
    // ignore
  }
  try {
    window.close();
  } catch {
    // ignore
  }
}

/** Navigate inside the app, or open a tab when a file picker is required from popup. */
export function navigateOrOpenForFile(
  routePath: string,
  navigate: (path: string) => void,
): void {
  if (isExtensionPopup()) {
    openExtensionRouteInTab(routePath);
    return;
  }
  navigate(routePath);
}
