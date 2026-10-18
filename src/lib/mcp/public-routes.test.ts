// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const appDir = path.join(process.cwd(), "src/app");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const routes = walk(appDir)
  .filter((file) => file.endsWith("route.ts"))
  .map((file) => ({
    route:
      "/" + path.relative(appDir, path.dirname(file)).split(path.sep).join("/"),
    source: readFileSync(file, "utf8"),
  }));

/** Routes that answer without a Workia session (WRK-I1 adds only these). */
const PUBLIC_MCP_ROUTES = [
  "/.well-known/oauth-authorization-server/[[...path]]",
  "/.well-known/oauth-protected-resource/[[...path]]",
  "/api/mcp",
  "/api/oauth/authorize",
  "/api/oauth/register",
  "/api/oauth/revoke",
  "/api/oauth/token",
];

/** A route is guarded when it goes through the company context or Auth.js. */
const isSessionGuarded = (source: string) =>
  /require(CompanyContext|Auth|PeopleImport|PeopleExport|[A-Z]\w*(Read|Create|Update|Delete|Import|Export))\b|requireImportRoute|withImportRoute|auth\(\)/.test(
    source,
  );

describe("public routes", () => {
  it("adds only /api/mcp, /api/oauth/* and /.well-known/* as routes without a session", () => {
    const unguarded = routes
      .filter(({ route }) => !route.startsWith("/api/auth"))
      .filter(({ source }) => !isSessionGuarded(source))
      .map(({ route }) => route)
      .sort();

    expect(unguarded).toEqual(PUBLIC_MCP_ROUTES);
  });

  it("puts every public MCP route behind MCP_ENABLED", () => {
    for (const { route, source } of routes.filter((r) =>
      PUBLIC_MCP_ROUTES.includes(r.route),
    )) {
      expect(source, route).toMatch(/whenEnabled|isMcpEnabled/);
    }
  });
});
