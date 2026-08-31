/**
 * Request optional host access for custom node URLs (user gesture).
 * Built-in hosts are already in manifest host_permissions.
 */
import browser from "webextension-polyfill";

function originPattern(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

export async function hasHostPermission(url: string): Promise<boolean> {
  const origin = originPattern(url);
  if (!origin) return false;
  try {
    if (!browser.permissions?.contains) return true;
    return await browser.permissions.contains({ origins: [origin] });
  } catch {
    return true;
  }
}

/** Prompt for a custom origin. Must run from a user gesture. */
export async function ensureHostPermission(url: string): Promise<boolean> {
  const origin = originPattern(url);
  if (!origin) return false;
  try {
    if (!browser.permissions?.contains || !browser.permissions?.request) {
      return true;
    }
    if (await browser.permissions.contains({ origins: [origin] })) {
      return true;
    }
    return await browser.permissions.request({ origins: [origin] });
  } catch (err) {
    console.warn("[warthog] host permission request failed:", err);
    return false;
  }
}

export function hostPermissionError(url: string): string {
  return `This extension does not have permission to reach ${url}. Add the node again and allow access when Chrome asks.`;
}
