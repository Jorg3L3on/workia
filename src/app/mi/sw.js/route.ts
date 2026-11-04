/**
 * Service worker of the employee app (W2-01), scope /mi/. It only makes the
 * app installable: every request still goes to the network, nothing is
 * cached, so a signed-out phone never shows someone's data from a cache.
 */
const SCRIPT = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
`;

export const GET = () =>
  new Response(SCRIPT, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
      "service-worker-allowed": "/mi/",
    },
  });
