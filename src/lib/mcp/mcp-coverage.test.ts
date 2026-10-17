// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { PERMISSIONS } from "@/lib/db/schema/types";

import { MCP_SCOPES } from "./scopes";
import { WORKIA_TOOLS } from "./tools";

const PHASE_1_READ_TOOLS = [
  "whoami",
  "search",
  "fetch",
  "list_people",
  "get_person",
  "list_areas",
  "list_positions",
  "list_activities",
  "list_sites",
  "list_contracts",
  "list_expiring_contracts",
  "list_renewal_tray",
  "get_contract",
  "list_contract_templates",
  "preview_contract",
  "list_assets",
  "get_asset",
  "list_audit_events",
];

const jsonSchemaOf = (schema: z.ZodType) =>
  JSON.stringify(z.toJSONSchema(schema, { target: "draft-2020-12" }));

describe("MCP tool registry coverage", () => {
  it("exposes exactly the 18 read tools of phase 1, none of them a write", () => {
    expect(WORKIA_TOOLS.map((tool) => tool.name).sort()).toEqual(
      [...PHASE_1_READ_TOOLS].sort(),
    );
    expect(WORKIA_TOOLS.every((tool) => tool.kind === "read")).toBe(true);
  });

  it.each(WORKIA_TOOLS.map((tool) => [tool.name, tool]))(
    "%s declares permission, scope, annotations, Spanish description and schemas",
    (_name, tool) => {
      expect(PERMISSIONS.map((permission) => permission.slug)).toContain(
        tool.permission,
      );
      expect(MCP_SCOPES).toContain(tool.scope);
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        openWorldHint: false,
      });
      expect(tool.description.length).toBeGreaterThan(30);
      expect(tool.output).toBeInstanceOf(z.ZodObject);
      expect(tool.input).toBeInstanceOf(z.ZodObject);
      // Never a delete, an import or an admin permission (D-07).
      expect(tool.permission).toMatch(/:read$/);
    },
  );

  it("never accepts a company in any input schema (addendum §3)", () => {
    for (const tool of WORKIA_TOOLS) {
      expect(jsonSchemaOf(tool.input), tool.name).not.toMatch(/company_?id/i);
    }
  });

  it("tools never write SQL of their own (D-08)", () => {
    const folder = path.join(__dirname, "tools");

    for (const file of readdirSync(folder).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    )) {
      const source = readFileSync(path.join(folder, file), "utf8");

      expect(source, file).not.toMatch(/\.(insert|update|delete|execute)\(/);
    }
  });
});
