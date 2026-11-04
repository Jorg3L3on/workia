import { describe, expect, it } from "vitest";

import { afterFailure, MAX_ATTEMPTS, RETRY_DELAYS_MS } from "./policy";
import { parseBrowserSubscription } from "./push-subscription";

describe("retry policy", () => {
  const now = new Date("2026-11-04T12:00:00Z");

  it("waits longer after each failure", () => {
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
      expect(afterFailure(attempt, now)).toEqual({
        status: "pending",
        nextAttemptAt: new Date(now.getTime() + RETRY_DELAYS_MS[attempt - 1]!),
      });
    }
  });

  it("gives up after the last attempt", () => {
    expect(afterFailure(MAX_ATTEMPTS, now)).toEqual({
      status: "failed",
      nextAttemptAt: null,
    });
  });
});

describe("browser push subscription", () => {
  const valid = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    expirationTime: null,
    keys: {
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQ",
      auth: "tBHItJI5svbpez7KI4CCXg",
    },
  };

  it("accepts what PushManager returns", () => {
    expect(parseBrowserSubscription(valid)).toEqual({
      endpoint: valid.endpoint,
      keys: valid.keys,
    });
  });

  it.each([
    ["no https", { ...valid, endpoint: "http://push.example/1" }],
    ["no keys", { endpoint: valid.endpoint }],
    ["bad key", { ...valid, keys: { ...valid.keys, auth: "no spaces" } }],
    ["not an object", "https://push.example"],
  ])("rejects %s", (_label, value) => {
    expect(parseBrowserSubscription(value)).toBeNull();
  });
});
