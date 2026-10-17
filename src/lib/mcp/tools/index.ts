import type { WorkiaTool } from "../run-tool";

import { whoamiTool } from "./whoami";

/**
 * Every tool of the connector, in tools/list order. A tool must declare its
 * permission, scope, annotations and output schema (mcp-coverage test).
 */
export const WORKIA_TOOLS: WorkiaTool[] = [whoamiTool];
