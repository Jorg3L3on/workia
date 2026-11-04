# Privacidad, conservación y ARCO

Workia 2.0, tarea W2-09. Los datos personales siguen la LFPDPPP vigente (la
ley de 2025) desde la primera carga de archivos. Cada empresa es la
«responsable» de los datos de su gente, así que todo vive por empresa con la
misma RLS que las demás tablas (migración 0033).

## Qué hay

| Pieza                   | Dónde                                                     |
| ----------------------- | --------------------------------------------------------- |
| Aviso versionado        | `privacy_notices`; RH publica en `/app/privacidad`        |
| Aceptación              | `privacy_notice_acceptances` (versión, fecha y canal)     |
| Registro de accesos     | `personal_data_access_log`; `recordPersonalDataAccess()`  |
| Solicitudes ARCO        | `arco_requests`; RH las registra y cierra                 |
| Exportación de acceso   | `GET /app/privacidad/arco/[id]/exportar` (JSON)           |
| Conservación y su tarea | `src/lib/privacy/retention.ts`, `GET /api/cron/retention` |

Permisos: `privacy:read` y `privacy:manage`, solo para `super_admin` y
`admin`. Producción necesita `npm run db:sync-permissions` después de la
migración para que los roles existentes los reciban.

## Aviso de privacidad

- Una versión publicada no se edita; un cambio es una versión nueva.
- La persona acepta la versión vigente. `pendingPrivacyNotice(companyId,
personId)` devuelve el aviso que le falta aceptar o `null`.
- `recordPrivacyAcceptance()` guarda versión y fecha; aceptar dos veces
  conserva la primera. Solo se acepta la versión vigente.
- RH puede registrar una aceptación firmada en papel (canal `hr`).

**Para W2-01 (cuentas de empleado):** al iniciar sesión, antes de cualquier
otra pantalla, llama `pendingPrivacyNotice`; si no es `null`, muestra el texto
y guarda la aceptación con `channel: "employee_app"`.

## Registro de accesos

Toda ruta que entregue un archivo o documento sobre una persona escribe una
fila con `recordPersonalDataAccess()` en la misma petición, de preferencia en
la misma transacción que su evento de auditoría. Ya lo hacen:

- el PDF del contrato (`contract_pdf`),
- la constancia de vacaciones (`vacation_constancia`),
- la exportación ARCO (`arco_export`).

**Para W2-03 (recibos) y W2-04 (archivos de documentos):** cada descarga o
URL firmada que se entregue escribe `payroll_receipt` o `document_file`, con
`actorKind: "employee"` cuando la abre la persona.

## ARCO

- Tipos: acceso, rectificación, cancelación y oposición.
- `due_on` = fecha de recepción + 20 días naturales. Contar naturales nunca da
  una fecha posterior a contar hábiles (pendiente de revisión legal).
- Una solicitud abierta se cierra como «Atendida» o «Improcedente», con la
  respuesta que se dio. Cerrada no se reabre.
- La exportación de acceso se genera al momento con todo lo que Workia tiene
  de la persona: expediente, contratos, periodos, horarios, beneficiarios,
  documentos, vacaciones, resguardo, altas, aceptaciones, solicitudes ARCO,
  registro de accesos e historial de su expediente. Cada descarga queda en el
  registro de accesos y en auditoría.
- La rectificación y la cancelación se ejecutan con las pantallas que ya
  existen (editar o dar de baja el expediente); la solicitud guarda qué se
  hizo.

**Para W2-01:** la app de empleado registra solicitudes con
`createArcoRequest(companyId, { ..., channel: "employee_app" })`.

## Conservación

La tabla vive en `RETENTION_POLICY` y se muestra en la pestaña Conservación.
La tarea solo borra lo marcado como automático:

- registro de accesos: 24 meses desde el acceso,
- solicitudes ARCO cerradas: 5 años desde el cierre (las abiertas nunca).

Nunca borra expedientes, contratos, periodos ni vacaciones: la LFT, la LSS y
el CFF obligan a conservarlos. Borra por lotes de 500 filas, empresa por
empresa, y deja un evento de auditoría `data_retention` por empresa cuando
borró algo.

La ruta `GET /api/cron/retention` responde 404 sin `CRON_SECRET` y 401 sin el
`Authorization: Bearer <CRON_SECRET>` correcto (el encabezado que manda Vercel
Cron). **Jorge decide** si agrega la variable y la entrada de cron; esta tarea
no cambia `vercel.json` ni nada de Vercel o Neon. Una vez al día alcanza.

## Cifrado en reposo

Los archivos (recibos, documentos, contratos) nunca van en Neon. El
almacenamiento de objetos que se elija (pregunta abierta del plan) debe:

- cifrar en reposo (lo hacen por defecto los servicios gratuitos comunes),
- ser privado, con URLs firmadas de vida corta,
- y cada URL firmada que se entregue escribe su fila en el registro de
  accesos.

## Pendiente de Jorge

- Revisión legal del texto del aviso, del plazo ARCO y de los plazos de
  conservación contra la LFPDPPP 2025 y su autoridad.
- `CRON_SECRET` y la entrada de cron, si se quiere el borrado automático.
- `npm run db:sync-permissions` en producción después de aplicar 0033.
