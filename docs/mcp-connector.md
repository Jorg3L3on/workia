# Conector MCP de Workia

Workia expone un servidor MCP remoto para que asistentes de IA (Grok Bot,
ChatGPT, Cursor, Claude, MCP Inspector) consulten y, más adelante, operen
Workia sin saltarse sus reglas. Plania: WRK-I1 (spec «Workia MCP — Spec v1.0» y
«Addendum multiempresa»).

- **URL:** `https://<dominio>/api/mcp` (Streamable HTTP sin estado).
- **Una empresa por conexión.** El token queda ligado a la empresa elegida al
  conectar; ninguna herramienta acepta `company_id`. Para otra empresa, otra
  conexión.
- **Permiso efectivo = scopes de la conexión ∩ rol de la persona en esa empresa
  (∩ techo de ChatGPT).** El rol se vuelve a leer en cada llamada: un cambio en
  `/admin/rbac` o en `/app/miembros` aplica en la siguiente.
- **Nada se borra por MCP** (D-07): no hay herramientas de borrado; las bajas
  laborales son un cambio de estatus.

## Conectar un asistente

Las conexiones se administran en **`/app/conexiones`** (menú «Conexiones»),
dentro de la empresa activa. Hace falta el permiso `mcp_connections:create`
(roles admin y editor); `mcp_connections:manage` (admin) además ve y revoca las
conexiones de toda la empresa.

### Token personal (Grok Bot, Cursor, MCP Inspector)

1. En `/app/conexiones` → «Nuevo token personal»: nombre, permisos (preset) y
   vencimiento (7, 30 o 90 días; siempre vence).
2. El token (`workia_pat_…`) se muestra **una sola vez**, con los fragmentos
   para cada cliente. En la base sólo quedan su prefijo y su hash SHA-256.
