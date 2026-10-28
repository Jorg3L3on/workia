# Matriz de acceso cruzado (IDOR)

Cada superficie protegida de Workia y la prueba que demuestra que la sesión de
la empresa B no puede leer ni cambiar datos de la empresa A (y, en las
escrituras, que un rol sin el permiso no puede). Plania: WRK-I4-15.

- **Superficies:** `npm run check:idor` las descubre del código (acciones de
  servidor, métodos de rutas, funciones de `src/lib` que reciben `companyId` y
  herramientas MCP del registro)
  y falla si alguna no tiene fila aquí, si una fila ✅ no tiene una prueba con
  ese título en `src/test/idor/*.db.test.ts`, si una escritura no tiene su
  prueba `rbac:<superficie>` o si una fila ya no existe en el código.
- **Pruebas:** `npm run test:db` (Postgres local; CI usa su servicio). Las
  fixtures (`src/test/idor/fixtures.ts`) crean dos empresas completas.
- **Negación esperada:** lecturas → `null`, lista vacía o sin ids de A; rutas →
  404; acciones → error o redirección sin efectos (se compara una foto de los
  datos de A antes y después); un rol sin permiso → «permiso»/403.

**Leyenda:** ✅ cubierta · ⏭️ exenta (con motivo)

## Acciones de servidor

