# Multiempresa

Una instalación de Workia atiende a varias empresas con los datos de cada una
aislados. Plania: WRK-I4.

## Modelo

- **Empresa (`companies`).** Nombre comercial, razón social, RFC, identificador
  (`slug`) y estado (`activa` / `suspendida`). La migración 0015 crea
  «Ferretera Mandiola» (`ferretera-mandiola`); todo lo que existía antes le
  pertenece.
- **Membresía (`company_memberships`).** Una persona usuaria pertenece a una o
  varias empresas, con un rol en cada una (`admin`, `editor`, `viewer`,
  `super_admin`). Una membresía es la predeterminada (donde entra al iniciar
  sesión). Revocar una membresía o suspender una empresa aplica en el siguiente
  request: el guard vuelve a leer las membresías cada vez.
- **Plataforma.** `users.is_platform_admin` da los permisos de plataforma
  (`users:*`, `roles:*`, `permissions:read`, `companies:*`). Ningún rol de
  empresa los da, aunque los tenga en `role_permissions`. Un admin de plataforma
  administra empresas y miembros en `/admin/empresas`, pero solo ve datos de
  negocio de las empresas donde tiene membresía (no hay «empresa de sistema»).
- **`company_id` en cada tabla de negocio** (0016), NOT NULL, con llaves
  foráneas compuestas `(company_id, x_id)`: la base rechaza que un registro
  apunte a otro de otra empresa. `src/lib/db/schema/tenant-coverage.test.ts`
  falla si una tabla nueva no tiene `company_id`. Las únicas excepciones son
  las de plataforma: usuarios, sesiones, roles, permisos, empresas y membresías.
- **Unicidad por empresa** (0017): CURP, RFC y NSS de personas activas; nombre
  de área, puesto, sucursal y actividad (sin mayúsculas, acentos ni espacios
  extra, con `catalog_key()`, igual que la importación); identificador de
  activo; una importación aplicándose por empresa.
- **Empresa activa en la sesión.** El JWT de Auth.js guarda `activeCompanyId`
  (la predeterminada o la única al iniciar sesión). `switchCompanyAction` la
  cambia solo hacia una empresa con membresía activa, y deja un evento de
  auditoría.

## Cómo se protege cada consulta

1. **Guard central.** `requireCompanyContext(permiso)`
   (`src/lib/tenant/context.ts`) es la única puerta a datos de negocio. Devuelve
   `{ user, userId, companyId, membership, permissions }`. Los guards de cada
   módulo (`requirePeopleRead`, `requireContractsCreate`…) lo usan. Las páginas
   usan `requireCompanyPage()`, que manda a `/empresa` sin empresa activa
   (elegir una, o «No perteneces a ninguna empresa»).
2. **Funciones de datos con `companyId`.** Toda función de `src/lib` que lee o
   escribe datos de negocio recibe `companyId` como primer argumento y filtra
   con `withTenant(...)`. Las inserciones lo guardan; los formularios nunca lo
   envían como dato. El campo oculto `companyId` (`CompanyField`) solo sirve
   para rechazar un formulario abierto en otra empresa en otra pestaña: «La
   empresa activa cambió. Recarga la página.».
3. **Llaves compuestas** en la base (arriba).
4. **Pruebas IDOR en CI** (`src/test/idor`, `docs/idor-matrix.md`,
   `npm run check:idor`).
5. **RLS de Postgres** (0018, segunda capa; ver abajo).

## Desarrollo local

```bash
npm run db:migrate
npm run db:seed
```

El seed crea:

- **«Ferretera Mandiola»**, la empresa real, sin datos ficticios.
- **«Empresa Demo»**, con los datos demo. Las cuentas demo (`admin@`, `editor@`,
  `viewer@`, `rrhh@workia.local`, contraseña de demo) pertenecen solo a esta
  empresa y entran directo a ella. `admin@` además es admin de plataforma.
- **«Comercial del Norte»**, solo en local o con `SEED_DEMO_SECOND_COMPANY=1`.
  `rrhh@` es viewer ahí, para ver el selector de empresa y los permisos por
  empresa.

El seed es idempotente.

Pruebas:

- `npm run test`: unitarias.
- `npm run test:db`: Postgres real; migraciones, unicidad, IDOR y ensayo del
  corte.
- `npm run test:db:rls`: la misma suite con RLS activa.
- `npm run check:idor`: cobertura de la matriz.

## Administración

- **Plataforma** (`/admin/empresas`): crear, editar y suspender empresas;
  agregar miembros con cualquier rol, cambiar roles y revocar.
- **Admin de empresa** (`/app/miembros`, permisos `members:read` /
  `members:manage`): agregar por correo (si no hay cuenta se crea, y la persona
  entra con Google con ese correo), cambiar el rol entre admin, editor y viewer,
  y revocar el acceso.
- **Reglas:**
  - Nadie puede revocar ni degradar a la última persona administradora de una
    empresa.
  - Un admin de empresa no cambia su propio acceso ni el de un `super_admin`.
  - Todo queda en la auditoría de la empresa afectada.

## RLS (segunda capa)

La migración 0018 activa RLS en las 14 tablas de negocio. La política
`<tabla>_company_isolation` deja ver y escribir una fila solo si su
`company_id` es igual a `app.company_id`. El dueño de las tablas (migraciones,
scripts) no está sujeto a RLS, así que **nada cambia hasta que la app se conecte
con su propio rol**.

