import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("auth cookie config", () => {
  it("declares an explicit Auth.js sessionToken cookie without useSecureCookies", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/auth.config.ts"),
      "utf8",
    );

    expect(source).toContain("authjs.session-token");
    expect(source).toContain("__Secure-");
    expect(source).toContain("httpOnly: true");
    expect(source).toContain('sameSite: "lax"');
    expect(source).toContain('path: "/"');
    expect(source).toContain("secure: useSecureAuthCookies");
    expect(source).not.toMatch(/\buseSecureCookies\s*:/);
    expect(source).not.toMatch(/\bdomain:/i);
  });
});