| Superficie                                                 | Estado | Prueba                                                                                                 | Permiso                     |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ | --------------------------- |
| `action:catalog/assignActivityToPositionAction`            | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `positions:update`          |
| `action:catalog/createActivityAction`                      | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `positions:create`          |
| `action:catalog/createAreaAction`                          | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `areas:create`              |
| `action:catalog/createPositionAction`                      | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `positions:create`          |
| `action:catalog/deleteActivityAction`                      | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `positions:delete`          |
| `action:catalog/deleteAreaAction`                          | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `areas:delete`              |
| `action:catalog/deletePositionAction`                      | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `positions:delete`          |
| `action:catalog/unassignActivityFromPositionAction`        | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `positions:update`          |
| `action:catalog/updateActivityAction`                      | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `positions:update`          |
| `action:catalog/updateAreaAction`                          | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `areas:update`              |
| `action:catalog/updatePositionAction`                      | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `positions:update`          |
| `action:contracts/addOfficialTemplatesAction`              | ✅     | `src/test/idor/official-templates.db.test.ts`                                                          | `contract_templates:create` |
| `action:contracts/createContractAction`                    | ✅     | `src/test/idor/contracts.db.test.ts`                                                                   | `contracts:create`          |
| `action:contracts/createContractTemplateAction`            | ✅     | `src/test/idor/contracts.db.test.ts`                                                                   | `contract_templates:create` |
| `action:contracts/deactivateContractTemplateAction`        | ✅     | `src/test/idor/contracts.db.test.ts`                                                                   | `contract_templates:delete` |
| `action:contracts/decideContractRenewalAction`             | ✅     | `src/test/idor/renewal-decision.db.test.ts`                                                            | `contracts:update`          |
| `action:contracts/deleteContractTemplateAction`            | ✅     | `src/test/idor/contracts.db.test.ts`                                                                   | `contract_templates:delete` |
| `action:contracts/noRenewContractAction`                   | ✅     | `src/test/idor/contracts.db.test.ts`                                                                   | `contracts:update`          |
| `action:contracts/updateContractTemplateAction`            | ✅     | `src/test/idor/contracts.db.test.ts`                                                                   | `contract_templates:update` |
| `action:documents/recordDeliveryAction`                    | ✅     | `src/test/idor/documents.db.test.ts`                                                                   | `documents:manage`          |
| `action:documents/setRequirementsAction`                   | ✅     | `src/test/idor/documents.db.test.ts`                                                                   | `documents:manage`          |
| `action:mcp/approveConsentAction`                          | ✅     | `src/test/idor/mcp.db.test.ts`                                                                         | `mcp_connections:create`    |
| `action:mcp/createPersonalTokenAction`                     | ✅     | `src/test/idor/mcp.db.test.ts`                                                                         | `mcp_connections:create`    |
| `action:mcp/denyConsentAction`                             | ✅     | `src/test/idor/mcp.db.test.ts`                                                                         | —                           |
| `action:mcp/hideConnectionAction`                          | ✅     | `src/test/idor/mcp.db.test.ts`                                                                         | `mcp_connections:create`    |
| `action:mcp/revokeConnectionAction`                        | ✅     | `src/test/idor/mcp.db.test.ts`                                                                         | `mcp_connections:create`    |
| `action:mcp/setWritesEnabledAction`                        | ✅     | `src/test/idor/mcp-writes.db.test.ts`                                                                  | `mcp_connections:manage`    |
| `action:onboarding/approveOnboardingAction`                | ✅     | `src/test/idor/onboarding.db.test.ts`                                                                  | `people:update`             |
| `action:onboarding/rejectOnboardingAction`                 | ✅     | `src/test/idor/onboarding.db.test.ts`                                                                  | `payroll:approve`           |
| `action:onboarding/startOnboardingAction`                  | ✅     | `src/test/idor/onboarding.db.test.ts`                                                                  | `people:update`             |
| `action:onboarding/updateOnboardingAction`                 | ✅     | `src/test/idor/onboarding.db.test.ts`                                                                  | `people:update`             |
| `action:people/assertPeopleListAccess`                     | ⏭️     | Exento: guard de lectura sin datos (requirePeopleRead); la lista la cubre lib:people/listPeoplePage    | `people:read`               |
| `action:people/countPeopleFilterAction`                    | ✅     | `src/test/idor/people-filter.db.test.ts`                                                               | `people:read`               |
| `action:people/countPeopleFilterOptionsAction`             | ✅     | `src/test/idor/people-filter.db.test.ts`                                                               | `people:read`               |
| `action:people/createPeopleViewAction`                     | ✅     | `src/test/idor/people-views.db.test.ts`                                                                | `people:read`               |
| `action:people/createPersonAction`                         | ✅     | `src/test/idor/people.db.test.ts`                                                                      | `people:create`             |
| `action:people/deletePeopleViewAction`                     | ✅     | `src/test/idor/people-views.db.test.ts`                                                                | `people:read`               |
| `action:people/deletePersonAction`                         | ✅     | `src/test/idor/people.db.test.ts`                                                                      | `people:delete`             |
| `action:people/searchManagerOptionsAction`                 | ✅     | `src/test/idor/people.db.test.ts`                                                                      | `people:read`               |
| `action:people/searchPeopleForPaletteAction`               | ✅     | `src/test/idor/people.db.test.ts`                                                                      | `people:read`               |
| `action:people/setPersonStatusAction`                      | ✅     | `src/test/idor/people.db.test.ts`                                                                      | `people:update`             |
| `action:people/updateFiniquitoAction`                      | ✅     | `src/test/idor/employment.db.test.ts`                                                                  | `people:update`             |
| `action:people/updatePeopleViewAction`                     | ✅     | `src/test/idor/people-views.db.test.ts`                                                                | `people:read`               |
| `action:people/updatePersonAction`                         | ✅     | `src/test/idor/people.db.test.ts`                                                                      | `people:update`             |
| `action:regions/createRegionAction`                        | ✅     | `src/test/idor/regions.db.test.ts`                                                                     | `sites:create`              |
| `action:regions/deleteRegionAction`                        | ✅     | `src/test/idor/regions.db.test.ts`                                                                     | `sites:delete`              |
| `action:regions/updateRegionAction`                        | ✅     | `src/test/idor/regions.db.test.ts`                                                                     | `sites:update`              |
| `action:resguardo/assertAssetsListAccess`                  | ⏭️     | Exento: guard de lectura sin datos (requireAssetsRead); la lista la cubre lib:resguardo/listAssetsPage | `assets:read`               |
| `action:resguardo/assignAssetAction`                       | ✅     | `src/test/idor/resguardo.db.test.ts`                                                                   | `assets:update`             |
| `action:resguardo/createAssetAction`                       | ✅     | `src/test/idor/resguardo.db.test.ts`                                                                   | `assets:create`             |
| `action:resguardo/deleteAssetAction`                       | ✅     | `src/test/idor/resguardo.db.test.ts`                                                                   | `assets:delete`             |
| `action:resguardo/returnAssetAction`                       | ✅     | `src/test/idor/resguardo.db.test.ts`                                                                   | `assets:update`             |
| `action:sites/createSiteAction`                            | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `sites:create`              |
| `action:sites/deleteSiteAction`                            | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `sites:delete`              |
| `action:sites/setSiteRegionAction`                         | ✅     | `src/test/idor/regions.db.test.ts`                                                                     | `sites:update`              |
| `action:sites/updateSiteAction`                            | ✅     | `src/test/idor/catalog.db.test.ts`                                                                     | `sites:update`              |
| `action:tenant/addMemberAction`                            | ✅     | `src/test/idor/tenant.db.test.ts`                                                                      | `members:manage`            |
| `action:tenant/changeMemberRoleAction`                     | ✅     | `src/test/idor/tenant.db.test.ts`                                                                      | `members:manage`            |
| `action:tenant/createCompanyAction`                        | ✅     | `src/test/idor/tenant.db.test.ts`                                                                      | `companies:manage`          |
| `action:tenant/revokeMemberAction`                         | ✅     | `src/test/idor/tenant.db.test.ts`                                                                      | `members:manage`            |
| `action:tenant/setCompanyStatusAction`                     | ✅     | `src/test/idor/tenant.db.test.ts`                                                                      | `companies:manage`          |
| `action:tenant/switchCompanyAction`                        | ✅     | `src/test/idor/tenant.db.test.ts`                                                                      | —                           |
| `action:tenant/updateCompanyAction`                        | ✅     | `src/test/idor/tenant.db.test.ts`                                                                      | `companies:manage`          |
| `action:termination-reasons/createTerminationReasonAction` | ✅     | `src/test/idor/employment.db.test.ts`                                                                  | `settings:update`           |
| `action:termination-reasons/deleteTerminationReasonAction` | ✅     | `src/test/idor/employment.db.test.ts`                                                                  | `settings:update`           |
| `action:termination-reasons/updateTerminationReasonAction` | ✅     | `src/test/idor/employment.db.test.ts`                                                                  | `settings:update`           |
| `action:reports/setTurnoverGoalAction`                     | ✅     | `src/test/idor/turnover.db.test.ts`                                                                    | `settings:update`           |
| `action:reports/createTurnoverViewAction`                  | ✅     | `src/test/idor/turnover.db.test.ts`                                                                    | `reports:read`              |
| `action:reports/deleteTurnoverViewAction`                  | ✅     | `src/test/idor/turnover.db.test.ts`                                                                    | `reports:read`              |

