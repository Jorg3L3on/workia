# Archivos de documentos y revisión (Workia 2.0 W2-04)

La persona sube desde el teléfono el archivo de cada documento que pide su
puesto; RH lo acepta o lo rechaza. Revierte a propósito la regla de 0028
(«solo nombres, sin archivos»).

## Flujo

1. **Empleado** (`/mi/documentos`): ve las mismas filas que la tarjeta
   «Documentos» del expediente. Dos pasos: «Subir foto o PDF» (el teléfono
   ofrece cámara, galería o archivos) y «Enviar». Las fotos grandes se
   reducen en el navegador a JPEG de 2000 px como máximo.
2. La fila queda `status = 'uploaded'` y **no cuenta** como entrega.
   Solo puede haber una pendiente por persona y requisito.
3. **RH** (`/app/documentos/revision`, `documents:read` para ver,
   `documents:manage` para decidir): cola ordenada por la subida más antigua.
   - **Aceptar**: la fila pasa a `accepted` y es la entrega, con las reglas de
     siempre (la más reciente por requisito; vencimiento desde
     `validity_months` a partir de la fecha de subida, o el que RH escriba, o
     «No vence»).
   - **Rechazar**: motivo de una lista cerrada (`illegible`,
     `wrong_document`, `expired`, `incomplete`, `wrong_person`). Sin texto
     libre, para que no se guarden datos de salud. El archivo se borra; la
     fila queda con su motivo y la persona puede subir otro.

La bandeja «Por vencer», la herramienta MCP y la tarjeta solo leen filas
`accepted`. Las entregas que RH registra a mano siguen igual (aceptadas, sin
archivo).

## Privacidad (W2-09)

- No se puede subir nada sin un aviso de privacidad publicado y aceptado por
  la persona; `/mi/documentos` muestra el aviso y el botón para aceptarlo.
- Cada apertura de un archivo (empleado o RH) escribe
  `personal_data_access_log` (`document_file`) y redirige a una URL firmada de
  cinco minutos.
- El tipo de archivo se lee de sus primeros bytes (PDF, JPEG, PNG, WebP);
  máximo 4 MB (Vercel limita el cuerpo a 4.5 MB).

## Almacenamiento (`src/lib/storage`)

Los archivos nunca van en Neon. Interfaz compartida con W2-03 (recibos):
`getObjectStorage()` devuelve un driver o `null`.

- `s3`: cualquier bucket compatible con S3 (por ejemplo el plan gratuito de
  Cloudflare R2 o Backblaze B2), firmado con SigV4 sin SDK. Variables:
  `S3_ENDPOINT`, `S3_REGION` (por defecto `auto`), `S3_BUCKET`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. El proveedor cifra en reposo.
- `local`: disco en `STORAGE_LOCAL_DIR` (por defecto `.storage/`), solo
  desarrollo y pruebas, servido por `/api/storage/local/...` con firma HMAC.
- En producción sin `S3_*` las subidas están apagadas y la app lo dice.

**Jorge decide** qué bucket usar y agrega las variables; esta tarea no cambia
nada de Vercel ni de Neon.

## Pendiente

- Al borrar a una persona, sus archivos quedan en el bucket (las filas se
  borran en cascada). Un trabajo de limpieza puede seguir a la decisión de
  retención.
- Subida, aceptación y rechazo escriben su evento `document` en la línea de
  tiempo (W2-13) en la misma transacción, y un rechazo avisa a la persona con
  `document_rejected` (W2-08).
