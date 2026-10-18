/**
 * Regenerates the tools table of docs/mcp-connector.md from the MCP registry,
 * so the doc never drifts from tools/list.
 *
 *   npm run docs:mcp
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// The registry imports the data layer; nothing connects at import time.
process.env.DATABASE_URL ??= "postgresql://docs:docs@127.0.0.1:5432/docs";
process.env.AUTH_SECRET ??= "docs-generation-secret-with-32-characters";

const main = async () => {
  const { withToolsTable } = await import("@/lib/mcp/tools-table");
  const file = path.join(process.cwd(), "docs/mcp-connector.md");

  writeFileSync(file, withToolsTable(readFileSync(file, "utf8")));
  console.log("docs/mcp-connector.md: tools table updated.");
  process.exit(0);
};

main();