## Rutas

| Superficie                                                      | Estado | Prueba                                  | Permiso                                |
| --------------------------------------------------------------- | ------ | --------------------------------------- | -------------------------------------- |
| `route:DELETE /api/import/personas/[jobId]/apply`               | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |
| `route:DELETE /api/mcp`                                         | ✅     | `src/test/idor/mcp.db.test.ts`          | —                                      |
| `route:GET /.well-known/oauth-authorization-server/[[...path]]` | ✅     | `src/test/idor/mcp.db.test.ts`          | —                                      |
| `route:GET /.well-known/oauth-protected-resource/[[...path]]`   | ✅     | `src/test/idor/mcp.db.test.ts`          | —                                      |
| `route:GET /api/import/personas/[jobId]`                        | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |
| `route:GET /api/import/personas/[jobId]/errors`                 | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |
| `route:GET /api/import/personas/[jobId]/rows`                   | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |
| `route:GET /api/import/personas/[jobId]/undo`                   | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |
| `route:GET /api/mcp`                                            | ✅     | `src/test/idor/mcp.db.test.ts`          | —                                      |
| `route:GET /api/oauth/authorize`                                | ✅     | `src/test/idor/mcp.db.test.ts`          | —                                      |
| `route:GET /app/personas/[id]/contratos/[contractId]/pdf`       | ✅     | `src/test/idor/contract-pdf.db.test.ts` | `contracts:read` + `compensation:read` |
| `route:GET /app/personas/exportar`                              | ✅     | `src/test/idor/import.db.test.ts`       | `people:export`                        |
| `route:GET /app/reportes/rotacion/exportar`                     | ✅     | `src/test/idor/turnover.db.test.ts`     | `reports:read` + `people:export`       |
| `route:GET /app/personas/plantilla`                             | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |
| `route:POST /api/import/personas`                               | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |
| `route:POST /api/import/personas/[jobId]/apply`                 | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |
| `route:POST /api/import/personas/[jobId]/finalize`              | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |
| `route:POST /api/import/personas/[jobId]/rows`                  | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |
| `route:POST /api/import/personas/[jobId]/undo`                  | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |
| `route:POST /api/import/personas/[jobId]/validate`              | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |
| `route:POST /api/mcp`                                           | ✅     | `src/test/idor/mcp.db.test.ts`          | —                                      |
| `route:POST /api/oauth/register`                                | ✅     | `src/test/idor/mcp.db.test.ts`          | —                                      |
| `route:POST /api/oauth/revoke`                                  | ✅     | `src/test/idor/mcp.db.test.ts`          | —                                      |
| `route:POST /api/oauth/token`                                   | ✅     | `src/test/idor/mcp.db.test.ts`          | —                                      |
| `route:PUT /api/import/personas/[jobId]/validate`               | ✅     | `src/test/idor/import.db.test.ts`       | `people:import`                        |

