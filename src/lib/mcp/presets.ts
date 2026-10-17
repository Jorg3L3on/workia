import { WRITE_SCOPES, type McpScope } from "./scopes";

/** Presets of the personal-token form (spec §6). Scopes the role cannot grant are dropped later. */
export const TOKEN_PRESETS = [
  "solo_lectura",
  "grok_lectura",
  "grok_escrituras",
  "personalizado",
] as const;

export type TokenPreset = (typeof TOKEN_PRESETS)[number];

export const tokenPresetLabels: Record<
  TokenPreset,
  { label: string; hint: string }
> = {
  solo_lectura: {
    label: "Solo lectura",
    hint: "Leer, con datos personales enmascarados. El mismo techo que ChatGPT.",
  },
  grok_lectura: {
    label: "Grok Bot · lectura",
    hint: "Leer y consultar la auditoría.",
  },
  grok_escrituras: {
    label: "Grok Bot · escrituras",
    hint: "Leer, auditoría y las escrituras que tu rol permite (cada una pide confirmación).",
  },
  personalizado: {
    label: "Personalizado",
    hint: "Elige los permisos uno por uno.",
  },
};

export const scopesForPreset = (
  preset: TokenPreset,
  custom: readonly McpScope[] = [],
): McpScope[] => {
  switch (preset) {
    case "solo_lectura":
      return ["read"];
    case "grok_lectura":
      return ["read", "audit"];
    case "grok_escrituras":
      return ["read", "audit", ...WRITE_SCOPES];
    case "personalizado":
      return [...new Set<McpScope>(["read", ...custom])];
  }
};