3. En el cliente: URL del conector y encabezado
   `Authorization: Bearer workia_pat_…`.

Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "workia": {
      "url": "https://<dominio>/api/mcp",
      "headers": { "Authorization": "Bearer workia_pat_…" }
    }
  }
}
```

MCP Inspector: `npx @modelcontextprotocol/inspector`, transporte «Streamable
HTTP», la URL y el token como Bearer.

### OAuth (ChatGPT, Claude, Grok Bot)

1. En el cliente, agrega un conector MCP con la URL. No hace falta client id ni
   secret: el cliente descubre el servidor de autorización
   (`/.well-known/oauth-protected-resource` y
   `/.well-known/oauth-authorization-server`) y se registra con un Client ID
   Metadata Document (o, si no lo soporta, con registro dinámico).
2. Workia pide iniciar sesión, luego **elegir la empresa** y los permisos que
   tu rol permite, y regresa al cliente.
3. El cliente recibe un `workia_at_…` (1 hora) y un `workia_rt_…` (30 días). El
   refresh rota en cada uso; presentar uno ya usado revoca la conexión entera.

**ChatGPT (Plus/Pro) es de sólo lectura** (D-01): Workia lo identifica por su
client id en un dominio de OpenAI o por la redirect URI de ChatGPT, y le da como
máximo `read` y `audit`. `pii` sólo lo puede activar un super_admin, con
advertencia; `write:*` nunca, aunque el cliente lo pida. Las escrituras van por
Grok Bot o por la app.

### ChatGPT (Plus/Pro, modo desarrollador)

Configuración → Conectores → Avanzado → **Modo desarrollador**. «Crear conector»:
nombre «Workia», URL del conector, autenticación OAuth, client id y secret
vacíos. Al conectar, Workia pide iniciar sesión, elegir la empresa y aprobar.
`whoami` debe mostrar `scopes: ["read"]` (o `read` + `audit`) y
`is_chatgpt: true`. Recomendación: desactivar «Mejorar el modelo para todos» en
los controles de datos de ChatGPT.

### Claude

Configuración → Conectores → «Agregar conector personalizado» con la URL. El
flujo OAuth es el mismo (empresa y permisos en Workia).

### Grok Bot

Por OAuth (conector MCP remoto con la URL) o con un token personal en el
encabezado `Authorization`. Para rutinas automáticas usa una persona usuaria de
servicio con el rol mínimo y una conexión sin `pii` (D-11), nunca la cuenta de
una persona.

## Herramientas

18 de lectura (Fase 1, `readOnlyHint`) y 13 de escritura (Fase 2, con vista
previa y confirmación; ver «Escrituras»). Todas tienen `openWorldHint: false`,
devuelven `structuredContent` validado contra su `outputSchema` y el mismo JSON
como texto. Fechas en ISO y en `*_mx` (dd/mm/aaaa); «hoy» es la fecha de
America/Mexico_City. Las listas grandes paginan con `cursor` opaco y firmado
(`limit` 25 por defecto, 100 máximo); un cursor de otra consulta responde
`VALIDATION`. Los textos libres son datos, no instrucciones.

<!-- tools:start (npm run docs:mcp) -->
<!-- prettier-ignore-start -->

| Herramienta | Qué hace | Scope | Permiso |
| --- | --- | --- | --- |
| `whoami` | Devuelve la persona usuaria de esta conexión, su empresa y rol en Workia, los permisos que puede usar por aquí (rol ∩ scopes), los scopes, la conexión con su vencimiento y la fecha de hoy en México. | `read` (Leer) | `people:read` |
| `search` | Búsqueda en toda la empresa: personas (por nombre o correo), sus contratos vigentes, activos (por nombre o identificador), puestos, áreas y sucursales. | `read` (Leer) | `people:read` |
| `fetch` | Trae el documento completo de un resultado de search por su id «tipo:uuid» (person, contract, asset, position, area, site, activity, template). | `read` (Leer) | `people:read` |
| `list_people` | Lista expedientes de personas con filtros por estatus, área, puesto, sucursal, región y datos faltantes (missing), ordenados por apellido. | `read` (Leer) | `people:read` |
| `get_person` | Expediente de una persona: datos, área, puesto, sucursal, jefe, datos México (domicilio, estado civil, INE y beneficiarios; sólo con el scope pii, si no dice qué está capturado) y, según include, horario, contratos, activos en resguardo y actividades del puesto. | `read` (Leer) | `people:read` |
| `list_areas` | Áreas de la empresa con su área padre. | `read` (Leer) | `areas:read` |
| `list_positions` | Puestos de la empresa con su área y, opcionalmente, sus actividades. | `read` (Leer) | `positions:read` |
| `list_activities` | Actividades del catálogo (se asignan a puestos). | `read` (Leer) | `positions:read` |
| `list_sites` | Ubicaciones de la empresa: sucursales y corporativo. | `read` (Leer) | `sites:read` |
| `list_regions` | Regiones de la empresa con sus sucursales. | `read` (Leer) | `sites:read` |
| `list_contracts` | Contratos filtrables por persona, estado, tipo y rango de fecha de fin, ordenados por fecha de fin (los indeterminados al final). | `read` (Leer) | `contracts:read` |
| `list_expiring_contracts` | «¿Qué contratos vencen en N días?»: contratos determinados vigentes cuya fecha de fin cae entre hoy (México) y hoy + within_days, sin importar el aviso. | `read` (Leer) | `contracts:read` |
| `list_renewal_tray` | La bandeja de renovación de Workia tal cual: contratos determinados vigentes dentro de su ventana de aviso (1, 2, 3 o 6 meses antes del fin; «no avisar» queda fuera), por fecha de fin. | `read` (Leer) | `contracts:read` |
| `get_contract` | Detalle de un contrato: horario y compensación congelados al emitir (los montos sólo con el scope pii y compensation:read), cadena de renovaciones y, si include_text, el texto generado. | `read` (Leer) | `contracts:read` |
| `list_contract_templates` | Plantillas de contrato y los tokens que Workia sabe llenar ({{nombres}}, {{puesto}}, {{curp}}, {{domicilio}}, {{salario_diario}}, {{antiguedad}}, {{empresa_razon_social}}…) con lo que imprime cada uno. | `read` (Leer) | `contract_templates:read` |
| `preview_contract` | Simula la emisión de un contrato sin guardar nada: el texto que saldría, los tokens que quedarían vacíos (p. | `read` (Leer) | `contracts:read` |
| `get_seniority_certificate` | Constancia de antigüedad de una persona, igual que la de la app: fecha de ingreso original, antigüedad a hoy y cadena de contratos, más el texto listo para imprimir. | `read` (Leer) | `contracts:read` |
| `list_assets` | Activos en resguardo con su resguardante actual. | `read` (Leer) | `assets:read` |
| `get_asset` | Un activo con su resguardante y el historial de entregas y devoluciones (fecha, condición, notas). | `read` (Leer) | `assets:read` |
| `list_audit_events` | Bitácora de cambios (append-only), más reciente primero: quién, qué recurso, qué acción, origen (app, seed, system, import, mcp) y el antes/después. | `audit` (Auditoría) | `audit:read` |
| `create_person` | Da de alta un expediente con las mismas reglas que la app (D-04). | `write:people` (Escribir personas) | `people:create` |
| `update_person` | Edita sólo los campos enviados en changes (null borra el dato); el resto del expediente y el horario no cambian. | `write:people` (Escribir personas) | `people:update` |
| `set_person_status` | Da de baja laboral o reactiva a una persona (estatus activa \| baja). | `write:people` (Escribir personas) | `people:update` |
| `update_person_schedule` | Obsoleta: usa update_person_schedule_blocks (horario por bloques, día de descanso). | `write:people` (Escribir personas) | `people:update` |
| `update_person_schedule_blocks` | Captura el horario por bloques de una persona: cada bloque con días (lun…dom), entrada, salida y comida opcional, más el día de descanso. | `write:people` (Escribir personas) | `people:update` |
| `get_onboarding` | Estado de un alta RH → Nóminas por person_id u onboarding_id: etapa, checklist, lo que falta, Infonavit/Fonacot (número y montos sólo con el scope pii) y quién ya aprobó. | `read` (Leer) | `people:read` |
| `start_onboarding` | Inicia el alta RH → Nóminas de una persona activa que ya tiene expediente (créalo antes con create_person), con el checklist e Infonavit/Fonacot si ya los tienes. | `write:people` (Escribir personas) | `people:update` |
| `approve_onboarding_step` | Da el visto bueno de la etapa actual de un alta: en «Captura RH» (people:update, checklist completo) la pasa a Nóminas; en «Pendiente Nóminas» (permiso payroll:approve) la completa. | `write:people` (Escribir personas) | `people:update` |
| `create_catalog_item` | Crea un área, un puesto, una actividad o una ubicación (sucursal o corporativo). | `write:catalog` (Escribir catálogo) | `positions:create` |
| `link_position_activity` | Agrega una actividad a un puesto. | `write:catalog` (Escribir catálogo) | `positions:update` |
| `unlink_position_activity` | Quita una actividad de un puesto y advierte cuántas personas activas tienen ese puesto. | `write:catalog` (Escribir catálogo) | `positions:update` |
| `issue_contract` | Emite un contrato con una plantilla: congela el texto y el horario de la persona al emitir, igual que la app. | `write:contracts` (Escribir contratos) | `contracts:create` |
| `renew_contract` | Renueva un contrato vigente: el anterior queda «renovado» y se emite el nuevo ligado a él, en un solo paso (si algo falla no cambia nada). | `write:contracts` (Escribir contratos) | `contracts:update` |
| `mark_contract_no_renew` | Registra la decisión de no renovar un contrato vigente; sale de la bandeja de renovación. | `write:contracts` (Escribir contratos) | `contracts:update` |
| `decide_contract_renewal` | La decisión de la bandeja de renovación en un paso, igual que la app: renovar_indeterminado, renovar_determinado (con end_date) o no_renovar (motivo obligatorio). | `write:contracts` (Escribir contratos) | `contracts:update` |
| `register_asset` | Da de alta un activo en resguardo (queda «En almacén»). | `write:assets` (Escribir resguardo) | `assets:create` |
| `assign_asset` | Entrega un activo en resguardo a una persona, con fecha y la condición en que se entrega (obligatoria). | `write:assets` (Escribir resguardo) | `assets:update` |
| `return_asset` | Registra la devolución de un activo asignado, con fecha y la condición en que regresa (obligatoria). | `write:assets` (Escribir resguardo) | `assets:update` |

<!-- prettier-ignore-end -->
<!-- tools:end -->

Además:

- **Resources:** `workia://glosario`, `workia://plantillas/tokens`,
  `workia://plantillas/{id}` (requiere `contract_templates:read`) y
  `workia://catalogo`.
