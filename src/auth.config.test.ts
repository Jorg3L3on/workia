import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("auth cookie config", () => {
  it("keeps Auth.js session cookie identity and does not set Domain or Max-Age", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/auth.config.ts"),
      "utf8",
    );
    const sessionTokenOptions = source.match(
      /sessionToken:\s*\{\s*options:\s*\{([^}]+)\}/,
    )?.[1];

    expect(sessionTokenOptions).toBeTruthy();
    expect(sessionTokenOptions).toContain("httpOnly: true");
    expect(sessionTokenOptions).toContain('sameSite: "lax"');
    expect(sessionTokenOptions).toContain('path: "/"');
    expect(sessionTokenOptions).toContain(
      'secure: env.NODE_ENV === "production"',
    );
    expect(sessionTokenOptions).not.toMatch(/maxAge/i);
    expect(sessionTokenOptions).not.toMatch(/domain/i);
    expect(source).toMatch(/sessionToken:\s*\{\s*options:/);
    expect(source).not.toMatch(/\buseSecureCookies\s*:/);
  });
});
