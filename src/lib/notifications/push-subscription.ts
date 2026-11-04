/** A browser's PushManager subscription, checked before it is saved (W2-08). Pure. */

export type BrowserSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

const MAX_FIELD = 512;

/** A subscription as the browser sends it, or null when it is not one. */
export const parseBrowserSubscription = (
  value: unknown,
): BrowserSubscription | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  const { endpoint } = candidate;
  const p256dh = candidate.keys?.p256dh;
  const auth = candidate.keys?.auth;
  const base64url = /^[A-Za-z0-9_-]+=*$/;

  if (
    typeof endpoint !== "string" ||
    typeof p256dh !== "string" ||
    typeof auth !== "string" ||
    endpoint.length > 2048 ||
    p256dh.length > MAX_FIELD ||
    auth.length > MAX_FIELD ||
    !base64url.test(p256dh) ||
    !base64url.test(auth)
  ) {
    return null;
  }

  try {
    if (new URL(endpoint).protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }

  return { endpoint, keys: { p256dh, auth } };
};
