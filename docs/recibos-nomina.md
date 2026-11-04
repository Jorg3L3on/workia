# Recibos de nómina

Workia 2.0, tarea W2-03. Cada persona abre y descarga desde su teléfono el
CFDI de nómina de cada periodo (PDF y XML). Workia **no calcula la nómina ni
guarda montos**: reparte lo que el proveedor de nómina ya timbró. Tampoco
valida el CFDI ante el SAT.

## Qué hay

| Pieza               | Dónde                                                                 |
| ------------------- | --------------------------------------------------------------------- |
| Periodos y recibos  | `payroll_periods`, `payroll_receipts` (migración 0042)                |
| Números de empleado | `payroll_employee_numbers`: el NumEmpleado del proveedor por persona  |
| Archivos            | Almacenamiento de objetos (`src/lib/storage`), nunca en Neon          |
| Pantalla de RH      | `/app/nomina` y `/app/nomina/[periodo]`                               |
| Subida de un recibo | `POST /api/nomina/periodos/[periodId]/recibos` (XML + PDF)            |
| Descarga de RH      | `GET /app/nomina/recibos/[id]/pdf` o `/xml`                           |
| App de la persona   | `/mi/recibos`; descarga en `GET /mi/recibos/[id]/pdf` o `/xml`        |
| Lectura del CFDI    | `src/lib/payroll/cfdi.ts`: UUID, receptor, CURP, NumEmpleado y fechas |

Permisos: `payroll_receipts:read` (ver periodos, porcentaje de apertura,
descargar) y `payroll_receipts:manage` (importar, asignar, publicar,
descartar), solo para `super_admin` y `admin`. El permiso `payroll:approve`
de altas no cambia. Producción necesita `npm run db:sync-permissions` después
de la migración.

## Flujo

1. RH abre **Nómina → Importar recibos** y elige el zip del proveedor.
2. El navegador abre el zip y empareja cada XML con el PDF del mismo nombre
   (sin importar carpetas ni mayúsculas). Propone el periodo con las fechas
   que trae la mayoría de los CFDI (`FechaInicialPago`, `FechaFinalPago`).
3. Se crea el periodo como borrador y se sube **un recibo por petición**, de
   4 en 4, con reintentos. Así ninguna petición pasa del límite de 4.5 MB de
   una función de Vercel, aunque el zip pese cientos de MB.
4. Cada recibo se asigna en el servidor (ver abajo). Un CFDI ya importado en
   la empresa (mismo UUID) se omite, así que un zip se puede volver a subir
   después de una interrupción («Agregar recibos» en el periodo).
5. RH revisa los **sin asignar** y los asigna a mano.
6. **Publicar** entrega los recibos asignados y manda un correo a cada
   persona con cuenta activa y correo verificado. Un recibo asignado después
   de publicar se entrega en ese momento.
7. Un borrador equivocado se **descarta**: se borran el periodo, sus recibos y
   sus archivos. Un periodo publicado no se descarta.

## Asignación

En este orden, solo con personas no borradas de la misma empresa (una persona
en baja sí se asigna, porque el finiquito también tiene recibo):

1. **CURP** del complemento de nómina (`nomina12:Receptor/@Curp`). Así se
   asigna aunque la persona no tenga RFC en Workia.
2. **NumEmpleado**, si ya se aprendió: cada vez que un recibo se asigna por
   CURP, por RFC o a mano, su NumEmpleado queda ligado a la persona.
3. **RFC** del receptor. Los RFC genéricos del SAT (`XAXX010101000`,
   `XEXX010101000`) nunca asignan.

Lo que no se asigna queda en la lista de RH con el nombre, CURP, número y
RFC que trae el CFDI.

## Descargas y privacidad

- La persona solo ve sus recibos entregados; la ruta toma la persona de la
  sesión, nunca de la URL.
- Cada descarga, de RH o de la persona, escribe el registro de accesos (W2-09,
  recurso `payroll_receipt`) y luego redirige a un enlace firmado de 2
  minutos. El archivo no pasa por la función.
- La primera vez que la persona abre su recibo se guarda `opened_at`; RH
  abriéndolo no cuenta. RH ve el porcentaje abierto por periodo.
- La exportación ARCO incluye los recibos (identificadores y fechas).
- Conservación: al menos 5 años desde el pago (CFF art. 30), sin borrado
  automático. Pendiente de la revisión legal de W2-09.

## Neon Free

- Una fila pequeña por recibo, sin montos ni archivos: 500 personas por 24
  quincenas son 12,000 filas al año.
- La subida hace pocas consultas por recibo y nada se queda corriendo, así
  que el cómputo vuelve a dormir al terminar.
- Las descargas son redirecciones: los bytes salen del almacenamiento, no de
  Neon ni de Vercel.

## Pendiente

- **Proveedor de nómina y formato de exportación:** sin decidir. La
  importación acepta cualquier zip de XML (CFDI 4.0 o 3.3 con nómina 1.2) y
  PDF con el mismo nombre. Si el proveedor no entrega PDF, la persona
  descarga solo el XML.
- **SFTP:** no se construyó. Bajar el zip de un SFTP necesita el proveedor y
  una tarea programada (cron de Vercel), que son decisiones de Jorge.
- **Almacenamiento:** usa la interfaz compartida con W2-04. En producción no
  hay subida hasta configurar un bucket compatible con S3 (`S3_*`, ver
  `.env.example`); la pantalla lo dice y desactiva el botón.
- **Correo gratuito:** el aviso usa el SMTP de W2-01. Si el remitente tiene
  un límite diario, un periodo grande puede rebasarlo; el recibo queda en la
  app de todos modos. W2-08 (notificaciones) puede tomar esta plantilla.
- **Línea de tiempo:** este cambio no escribe eventos `receipt` en
  `person_events`, porque la tabla (P-01) y sus escritores (W2-13) viven en
  otra rama. Cuando las dos estén en `sandbox`, la publicación y la
  asignación a mano llaman `receiptEvent()` con `appendPersonEvents()` en su
  misma transacción.
