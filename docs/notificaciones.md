# Notificaciones (Workia 2.0 W2-08)

Un solo canal de avisos para las dos apps: el aviso queda en una bandeja dentro
de la app y, además, sale por correo y por web push. Costo cero: no hay
WhatsApp, SMS ni servicios de pago. El correo usa el mismo SMTP de W2-01
(`EMAIL_SMTP_URL`, `EMAIL_FROM`); web push usa llaves VAPID, que son gratis.

## Quién recibe y dónde lo lee

| Destinatario                                         | Bandeja       | Correo                                              | Web push                            |
| ---------------------------------------------------- | ------------- | --------------------------------------------------- | ----------------------------------- |
| Persona (empleado o jefe, con su cuenta de empleado) | `/mi/avisos`  | el de su cuenta de empleado activa                  | cada teléfono que lo activó         |
| Usuario de RH                                        | `/app/avisos` | el de su usuario, mientras su membresía esté activa | no (RH lee en la app de escritorio) |

La campana del encabezado de `/app` y la tarjeta «Avisos» de `/mi` muestran
cuántos avisos no se han leído (hasta «99+»).

## Plantillas

Están en `src/lib/notifications/templates.ts`. El texto se guarda al crear el
aviso, así que la bandeja se lee igual años después.

| Plantilla           | Para                          | La envía                         |
| ------------------- | ----------------------------- | -------------------------------- |
| `receipt_available` | la persona                    | W2-03 recibos de nómina          |
| `request_decision`  | la persona que pidió          | W2-05 vacaciones, W2-06 permisos |
| `document_rejected` | la persona                    | W2-04 documentos                 |
| `contract_ending`   | su jefe y RH                  | W2-19 alertas LFT                |
| `request_pending`   | el jefe (`people.manager_id`) | W2-06 bandeja de aprobaciones    |
| `absence_warning`   | su jefe y RH                  | W2-19 alertas LFT                |
| `absence_threshold` | su jefe y RH                  | W2-19 alertas LFT                |
| `document_expiring` | su jefe y RH                  | W2-19 alertas LFT                |

Las tres de W2-19 se agregaron en la migración 0053 (docs/alertas-lft.md).

## Cómo se usa desde otra tarea

```ts
import {
  createNotifications,
  hrRecipientsWithPermission,
  managerRecipientOf,
  notify,
  personRecipient,
  sendNotificationsSoon,
} from "@/lib/notifications";

// Fuera de una transacción: escribe y envía después de la respuesta.
await notify(companyId, {
  template: "request_decision",
  data: { request: "vacaciones", decision: "aprobada", from, to },
  recipients: [personRecipient(personId)],
  eventKey: `vacation_record:${recordId}:aprobada`,
});

// Dentro de la transacción del evento: el aviso se confirma con él.
await withTransaction(async (tx) => {
  // ... el cambio ...
  await createNotifications(companyId, input, tx);
}, companyId);
await sendNotificationsSoon(companyId);
```

- `eventKey` hace el aviso idempotente: el mismo evento crea un solo aviso por
  destinatario aunque se reintente.
- `url` (opcional) debe ser una ruta de la app (`/mi/...`, `/app/...`); una URL
  externa se rechaza.
- `hrRecipientsWithPermission(companyId, "contracts:update")` da los usuarios
  de RH con ese permiso; `managerRecipientOf(companyId, personId)` da al jefe.

## Bitácora de entrega y reintentos

Cada aviso tiene una fila por canal en `notification_deliveries`:

- `in_app` se escribe como `sent` con el aviso: la bandeja nunca falla.
- `email` y `push` empiezan `pending`. Si el destinatario apagó el canal,
  quedan `skipped` con `opted_out`.
- Al enviar: `sent`; `skipped` con el motivo (`no_address`, `no_device`,
  `not_configured`, `opted_out`); o, si falla, vuelve a `pending` y se
  reintenta a 1 min, 5 min, 30 min, 2 h y 12 h. Tras el quinto intento queda
  `failed`. El aviso sigue en la bandeja en todos los casos.
- Un teléfono que el servicio push ya no reconoce (404/410) se borra.
- Las filas se toman con `FOR UPDATE SKIP LOCKED` y un préstamo de 10 min, así
  dos envíos simultáneos no mandan el mismo correo dos veces.

Quién envía, sin configuración nueva de plataforma:

1. Después de la respuesta que creó el aviso (`after()` de Next.js). Ese mismo
   envío toma también los reintentos vencidos de la empresa.
2. Opcional: `GET /api/cron/notifications` con `Authorization: Bearer
<CRON_SECRET>` barre todas las empresas. Responde 404 mientras
   `CRON_SECRET` no exista. Agregar la entrada de cron es decisión de Jorge
   (configuración de Vercel).

## Apagar un canal

Cada destinatario apaga el correo desde su bandeja; el empleado activa o
desactiva push por teléfono. La bandeja no se puede apagar. Activar push en un
teléfono vuelve a encender el canal push de esa persona.

## Retención

Los avisos de más de 365 días se borran con su bitácora, 500 por vez, en cada
envío de la empresa (`NOTIFICATION_RETENTION_DAYS` en `policy.ts`). Es una
propuesta para el plan Free de Neon; se ajusta junto con la política de
retención de W2-09.

## Configuración (pasos de Jorge)

| Variable                                                 | Para qué                                        | Sin ella                                |
| -------------------------------------------------------- | ----------------------------------------------- | --------------------------------------- |
| `EMAIL_SMTP_URL`, `EMAIL_FROM`                           | correo (ya existen por W2-01)                   | en producción el correo queda `skipped` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | web push; generar con `npm run push:vapid-keys` | no se ofrece push                       |
| `APP_PUBLIC_URL`                                         | enlaces en los correos                          | usa el dominio de producción de Vercel  |
| `CRON_SECRET`                                            | barrido opcional de reintentos                  | la ruta responde 404                    |

Cambiar las llaves VAPID borra en la práctica todos los teléfonos guardados:
cada persona tendría que activar push de nuevo.

## Tablas (migración 0040)

`notifications`, `notification_deliveries`, `push_subscriptions` y
`notification_opt_outs`, todas con `company_id` y la misma RLS por empresa. La
función `notification_due_companies()` (SECURITY DEFINER) solo responde qué
empresas tienen entregas vencidas, para el barrido sin sesión. Las bandejas se
leen con un índice `(company_id, destinatario, created_at DESC, id DESC)` y un
cursor keyset, sin OFFSET.
