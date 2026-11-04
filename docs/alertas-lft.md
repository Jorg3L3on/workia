# Alertas LFT (Workia 2.0 W2-19)

RH y los jefes se enteran de un umbral legal antes de que se vuelva un caso.
Workia solo avisa: no decide ni redacta una rescisión. Costo cero: los avisos
salen por la bandeja de la app, correo y web push de W2-08; no hay WhatsApp,
SMS ni servicios de pago. Migración `0053_lft_alerts`, código en
`src/lib/lft-alerts`, bitácora en `/app/alertas`.

## Qué se avisa

| Alerta                   | Cuándo                                                                     | A quién en RH      | Jefe |
| ------------------------ | -------------------------------------------------------------------------- | ------------------ | ---- |
| Faltas: aviso preventivo | 3 faltas sin justificar en 30 días                                         | `pay_periods:read` | sí   |
| Faltas: más de tres      | 4 o más faltas sin justificar en 30 días (LFT art. 47, fr. X)              | `pay_periods:read` | sí   |
| Contrato por terminar    | contrato de la bandeja de renovaciones que termina en 30 días o menos      | `contracts:update` | sí   |
| Documento por vencer     | entrega de la bandeja «Documentos por vencer» que vence en 30 días o menos | `documents:manage` | sí   |

El jefe es `people.manager_id` (activo); lee el aviso en `/mi/avisos`. Sin
jefe, el aviso va solo a RH y la bitácora lo dice.

### El umbral legal

Artículo 47, fracción X, de la Ley Federal del Trabajo: es causa de rescisión
sin responsabilidad para el patrón que la persona tenga «más de tres faltas de
asistencia en un período de treinta días, sin permiso del patrón o sin causa
justificada». Por eso tres faltas es el aviso preventivo y la cuarta es el
umbral. El texto de la ley está una sola vez en `src/lib/lft-alerts/copy.ts`
(`LFT_ABSENCE_RULE`) y lo usan la bandeja, el correo, el push y la bitácora.

- **Falta sin justificar:** una incidencia `falta` del motor (W2-14) en vigor
  (la revisión más alta), no anulada y sin justificación (vacaciones, permiso,
  incapacidad u override). Una falta por retardo mayor a la regla de la empresa
  también cuenta, porque el motor la registra como falta.
- **Periodo de 30 días:** cualquier periodo de 30 días naturales seguidos,
  ambos extremos incluidos. Cada falta se cuenta con los 29 días anteriores.
- **Una vez por nivel:** si ya se envió un aviso del mismo nivel dentro de esos
  30 días, no se repite. Una racha nueva, más de 30 días después, avisa otra
  vez.
- Una falta del día sin checadas cargadas también es falta para el motor
  (docs/incidencias.md): por eso el aviso preventivo pide revisar si falta
  cargar checadas, permisos o incapacidades.

## Cuándo se revisa (sin cron)

1. Después de cada ingesta de checadas, para las personas que tocó (después
   del recálculo de incidencias).
2. Después de «Recalcular incidencias» y de «Cerrar quincena».
3. Una vez al día por empresa, después de que alguien de RH abre Inicio
   (`after()` de Next.js, no retrasa la página). Esa revisión primero
   recalcula la quincena actual y la anterior (si están abiertas), para que
   las faltas de quien nunca checó existan, y luego revisa todo. La tabla
   `lft_alert_runs` guarda la última vez; un upsert evita que dos pestañas la
   corran a la vez. Intervalo: 20 horas (`ALERT_RUN_INTERVAL_HOURS`).
4. El botón «Revisar ahora» de `/app/alertas` (requiere `pay_periods:read`,
   `contracts:update` o `documents:manage`).
5. Opcional: `GET /api/cron/lft-alerts` con `Authorization: Bearer
<CRON_SECRET>` revisa todas las empresas (las que ya se revisaron en 20 horas
   se saltan). Responde 404 sin `CRON_SECRET`. Agregar la entrada de cron es
   decisión de Jorge (configuración de Vercel); sin ella, una empresa que nadie
   abre no recibe la revisión diaria.

## Bitácora

`lft_alerts`: una fila por alerta, con la persona, el tipo, el hecho
(`subject_key`: el día de la falta que llegó al conteo, `<contrato>:<fin>` o
`<entrega>:<vencimiento>`, único por empresa y tipo), la fecha, el detalle
(conteo, días contados) y a cuántos de RH y si al jefe. Se escribe en la misma
transacción que los avisos, así una alerta nunca queda registrada sin aviso ni
se envía dos veces. La app solo inserta y lee (sin UPDATE ni DELETE), con RLS
por empresa. Se conserva aunque la bandeja borre sus avisos a los 365 días.
Tamaño: unas pocas filas por persona al año, adecuado para el plan Free de
Neon.

`/app/alertas` muestra la bitácora, la más reciente primero (cursor keyset),
solo de los tipos que el lector puede ver: faltas con `pay_periods:read`,
contratos con `contracts:read`, documentos con `documents:read`.

## Fuera de alcance

Decidir o redactar una rescisión, el aviso de rescisión y cualquier cálculo.
