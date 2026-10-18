// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { withToolsTable } from "./tools-table";

it("docs/mcp-connector.md lists the registered tools (run npm run docs:mcp)", () => {
  const doc = readFileSync(
    path.join(process.cwd(), "docs/mcp-connector.md"),
    "utf8",
  );

  expect(withToolsTable(doc)).toBe(doc);
});
