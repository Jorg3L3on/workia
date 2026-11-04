import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * No OFFSET pagination (Workia 2.0 P-04, docs/keyset.md): new lists page with
 * the keyset helper in src/lib/db/keyset.ts. Catches Drizzle's .offset() and
 * OFFSET written in SQL strings and templates.
 */
const NO_OFFSET_MESSAGE =
  "OFFSET pagination scans every skipped row. Use defineKeyset from @/lib/db/keyset (docs/keyset.md).";

export const noOffsetRule = {
  "no-restricted-syntax": [
    "error",
    {
      selector: "CallExpression[callee.property.name='offset']",
      message: NO_OFFSET_MESSAGE,
    },
    {
      selector: "TemplateElement[value.raw=/\\boffset(\\s*$|\\s+\\d)/i]",
      message: NO_OFFSET_MESSAGE,
    },
    {
      selector: "Literal[value=/\\boffset\\s+(\\d|\\$\\d)/i]",
      message: NO_OFFSET_MESSAGE,
    },
  ],
};

/**
 * Lists written before P-04 that still page by OFFSET. They move to the keyset
 * helper later (people, audit, resguardo, import jobs); take a file off this
 * list when it does. Never add one.
 */
export const LEGACY_OFFSET_FILES = [
  "src/lib/audit/index.ts",
  "src/lib/import/jobs.ts",
  "src/lib/people/index.ts",
  "src/lib/people/list.ts",
  "src/lib/resguardo/index.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx,js,mjs}"],
    rules: noOffsetRule,
  },
  {
    files: LEGACY_OFFSET_FILES,
    rules: { "no-restricted-syntax": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