## Funciones de datos (lib)

| Superficie                                                    | Estado | Prueba                                        | Permiso |
| ------------------------------------------------------------- | ------ | --------------------------------------------- | ------- |
| `lib:audit/listAuditActors`                                   | ✅     | `src/test/idor/tenant.db.test.ts`             | —       |
| `lib:audit/listAuditEventsKeyset`                             | ✅     | `src/test/idor/mcp-tools.db.test.ts`          | —       |
| `lib:catalog/assignActivityToPosition`                        | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/countCatalogReferences`                          | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/createActivity`                                  | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/createArea`                                      | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/createPosition`                                  | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/getActivityById`                                 | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/getAreaById`                                     | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/getPositionById`                                 | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/listActiveAreas`                                 | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/listActivePositions`                             | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/listActivitiesByPositionIds`                     | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/listActivitiesForPersonPosition`                 | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/listActivitiesForPosition`                       | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/listActivities`                                  | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/listAreas`                                       | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/listAssignableActivities`                        | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/listPositions`                                   | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/softDeleteActivity`                              | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/softDeleteArea`                                  | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/softDeletePosition`                              | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/unassignActivityFromPosition`                    | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/updateActivity`                                  | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/updateArea`                                      | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:catalog/updatePosition`                                  | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:contracts/addOfficialTemplates`                          | ✅     | `src/test/idor/official-templates.db.test.ts` | —       |
| `lib:contracts/countRenewalTrayItems`                         | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/createContractTemplate`                        | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/createContract`                                | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/deactivateContractTemplate`                    | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/decideContractRenewal`                         | ✅     | `src/test/idor/renewal-decision.db.test.ts`   | —       |
| `lib:contracts/getContractById`                               | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/getContractTemplateById`                       | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/getSeniorityCertificate`                       | ✅     | `src/test/idor/official-templates.db.test.ts` | —       |
| `lib:contracts/getVigenteContractForPerson`                   | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/listActiveContractTemplates`                   | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/listContractTemplates`                         | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/listContractsByPerson`                         | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/listContractsKeyset`                           | ✅     | `src/test/idor/mcp-tools.db.test.ts`          | —       |
| `lib:contracts/listExpiringContracts`                         | ✅     | `src/test/idor/mcp-tools.db.test.ts`          | —       |
| `lib:contracts/listRenewalTrayItems`                          | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/markContractNoRenew`                           | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/previewContract`                               | ✅     | `src/test/idor/mcp-tools.db.test.ts`          | —       |
| `lib:contracts/renewContract`                                 | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/softDeleteContractTemplate`                    | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/softDeleteContract`                            | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:contracts/updateContractTemplate`                        | ✅     | `src/test/idor/contracts.db.test.ts`          | —       |
| `lib:documents/activateDocumentRequirements`                  | ✅     | `src/test/idor/documents.db.test.ts`          | —       |
| `lib:documents/getDocumentRequirementById`                    | ✅     | `src/test/idor/documents.db.test.ts`          | —       |
| `lib:documents/listDocumentRequirements`                      | ✅     | `src/test/idor/documents.db.test.ts`          | —       |
| `lib:documents/listPersonDocuments`                           | ✅     | `src/test/idor/documents.db.test.ts`          | —       |
| `lib:documents/recordDelivery`                                | ✅     | `src/test/idor/documents.db.test.ts`          | —       |
| `lib:documents/setRequirements`                               | ✅     | `src/test/idor/documents.db.test.ts`          | —       |
| `lib:import/apply/applyJobStep`                               | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/apply/pauseApply`                                 | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/error-report/buildErrorReport`                    | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/error-report/loadErrorRows`                       | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/jobs/appendImportRows`                            | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/jobs/countStagedRows`                             | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/jobs/createImportJob`                             | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/jobs/finalizeImportUpload`                        | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/jobs/findJobsByHash`                              | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/jobs/getImportJob`                                | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/jobs/listImportJobs`                              | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/jobs/listImportRows`                              | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/route-helpers/loadUploadingJob`                   | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/undo/previewUndo`                                 | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/undo/undoJobStep`                                 | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/validate/countJobRows`                            | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/validate/loadCatalogIndex`                        | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/validate/loadLookups`                             | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/validate/resolveManagers`                         | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/validate/restartValidation`                       | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/validate/validateContratosChunk`                  | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/validate/validateHorariosChunk`                   | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/validate/validateJobStep`                         | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:import/validate/validatePersonasChunk`                   | ✅     | `src/test/idor/import.db.test.ts`             | —       |
| `lib:mcp/connections/countRecentConnections`                  | ✅     | `src/test/idor/mcp.db.test.ts`                | —       |
| `lib:mcp/connections/countToolCallErrors`                     | ✅     | `src/test/idor/mcp.db.test.ts`                | —       |
| `lib:mcp/connections/createAuthCode`                          | ✅     | `src/test/idor/mcp.db.test.ts`                | —       |
| `lib:mcp/connections/createPersonalToken`                     | ✅     | `src/test/idor/mcp.db.test.ts`                | —       |
| `lib:mcp/connections/getConnection`                           | ✅     | `src/test/idor/mcp.db.test.ts`                | —       |
| `lib:mcp/connections/hideConnection`                          | ✅     | `src/test/idor/mcp.db.test.ts`                | —       |
| `lib:mcp/connections/listConnections`                         | ✅     | `src/test/idor/mcp.db.test.ts`                | —       |
| `lib:mcp/connections/listToolCalls`                           | ✅     | `src/test/idor/mcp.db.test.ts`                | —       |
| `lib:mcp/connections/purgeExpiredToolCalls`                   | ✅     | `src/test/idor/mcp.db.test.ts`                | —       |
| `lib:mcp/connections/revokeConnection`                        | ✅     | `src/test/idor/mcp.db.test.ts`                | —       |
| `lib:mcp/idempotency/completeIdempotencyKey`                  | ✅     | `src/test/idor/mcp-writes.db.test.ts`         | —       |
| `lib:mcp/idempotency/findIdempotentReply`                     | ✅     | `src/test/idor/mcp-writes.db.test.ts`         | —       |
| `lib:mcp/idempotency/releaseIdempotencyKey`                   | ✅     | `src/test/idor/mcp-writes.db.test.ts`         | —       |
| `lib:mcp/idempotency/reserveIdempotencyKey`                   | ✅     | `src/test/idor/mcp-writes.db.test.ts`         | —       |
| `lib:mcp/settings/getMcpSettings`                             | ✅     | `src/test/idor/mcp-writes.db.test.ts`         | —       |
| `lib:mcp/settings/setMcpWritesEnabled`                        | ✅     | `src/test/idor/mcp-writes.db.test.ts`         | —       |
| `lib:onboarding/approveOnboardingStep`                        | ✅     | `src/test/idor/onboarding.db.test.ts`         | —       |
| `lib:onboarding/findBlockingOnboarding`                       | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:onboarding/getOnboardingById`                            | ✅     | `src/test/idor/onboarding.db.test.ts`         | —       |
| `lib:onboarding/getOnboardingByPerson`                        | ✅     | `src/test/idor/onboarding.db.test.ts`         | —       |
| `lib:onboarding/listOnboardings`                              | ✅     | `src/test/idor/onboarding.db.test.ts`         | —       |
| `lib:onboarding/rejectOnboarding`                             | ✅     | `src/test/idor/onboarding.db.test.ts`         | —       |
| `lib:onboarding/startOnboarding`                              | ✅     | `src/test/idor/onboarding.db.test.ts`         | —       |
| `lib:onboarding/updateOnboarding`                             | ✅     | `src/test/idor/onboarding.db.test.ts`         | —       |
| `lib:people/countActivePeopleInPosition`                      | ✅     | `src/test/idor/mcp-write-tools.db.test.ts`    | —       |
| `lib:people/countActivePeople`                                | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/countPeopleByStatus`                              | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/createPerson`                                     | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/employment-menu/getPersonEmploymentMenuData`      | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:people/employment/getEmploymentSummary`                  | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:people/employment/listEmploymentPeriods`                 | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:people/employment/listEmploymentSummaries`               | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:people/employment/rehirePerson`                          | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:people/employment/terminatePerson`                       | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:people/employment/updateFiniquito`                       | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:people/findIdentityConflicts`                            | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/getPersonById`                                    | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/getPersonSchedule`                                | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/getPersonWithRelations`                           | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/list/countPeopleFilterOptions`                    | ✅     | `src/test/idor/people-filter.db.test.ts`      | —       |
| `lib:people/list/countPeopleFiltered`                         | ✅     | `src/test/idor/people-filter.db.test.ts`      | —       |
| `lib:people/list/listPeopleFilteredAfter`                     | ✅     | `src/test/idor/people-filter.db.test.ts`      | —       |
| `lib:people/list/listPeopleFiltered`                          | ✅     | `src/test/idor/people-filter.db.test.ts`      | —       |
| `lib:people/list/listPeopleNamesByIds`                        | ✅     | `src/test/idor/people-filter.db.test.ts`      | —       |
| `lib:people/listActivePeopleForSelect`                        | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/listPeopleKeyset`                                 | ✅     | `src/test/idor/mcp-tools.db.test.ts`          | —       |
| `lib:people/listPeoplePage`                                   | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/listPeople`                                       | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/listPersonBeneficiaries`                          | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/searchActivePeopleForSelect`                      | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/setPersonStatus`                                  | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/softDeletePerson`                                 | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/updatePerson`                                     | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/upsertPersonSchedule`                             | ✅     | `src/test/idor/people.db.test.ts`             | —       |
| `lib:people/views/createPeopleView`                           | ✅     | `src/test/idor/people-views.db.test.ts`       | —       |
| `lib:people/views/deletePeopleView`                           | ✅     | `src/test/idor/people-views.db.test.ts`       | —       |
| `lib:people/views/getPeopleView`                              | ✅     | `src/test/idor/people-views.db.test.ts`       | —       |
| `lib:people/views/listPeopleViews`                            | ✅     | `src/test/idor/people-views.db.test.ts`       | —       |
| `lib:people/views/updatePeopleView`                           | ✅     | `src/test/idor/people-views.db.test.ts`       | —       |
| `lib:regions/createRegion`                                    | ✅     | `src/test/idor/regions.db.test.ts`            | —       |
| `lib:regions/getRegionById`                                   | ✅     | `src/test/idor/regions.db.test.ts`            | —       |
| `lib:regions/listRegionsWithSiteCounts`                       | ✅     | `src/test/idor/regions.db.test.ts`            | —       |
| `lib:regions/listRegions`                                     | ✅     | `src/test/idor/regions.db.test.ts`            | —       |
| `lib:regions/softDeleteRegion`                                | ✅     | `src/test/idor/regions.db.test.ts`            | —       |
| `lib:regions/updateRegion`                                    | ✅     | `src/test/idor/regions.db.test.ts`            | —       |
| `lib:resguardo/assignAsset`                                   | ✅     | `src/test/idor/resguardo.db.test.ts`          | —       |
| `lib:resguardo/countAssignedAssets`                           | ✅     | `src/test/idor/resguardo.db.test.ts`          | —       |
| `lib:resguardo/createAsset`                                   | ✅     | `src/test/idor/resguardo.db.test.ts`          | —       |
| `lib:resguardo/getAssetById`                                  | ✅     | `src/test/idor/resguardo.db.test.ts`          | —       |
| `lib:resguardo/getAssetWithHolder`                            | ✅     | `src/test/idor/resguardo.db.test.ts`          | —       |
| `lib:resguardo/listAssetMovements`                            | ✅     | `src/test/idor/resguardo.db.test.ts`          | —       |
| `lib:resguardo/listAssetsByPerson`                            | ✅     | `src/test/idor/resguardo.db.test.ts`          | —       |
| `lib:resguardo/listAssetsKeyset`                              | ✅     | `src/test/idor/mcp-tools.db.test.ts`          | —       |
| `lib:resguardo/listAssetsPage`                                | ✅     | `src/test/idor/resguardo.db.test.ts`          | —       |
| `lib:resguardo/listAssetsToRecover`                           | ✅     | `src/test/idor/resguardo.db.test.ts`          | —       |
| `lib:resguardo/returnAsset`                                   | ✅     | `src/test/idor/resguardo.db.test.ts`          | —       |
| `lib:resguardo/softDeleteAsset`                               | ✅     | `src/test/idor/resguardo.db.test.ts`          | —       |
| `lib:sites/createSite`                                        | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:sites/getSiteById`                                       | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:sites/listActiveSites`                                   | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:sites/listSites`                                         | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:sites/setSiteRegion`                                     | ✅     | `src/test/idor/regions.db.test.ts`            | —       |
| `lib:sites/softDeleteSite`                                    | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:sites/updateSite`                                        | ✅     | `src/test/idor/catalog.db.test.ts`            | —       |
| `lib:tenant/members/addMember`                                | ✅     | `src/test/idor/tenant.db.test.ts`             | —       |
| `lib:tenant/members/changeMemberRole`                         | ✅     | `src/test/idor/tenant.db.test.ts`             | —       |
| `lib:tenant/members/listCompanyMembers`                       | ✅     | `src/test/idor/tenant.db.test.ts`             | —       |
| `lib:tenant/members/revokeMember`                             | ✅     | `src/test/idor/tenant.db.test.ts`             | —       |
| `lib:termination-reasons/createTerminationReason`             | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:termination-reasons/ensureTerminationReasons`            | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:termination-reasons/getTerminationReasonById`            | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:termination-reasons/listTerminationReasonsWithUsage`     | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:termination-reasons/listTerminationReasons`              | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:termination-reasons/softDeleteTerminationReason`         | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:termination-reasons/updateTerminationReason`             | ✅     | `src/test/idor/employment.db.test.ts`         | —       |
| `lib:reports/turnover/data/getTurnoverGoal`                   | ✅     | `src/test/idor/turnover.db.test.ts`           | —       |
| `lib:reports/turnover/data/loadTurnoverFacts`                 | ✅     | `src/test/idor/turnover.db.test.ts`           | —       |
| `lib:reports/turnover/data/loadTurnoverLabels`                | ✅     | `src/test/idor/turnover.db.test.ts`           | —       |
| `lib:reports/turnover/data/setTurnoverGoal`                   | ✅     | `src/test/idor/turnover.db.test.ts`           | —       |
| `lib:reports/turnover/data/loadTurnoverFiniquitos`            | ✅     | `src/test/idor/turnover.db.test.ts`           | —       |
| `lib:reports/turnover/views/createTurnoverView`               | ✅     | `src/test/idor/turnover.db.test.ts`           | —       |
| `lib:reports/turnover/views/deleteTurnoverView`               | ✅     | `src/test/idor/turnover.db.test.ts`           | —       |
| `lib:reports/turnover/views/listTurnoverViews`                | ✅     | `src/test/idor/turnover.db.test.ts`           | —       |
| `lib:reports/turnover/getTurnoverReport`                      | ✅     | `src/test/idor/turnover.db.test.ts`           | —       |
| `lib:termination-reasons/countUnclassifiedTerminationReasons` | ✅     | `src/test/idor/employment.db.test.ts`         | —       |

