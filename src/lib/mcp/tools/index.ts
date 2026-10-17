import type { WorkiaTool } from "../run-tool";

import { getAssetTool, listAssetsTool } from "./assets";
import { listAuditEventsTool } from "./audit";
import {
  listActivitiesTool,
  listAreasTool,
  listPositionsTool,
  listSitesTool,
} from "./catalog";
import {
  getContractTool,
  listContractsTool,
  listContractTemplatesTool,
  listExpiringContractsTool,
  listRenewalTrayTool,
  previewContractTool,
} from "./contracts";
import { getPersonTool, listPeopleTool } from "./people";
import { fetchTool, searchTool } from "./search";
import { whoamiTool } from "./whoami";

/**
 * Every tool of the connector, in tools/list order. Phase 1: the 18 read
 * tools. A tool must declare its permission, scope, annotations and output
 * schema (mcp-coverage test).
 */
export const WORKIA_TOOLS: WorkiaTool[] = [
  whoamiTool,
  searchTool,
  fetchTool,
  listPeopleTool,
  getPersonTool,
  listAreasTool,
  listPositionsTool,
  listActivitiesTool,
  listSitesTool,
  listContractsTool,
  listExpiringContractsTool,
  listRenewalTrayTool,
  getContractTool,
  listContractTemplatesTool,
  previewContractTool,
  listAssetsTool,
  getAssetTool,
  listAuditEventsTool,
];
