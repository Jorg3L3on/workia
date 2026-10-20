// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { WORKIA_TOOLS } from "@/lib/mcp/tools";

type EvalSet = {
  frases: Array<{
    id: string;
    tipo: string;
    tool: string | null;
    previa?: string[];
    alternativas?: string[];
  }>;
};

const load = (name: string) =>
  JSON.parse(
    readFileSync(path.join(process.cwd(), "evals", name), "utf8"),
  ) as EvalSet;

const names = new Set(WORKIA_TOOLS.map((tool) => tool.name));
const kind = new Map(WORKIA_TOOLS.map((tool) => [tool.name, tool.kind]));

describe("MCP eval sets", () => {
  it.each(["mcp-lectura.json", "mcp-escritura.json"])(
    "%s only names tools of the registry, with unique ids",
    (file) => {
      const set = load(file);
      const ids = set.frases.map((frase) => frase.id);
      expect(new Set(ids).size).toBe(ids.length);

      for (const frase of set.frases) {
        for (const tool of [
          frase.tool,
          ...(frase.previa ?? []),
          ...(frase.alternativas ?? []),
        ]) {
          if (tool !== null)
            expect(names, `${frase.id}: ${tool}`).toContain(tool);
        }
      }
    },
  );

  it("the writes set covers every write tool", () => {
    const covered = new Set(
      load("mcp-escritura.json").frases.flatMap((frase) => [
        frase.tool,
        ...(frase.alternativas ?? []),
      ]),
    );
    const writes = WORKIA_TOOLS.filter((tool) => tool.kind === "write").map(
      (tool) => tool.name,
    );
    expect(writes.filter((tool) => !covered.has(tool))).toEqual([]);
    for (const frase of load("mcp-escritura.json").frases) {
      if (frase.tipo === "escritura" && frase.tool) {
        expect(kind.get(frase.tool), frase.id).toBe("write");
      }
    }
  });
});
