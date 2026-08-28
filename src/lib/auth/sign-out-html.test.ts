import { describe, expect, it } from "vitest";

import {
  SIGN_OUT_NAVIGATION_DELAY_MS,
  buildSignOutHtml,
} from "@/lib/auth/sign-out-html";

describe("buildSignOutHtml", () => {
  it("delays a full-load replace to the absolute /login URL", () => {
    const html = buildSignOutHtml("/login", "https://workia.local");

    expect(html).toContain('content="1;url=https://workia.local/login"');
    expect(html).toContain(
      `setTimeout(function(){window.location.replace("https://workia.local/login");},${SIGN_OUT_NAVIGATION_DELAY_MS})`,
    );
    expect(SIGN_OUT_NAVIGATION_DELAY_MS).toBeGreaterThanOrEqual(100);
    expect(SIGN_OUT_NAVIGATION_DELAY_MS).toBeLessThanOrEqual(300);
    expect(html).not.toContain("/app");
    expect(html).not.toContain('location.replace("/login")');
    expect(html).not.toContain('content="0;url=');
    expect(html).not.toMatch(/<script>window\.location\.replace/);
  });
});
