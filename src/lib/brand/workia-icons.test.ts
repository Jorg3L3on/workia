import { describe, expect, it } from "vitest";

import { workiaIcons } from "@/lib/brand/workia-icons";

describe("workiaIcons", () => {
  it("reuses the Workia mark files on every surface", () => {
    const iconUrls = workiaIcons.icon.map((icon) => icon.url);
    const appleUrls = workiaIcons.apple.map((icon) => icon.url);

    expect(iconUrls).toContain("/favicon.ico");
    expect(iconUrls).toContain("/icon.png");
    expect(iconUrls).toContain("/icon-192.png");
    expect(appleUrls).toContain("/apple-icon.png");
    expect(appleUrls).toContain("/apple-touch-icon.png");
    expect(workiaIcons.shortcut[0]?.url).toBe("/favicon.ico");
  });
});
