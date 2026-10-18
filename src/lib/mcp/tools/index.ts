import type { WorkiaTool } from "../run-tool";

import { getAssetTool, listAssetsTool } from "./assets";
import {
  assignAssetTool,
  registerAssetTool,
  returnAssetTool,
} from "./assets-writes";
import { listAuditEventsTool } from "./audit";
import {
  listActivitiesTool,
  listAreasTool,
  listPositionsTool,
  listSitesTool,
  listRegionsTool,
} from "./catalog";
import {
  createCatalogItemTool,
  linkPositionActivityTool,
  unlinkPositionActivityTool,
} from "./catalog-writes";
import {
  getContractTool,
  listContractsTool,
  listContractTemplatesTool,
  listExpiringContractsTool,
  listRenewalTrayTool,
  previewContractTool,
} from "./contracts";
import {
  issueContractTool,
  markContractNoRenewTool,
  renewContractTool,
} from "./contracts-writes";
import { getPersonTool, listPeopleTool } from "./people";
import {
  createPersonTool,
  setPersonStatusTool,
  updatePersonScheduleTool,
  updatePersonScheduleBlocksTool,
  updatePersonTool,
} from "./people-writes";
import { fetchTool, searchTool } from "./search";
import { whoamiTool } from "./whoami";

/**
 * Every tool of the connector, in tools/list order: the 18 reads of phase 1
 * and the 13 writes of phase 2. A tool must declare its permission, scope,
 * annotations and output schema; a write also its preview (mcp-coverage).
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
  listRegionsTool,
  listContractsTool,
  listExpiringContractsTool,
  listRenewalTrayTool,
  getContractTool,
  listContractTemplatesTool,
  previewContractTool,
  listAssetsTool,
  getAssetTool,
  listAuditEventsTool,
  // Phase 2: writes (preview + confirmation + idempotency).
  createPersonTool,
  updatePersonTool,
  setPersonStatusTool,
  updatePersonScheduleTool,
  updatePersonScheduleBlocksTool,
  createCatalogItemTool,
  linkPositionActivityTool,
  unlinkPositionActivityTool,
  issueContractTool,
  renewContractTool,
  markContractNoRenewTool,
  registerAssetTool,
  assignAssetTool,
  returnAssetTool,
];
