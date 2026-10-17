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
- **Nada se borra por MCP** (D-07). En la Fase 1 sólo hay herramientas de
  lectura.

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
