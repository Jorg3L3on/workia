// @vitest-environment node
import { describe, expect, it } from "vitest";

import { toolLabel } from "./tool-labels";
import { WORKIA_TOOLS } from "./tools";

describe("toolLabel", () => {
  it("names the tools in Spanish", () => {
    expect(toolLabel("whoami")).toBe("Identidad");
    expect(toolLabel("register_asset")).toBe("Registrar activo");
  });

  it("has a label for every tool the connector exposes", () => {
    for (const tool of WORKIA_TOOLS) {
      expect(toolLabel(tool.name), tool.name).not.toBe(tool.name);
    }
  });
});