- **Prompts:** `revisar_bandeja_renovacion`, `resumen_expediente {persona}` y
  `baja_checklist {persona}`.
- **Datos faltantes:** `list_people` acepta `missing` (horario, rfc, curp, nss,
  email, telefono, sucursal, puesto) y sólo dice si el dato falta, nunca su
  valor (D-14). Sin `pii`, `list_people` y `search` no buscan por RFC ni CURP.

## Escrituras (Fase 2)

Las escrituras van por Grok Bot, Cursor o el Inspector, nunca por ChatGPT, y
**empiezan apagadas en cada empresa** (D-17). Un super_admin las enciende o
apaga en `/app/conexiones` → «Escrituras por asistente»; apagadas, toda
escritura responde `WRITES_DISABLED` en la siguiente llamada.

Cada herramienta de escritura funciona en dos pasos (D-06):

1. **Vista previa.** La llamada sin `confirmation_token` valida, revisa las
   reglas y responde `status: "preview"`, `code: "CONFIRMATION_REQUIRED"`, un
   `preview.summary` en español y un `confirmation_token`. No escribe nada.
2. **Confirmación.** La misma llamada, con los mismos argumentos y el token,
   hace el cambio con la función de dominio de la app y responde
   `status: "done"` y `audit_event_ids`. El token vale 10 minutos y está ligado
   a la persona, la conexión, la herramienta y los argumentos exactos; con otros
   o vencido responde `CONFIRMATION_INVALID`.