Activarla:

1. **Crear el rol de login de la app.** En Neon: un rol nuevo con contraseña, o
   con SQL como dueño de la base:

   ```sql
   CREATE ROLE workia_app_login LOGIN PASSWORD '<secreto>' NOBYPASSRLS;
   GRANT workia_app TO workia_app_login;
   ```

   Si la migración no pudo crear `workia_app` (mensaje NOTICE), créalo antes
   con `CREATE ROLE workia_app NOLOGIN NOBYPASSRLS;` y repite los `GRANT` del
   final de `drizzle/0018_company_rls.sql`.

2. **Configurar la app.** `DATABASE_URL` de la app pasa a ese rol y se agrega
   `DATABASE_RLS=1`. Las migraciones y los scripts siguen con la URL del dueño.
   Con RLS activa, cada consulta de negocio corre en una transacción que fija
   `app.company_id` (`tdb(companyId)` y `withTransaction(fn, companyId)` en
   `src/lib/db/index.ts`).
3. **Probar primero fuera de producción** (rama de Neon + entorno local o de
   prueba). Medir p95 de Personas, Contratos (bandeja), Resguardo y Auditoría
   contra los mismos datos con y sin RLS. En local la diferencia es de ~0.2 ms.
   En Neon cada consulta pasa a una transacción por WebSocket en vez de HTTP:
   medir antes de producción.
4. **Volver atrás:** quitar `DATABASE_RLS=1` y regresar la URL del dueño. No
   requiere migración.

## Corte a producción

Prerrequisitos (Plania):

- **WRK-I4-1:** 0010–0014 aplicadas en producción, permisos de importar y
  exportar, pantalla «Acceso no permitido».
- **WRK-I4-2:** registro de migraciones adoptado en producción (`--baseline
0014`; ver [migrations.md](migrations.md)).

El corte aplica 0015–0018 y despliega el código de `sandbox` → `main`. **El
código anterior no puede escribir en el esquema nuevo** (`company_id` es NOT NULL
sin default), así que migración y despliegue van juntos en una ventana corta
(~10 min) avisada a RRHH.

Antes, sobre una **rama de Neon copia de producción** (ensayo):

1. Hacer la rama desde producción en la consola de Neon y apuntar
   `DATABASE_URL` a ella.
2. Revisar duplicados. Debe decir «Sin duplicados activos»; resolver lo que
   liste antes de seguir (0017 se niega a correr con duplicados):

   ```bash
   npm run db:report-duplicates
   ```

3. Tomar los conteos:

   ```bash
   npm run db:cutover -- snapshot --out counts.json --confirm-host <host-rama>
   ```

4. Ver que estén pendientes 0015, 0016, 0017 y 0018:

   ```bash
   npm run db:migrate -- --status --confirm-host <host-rama>
   ```

5. Migrar:

   ```bash
   npm run db:migrate -- --confirm-host <host-rama>
   ```

6. Verificar (mismos conteos, ninguna fila sin empresa, cada usuario con rol
   tiene su membresía, los `super_admin` son admin de plataforma, RLS
   activada):

   ```bash
   npm run db:cutover -- verify --counts counts.json --confirm-host <host-rama>
   ```

7. Levantar la app local contra la rama y recorrer:
   - Personas: lista, búsqueda, alta, edición y borrados.
   - Contratos: emitir, renovar, bandeja.
   - Resguardo: entregar y devolver.
   - Catálogo.
   - Importación y exportación.
   - Auditoría.
   - `/app/miembros` y `/admin/empresas`.
8. Probar la vuelta atrás. Al terminar, `--status` vuelve a listar 0015–0018
   como pendientes:

   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cutover/rollback.sql
   ```

9. Borrar la rama.

El mismo ensayo corre en CI sobre una base de una empresa con datos de prueba
(`src/lib/db/migrations/cutover-rehearsal.db.test.ts`). Incluye la vuelta atrás
y compara el esquema resultante con uno recién migrado a 0014.

En producción:

1. Avisar la ventana. Tomar un **punto de restauración** en Neon (branch o
   restore point con hora).
2. Repetir los pasos 2–6 con `--confirm-host <host-prod>`.
3. Mergear `sandbox` → `main` (Vercel despliega).
4. **Retest funcional** como en el paso 7 del ensayo, con una cuenta real de
   RRHH.
   - Quien solo tiene una empresa no ve cambios, salvo el nombre de la empresa
     en la barra lateral y en las migas de pan.
5. **Cuentas demo.** Si las cuentas demo existen en producción, quedaron como
   miembros de «Ferretera Mandiola». Revocarlas en `/admin/empresas` (o correr
   el seed, que crea «Empresa Demo» y las pone ahí como predeterminada).
6. **Después de verificar** (otro release):
   - retirar `user_roles`, que ya no se lee;
   - activar RLS (sección anterior).

   Los índices globales viejos de CURP/RFC ya los reemplazó 0017.

**Vuelta atrás en producción:**

- **Lo preferido:** restaurar el punto de restauración y revertir el merge en
  `main`.
- **Si no es posible:** `scripts/cutover/rollback.sql`. Solo sirve mientras
  exista una sola empresa; si ya hay otra, se niega, porque mezclaría sus datos.
