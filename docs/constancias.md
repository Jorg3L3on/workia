# Contrato y constancias en la app de empleados (Workia 2.0 W2-11)

La persona descarga su constancia de antigüedad y sus contratos, y acepta su
resguardo desde el teléfono. Todo sale de la sesión de empleado
(`requireEmployeeContext()` / `getEmployeeContext()`): ninguna ruta toma el id
de la persona.

## Pantallas y rutas

| Dónde                           | Qué hace                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `/mi` (tarjeta)                 | Descarga la constancia y el contrato vigente (o el último); enlaza a contratos y resguardo.  |
| `/mi/contrato`                  | Constancia y lista de todos los contratos de la persona, cada uno con su PDF.                |
| `/mi/constancia/pdf`            | PDF de la constancia de antigüedad, con fecha de hoy, del mismo generador que usa RH.        |
| `/mi/contrato/[contractId]/pdf` | PDF de un contrato propio. Contrato de otra persona o de otra empresa: 404. Sin sesión: 401. |
| `/mi/resguardo`                 | Activos a nombre de la persona, con su entrega y el botón «Acepto el resguardo».             |

## Contrato: sin almacenamiento de archivos

Workia guarda el contrato como texto generado (`contracts.generated_text`). El
PDF se dibuja al pedirlo con `renderContractPdf` (el mismo de RH), así que no
hay archivo que guardar ni bucket que pagar. Si algún día se suben contratos
firmados escaneados, irían al almacenamiento de W2-04 (`src/lib/storage`,
`objectKey(..., "contracts", ...)`).

La constancia usa `renderLetterPdf` (misma fuente y formato) sobre el texto de
`getSeniorityCertificate`, con las líneas de firma y sello. Para un trámite
que pida firma y sello, la persona la lleva a RH.

## Bitácora

Cada descarga escribe, en la misma transacción:

- una fila en `personal_data_access_log` (W2-09) con `actor_kind = 'employee'`
  y recurso `contract_pdf` o `seniority_letter` (nuevo en 0041);
- un evento de auditoría `export` con `actor_employee_account_id`.

La vista de la constancia en RH (`/app/personas/[id]/constancia`) también
registra `seniority_letter` con `actor_kind = 'hr_user'`.

## Resguardo

Migración `0041_constancias_resguardo`: `asset_movements` gana `accepted_at` y
`accepted_by_employee_account_id`.

- Sólo una entrega se acepta (`asset_movements_acceptance_check`), y sólo la
  entrega vigente de un activo que la persona tiene hoy. Una entrega vieja, de
  un activo ya devuelto o de otra persona: «Este resguardo ya no está a tu
  nombre».
- Aceptar dos veces conserva la primera fecha.
- Es un clic registrado con la cuenta y la hora, más un evento de auditoría
  `accept`; no es firma electrónica (fuera del plan por costo).
- RH ve «Entrega · aceptada el …» en el historial del activo
  (`/app/resguardo/[id]`) y el evento en la auditoría.

## Pruebas

`src/test/idor/employee-constancias.db.test.ts`: aislamiento por persona y por
empresa de las dos rutas y de la acción, bitácora de cada descarga, y el
rechazo en base de datos de una aceptación sobre una devolución.

## Al liberar

- Correr la migración 0041 (después de 0030 y 0033).
- Si otra migración también redefine `personal_data_access_log_resource_check`
  (por ejemplo para recibos o documentos), la última en aplicarse debe incluir
  `seniority_letter`.
