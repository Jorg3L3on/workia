// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  argsHash,
  CONFIRMATION_TTL_MS,
  issueConfirmationToken,
  verifyConfirmationToken,
} from "./confirm";

const binding = {
  userId: "u1",
  connectionId: "c1",
  tool: "assign_asset",
  argsHash: argsHash({ asset_id: "a1", person_id: "p1" }),
};

describe("confirmation tokens (D-06)", () => {
  it("hash ignores key order and the control fields", () => {
    expect(
      argsHash({
        person_id: "p1",
        asset_id: "a1",
        idempotency_key: "k",
        confirmation_token: "t",
      }),
    ).toBe(binding.argsHash);
    expect(argsHash({ asset_id: "a1", person_id: "p2" })).not.toBe(
      binding.argsHash,
    );
  });

  it("accepts its own token for 10 minutes and nothing else", () => {
    const now = Date.now();
    const { token, expiresAt } = issueConfirmationToken(binding, now);

    expect(expiresAt.getTime() - now).toBe(CONFIRMATION_TTL_MS);
    expect(verifyConfirmationToken(token, binding, now + 60_000)).toBe(true);
    expect(
      verifyConfirmationToken(token, binding, now + CONFIRMATION_TTL_MS + 1),
    ).toBe(false);
    for (const other of [
      { ...binding, userId: "u2" },
      { ...binding, connectionId: "c2" },
      { ...binding, tool: "return_asset" },
      { ...binding, argsHash: "otro" },
    ]) {
      expect(verifyConfirmationToken(token, other, now)).toBe(false);
    }
    expect(
      verifyConfirmationToken(
        `${now + 999_999}.${token.split(".")[1]}`,
        binding,
        now,
      ),
    ).toBe(false);
    expect(verifyConfirmationToken("basura", binding, now)).toBe(false);
  });
});
