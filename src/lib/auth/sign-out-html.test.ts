import { describe, expect, it } from "vitest";

import { buildSignOutHtml } from "@/lib/auth/sign-out-html";

describe("buildSignOutHtml", () => {
  it("delays navigation so Set-Cookie can commit before /login loads", () => {
    const html = buildSignOutHtml("/login");

    expect(html).toContain('content="1;url=/login"');
    expect(html).toContain(
      'setTimeout(function(){location.replace("/login");},100)',
    );
    expect(html).not.toContain('content="0;url=/login"');
    expect(html).not.toMatch(/<script>location\.replace/);
  });
});
