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

const PHASE_2_WRITE_TOOLS = [
  "create_person",
  "update_person",
  "set_person_status",
  "update_person_schedule",
  "create_catalog_item",
  "link_position_activity",
  "unlink_position_activity",
  "issue_contract",
  "renew_contract",
  "mark_contract_no_renew",
  "register_asset",
  "assign_asset",
  "return_asset",
];

/** Phase 3 tools, on the app features of «Ciclo laboral México». */
const PHASE_3_READ_TOOLS = [
  "list_regions",
  "get_seniority_certificate",
  "get_onboarding",
  "get_vacation_entitlement",
  // Iniciativa 2: baja y periodos laborales.
  "list_termination_reasons",
  // WRK-I15-4: the 30-day documents tray.
  "list_expiring_documents",
];
const PHASE_3_WRITE_TOOLS = [
  "update_person_schedule_blocks",
  "decide_contract_renewal",
  "start_onboarding",
  "approve_onboarding_step",
];

const jsonSchemaOf = (schema: z.ZodType) =>
  JSON.stringify(z.toJSONSchema(schema, { target: "draft-2020-12" }));

describe("MCP tool registry coverage", () => {
  it("exposes the reads of phase 1 and the writes of phases 2 and 3", () => {
    const names = (kind: string) =>
      WORKIA_TOOLS.filter((tool) => tool.kind === kind)
        .map((tool) => tool.name)
        .sort();

    expect(names("read")).toEqual(
      [...PHASE_1_READ_TOOLS, ...PHASE_3_READ_TOOLS].sort(),
    );
    expect(names("write")).toEqual(
      [...PHASE_2_WRITE_TOOLS, ...PHASE_3_WRITE_TOOLS].sort(),
    );
  });

  it("gives every write a preview, write annotations, a write scope and an idempotency key", () => {
    for (const tool of WORKIA_TOOLS.filter(
      (candidate) => candidate.kind === "write",
    )) {
      expect(typeof tool.preview, tool.name).toBe("function");
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: false,
        idempotentHint: true,
        openWorldHint: false,
      });
      expect(tool.scope, tool.name).toMatch(/^write:/);
      expect(Object.keys(tool.input.shape), tool.name).toContain(
        "idempotency_key",
      );
      expect(Object.keys(tool.input.shape), tool.name).toContain(
        "confirmation_token",
      );
    }
  });

  it("never exposes a delete (D-07)", () => {
    expect(WORKIA_TOOLS.map((tool) => tool.name).join(" ")).not.toMatch(
      /delete|borrar|remove|eliminar/,
    );
  });

  it.each(WORKIA_TOOLS.map((tool) => [tool.name, tool]))(
    "%s declares permission, scope, annotations, Spanish description and schemas",
    (_name, tool) => {
      expect(PERMISSIONS.map((permission) => permission.slug)).toContain(
        tool.permission,
      );
      expect(MCP_SCOPES).toContain(tool.scope);
      expect(tool.annotations).toMatchObject({
        readOnlyHint: tool.kind === "read",
        openWorldHint: false,
      });
      expect(tool.description.length).toBeGreaterThan(30);
      expect(tool.output).toBeInstanceOf(z.ZodObject);
      expect(tool.input).toBeInstanceOf(z.ZodObject);
      // Never a delete, an import or an admin permission (D-07).
      expect(tool.permission).toMatch(
        tool.kind === "read" ? /:read$/ : /:(create|update)$/,
      );
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
