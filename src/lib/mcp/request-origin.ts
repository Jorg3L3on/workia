import { headers } from "next/headers";

/**
 * A Request carrying the current page's or action's host, so pages and server
 * actions resolve the same public origin (issuer, resource) as route handlers.
 */
export const currentRequest = async (path = "/") => {
  const list = await headers();
  const host =
    list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const proto =
    list.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");

  return new Request(`${proto}://${host}${path}`, { headers: list });
};
