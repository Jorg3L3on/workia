import { scopeLabels } from "./scopes";
import { WORKIA_TOOLS } from "./tools";

export const TOOLS_TABLE_START = "<!-- tools:start (npm run docs:mcp) -->";
export const TOOLS_TABLE_END = "<!-- tools:end -->";

const firstSentence = (text: string) => {
  const match = text.match(/^(.+?[.!?])(\s|$)/);
  return (match ? match[1] : text).replace(/\|/g, "\\|");
};

/** The tools table of docs/mcp-connector.md, generated from the registry. */
export const renderToolsTable = () =>
  [
    TOOLS_TABLE_START,
    "<!-- prettier-ignore-start -->",
    "",
    "| Herramienta | Qué hace | Scope | Permiso |",
    "| --- | --- | --- | --- |",
    ...WORKIA_TOOLS.map(
      (tool) =>
        `| \`${tool.name}\` | ${firstSentence(tool.description)} | \`${tool.scope}\` (${scopeLabels[tool.scope].label}) | \`${tool.permission}\` |`,
    ),
    "",
    "<!-- prettier-ignore-end -->",
    TOOLS_TABLE_END,
  ].join("\n");

/** Replaces the table between the markers. */
export const withToolsTable = (markdown: string) => {
  const start = markdown.indexOf(TOOLS_TABLE_START);
  const end = markdown.indexOf(TOOLS_TABLE_END);

  if (start === -1 || end === -1) {
    throw new Error("docs/mcp-connector.md has no tools table markers");
  }

  return (
    markdown.slice(0, start) +
    renderToolsTable() +
    markdown.slice(end + TOOLS_TABLE_END.length)
  );
};