## Herramientas MCP

Una conexión de la empresa B llama cada herramienta con ids de la empresa A: las lecturas responden `NOT_FOUND` o una lista sin ids de A (addendum multiempresa §7). Las de escritura (Fase 2) necesitan además su prueba `rbac:mcp:<tool>`.

| Superficie                          | Estado | Prueba                                     | Permiso                   |
| ----------------------------------- | ------ | ------------------------------------------ | ------------------------- |
| `mcp:approve_onboarding_step`       | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `people:update`           |
| `mcp:assign_asset`                  | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `assets:update`           |
| `mcp:create_catalog_item`           | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `positions:create`        |
| `mcp:create_person`                 | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `people:create`           |
| `mcp:decide_contract_renewal`       | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `contracts:update`        |
| `mcp:fetch`                         | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `people:read`             |
| `mcp:get_asset`                     | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `assets:read`             |
| `mcp:get_contract`                  | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `contracts:read`          |
| `mcp:get_onboarding`                | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `people:read`             |
| `mcp:get_person`                    | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `people:read`             |
| `mcp:get_seniority_certificate`     | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `contracts:read`          |
| `mcp:issue_contract`                | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `contracts:create`        |
| `mcp:link_position_activity`        | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `positions:update`        |
| `mcp:list_activities`               | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `positions:read`          |
| `mcp:list_areas`                    | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `areas:read`              |
| `mcp:list_assets`                   | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `assets:read`             |
| `mcp:list_audit_events`             | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `audit:read`              |
| `mcp:list_contract_templates`       | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `contract_templates:read` |
| `mcp:list_contracts`                | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `contracts:read`          |
| `mcp:list_expiring_contracts`       | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `contracts:read`          |
| `mcp:list_people`                   | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `people:read`             |
| `mcp:list_positions`                | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `positions:read`          |
| `mcp:list_regions`                  | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `sites:read`              |
| `mcp:list_renewal_tray`             | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `contracts:read`          |
| `mcp:list_sites`                    | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `sites:read`              |
| `mcp:list_termination_reasons`      | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `people:read`             |
| `mcp:mark_contract_no_renew`        | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `contracts:update`        |
| `mcp:preview_contract`              | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `contracts:read`          |
| `mcp:register_asset`                | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `assets:create`           |
| `mcp:renew_contract`                | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `contracts:update`        |
| `mcp:return_asset`                  | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `assets:update`           |
| `mcp:search`                        | ✅     | `src/test/idor/mcp-tools.db.test.ts`       | `people:read`             |
| `mcp:set_person_status`             | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `people:update`           |
| `mcp:start_onboarding`              | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `people:update`           |
| `mcp:unlink_position_activity`      | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `positions:update`        |
| `mcp:update_person`                 | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `people:update`           |
| `mcp:update_person_schedule`        | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `people:update`           |
| `mcp:update_person_schedule_blocks` | ✅     | `src/test/idor/mcp-write-tools.db.test.ts` | `people:update`           |
| `mcp:whoami`                        | ✅     | `src/test/idor/mcp.db.test.ts`             | `people:read`             |
