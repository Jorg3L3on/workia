/**
 * Service worker of the employee app (W2-01), scope /mi/. It makes the app
 * installable and shows web push notices (W2-08). Every request still goes
 * to the network, nothing is cached, so a signed-out phone never shows
 * someone's data from a cache. A tap opens the notice's path in this origin.
 */
const SCRIPT = `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

const appPath = (value) =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/mi/avisos";

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "Workia";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      icon: "/icon.png",
      badge: "/icon.png",
      data: { url: appPath(data.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(appPath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client && "navigate" in client) {
          return client.navigate(url).then((page) => (page || client).focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
`;

export const GET = () =>
  new Response(SCRIPT, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-cache",
      "service-worker-allowed": "/mi/",
    },
  });