- `idempotency_key` (8–80 caracteres) es obligatoria: repetir la misma llave
  con los mismos datos devuelve la misma respuesta durante 24 horas sin
  duplicar; con otros datos, `IDEMPOTENCY_MISMATCH`.
- Cada cambio queda en `/app/auditoria` con origen «Asistente (MCP)» y la
  etiqueta «MCP · cliente», con la conexión, la herramienta y la llave en
  `request_meta`. Los intentos rechazados (scope, rol, interruptor) quedan
  sólo en la actividad de `/app/conexiones`.
- 20 escrituras por minuto por conexión.
- La confirmación por elicitation/MRTR del protocolo 2026-07-28 queda como
  opción futura: el camino soportado es el token de dos pasos.

## Scopes

| Scope             | Qué permite                                                      | Quién lo puede dar                |
| ----------------- | ---------------------------------------------------------------- | --------------------------------- |
| `read`            | Leer personas, contratos, resguardo y catálogo (PII enmascarada) | Todos (siempre incluido)          |
| `pii`             | RFC, CURP, NSS, teléfono, correo y nacimiento sin enmascarar     | Roles con `people:update` (D-09)  |
| `audit`           | Consultar la bitácora                                            | Roles con `audit:read`            |
| `write:people`    | Altas y cambios de personas (Fase 2)                             | `people:create` o `people:update` |
| `write:contracts` | Emitir, renovar, no renovar (Fase 2)                             | `contracts:create` o `:update`    |
| `write:assets`    | Registrar, entregar, devolver activos (Fase 2)                   | `assets:create` o `assets:update` |
| `write:catalog`   | Crear áreas, puestos, sucursales, actividades (Fase 2)           | Permisos de creación del catálogo |
| `offline_access`  | Renovar el acceso con el refresh token (OAuth)                   | Todos                             |

## Errores

Los errores de negocio son resultados de herramienta con `isError: true` y
`structuredContent.error = { code, message, details?, retry_after_s? }`:

| Código                   | Cuándo                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED`        | Sin token válido                                                                                                 |
| `COMPANY_ACCESS_REVOKED` | La membresía se revocó o la empresa se suspendió; la conexión queda revocada y la siguiente llamada responde 401 |
| `FORBIDDEN_SCOPE`        | La conexión no tiene el scope (ChatGPT y escrituras: manda a Grok Bot o a la app)                                |
| `FORBIDDEN_RBAC`         | El rol de la persona no tiene el permiso                                                                         |
| `NOT_FOUND`              | No existe, o es de otra empresa (misma respuesta)                                                                |
| `VALIDATION`             | Argumentos inválidos                                                                                             |
| `CONFLICT`               | Choca con una regla de negocio                                                                                   |
| `RATE_LIMITED`           | Más de 120 lecturas por minuto en la conexión; `retry_after_s`                                                   |
| `INTERNAL`               | Error inesperado (sin detalles)                                                                                  |

A nivel HTTP: sin token, `401` con `WWW-Authenticate: Bearer … resource_metadata=…`;
un token sin `read`, `403 insufficient_scope`.

## Bitácora y retención

- Cada llamada queda en `mcp_tool_calls` (herramienta, resultado
  `success|error|denied`, código, latencia, si se desenmascaró PII). Se ve en
  `/app/conexiones` → «Actividad» (últimas 50 y errores de 24 h).
- **Retención: 12 meses** (D-13). Al registrar llamadas, una de cada cien
  borra las de la empresa con más de 12 meses (borrado perezoso, sin job).
- Crear y revocar conexiones deja un evento en `/app/auditoria` (recurso
  «Conexión de asistente (MCP)»).
- Los logs (`mcp.tool.invoked|failed|denied`, `mcp.oauth.token`) no llevan PII,
  tokens ni códigos.

## Límites

- 120 llamadas de lectura por minuto por conexión.
- 10 conexiones nuevas por hora por persona.
- 30 intentos por minuto por IP en `/api/oauth/token` (y en `/revoke`).
- 20 registros dinámicos por hora por IP.

Los contadores viven en Postgres (`rate_limits`) y se limpian solos.

## Operación

- **Variables:** `MCP_ENABLED=0` apaga `/api/mcp`, `/api/oauth/*` y
  `/.well-known/*` (404). `MCP_PUBLIC_URL` fija el issuer si el origen de la
  petición no es el público. `MCP_ALLOWED_ORIGINS` agrega orígenes de navegador
  (por defecto: el propio, claude.ai, chatgpt.com y localhost).
- **Migración:** `0009_mcp` (tablas `mcp_*` y `rate_limits`, con RLS en las de
  empresa). El número se reservó antes de 0010–0018; el registro aplica por
  etiqueta, así que corre después de 0018.
- **Permisos en producción:** después de migrar,
  `npm run db:sync-permissions -- --confirm-host <host>` agrega
  `mcp_connections:create|manage` y sus asignaciones (ver
  [migrations.md](migrations.md)).
- **RLS:** las credenciales llegan antes de saber su empresa; la función
  `mcp_credential_company()` (SECURITY DEFINER) sólo responde qué empresa tiene
  un prefijo de token o un código, y después todo se lee con `tdb(companyId)`.

## Pruebas

- `src/lib/mcp/mcp-coverage.test.ts`: cada herramienta declara permiso, scope,
  anotaciones y esquemas; ninguna acepta `company_id`; ninguna escribe SQL.
- `src/lib/mcp/public-routes.test.ts`: `/api/mcp`, `/api/oauth/*` y
  `/.well-known/*` son las únicas rutas sin sesión, y todas respetan
  `MCP_ENABLED`.
- `src/app/api/mcp/route.test.ts`: transporte (401, 403 `insufficient_scope`,
  CORS, `Origin`) y snapshot de `tools/list`.
- `src/test/idor/mcp.db.test.ts` y `mcp-tools.db.test.ts` (`npm run test:db`,
  también con RLS): OAuth, tokens, aislamiento entre empresas, enmascarado,
  cursores y barrido de PII en todas las herramientas.
- `e2e/mcp-conexiones.spec.ts`: login → consentimiento → token, y crear, copiar
  y revocar un token en `/app/conexiones`.
- Evals con asistentes reales: [`evals/`](../evals/README.md).

Al agregar o cambiar una herramienta: `npm run docs:mcp` (tabla de arriba) y
`npx vitest run -u src/app/api/mcp` (snapshot), y agrega su fila `mcp:<tool>` en
[idor-matrix.md](idor-matrix.md).
