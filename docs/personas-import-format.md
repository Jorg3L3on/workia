# Personas import and export format

Source of truth for the columns is `src/lib/import/format.ts`; the template
(`Personas > Descargar plantilla`), the importer and the exporter all read it.
Plania: WRK-I3.

## Files

- **XLSX** (primary): sheets `Instrucciones`, `Ejemplo`, `Personas`,
  `Horarios`, `Contratos` and `Catálogos`. Dropdowns on Área, Puesto,
  Sucursal, Estatus, Tipo de baja, Motivo de baja, Recontratable, Tipo, Aviso
  and Plantilla come from `Catálogos` (live catalogs; Motivo de baja lists the
  company's active motivos) and refuse other values (`errorStyle: stop`); the server still
  validates everything, because pasted values, LibreOffice and Google Sheets
  skip Excel's checks.
- **CSV** (UTF-8 with BOM): `Personas` only, same columns.
- Export and import use the same format, so an exported file imports back as
  "unchanged".
- Limits: 5,000 people (Personas rows), 5,000 Horarios rows, 10,000
  Contratos rows and 10 MB per file. The browser checks them before uploading
  and the server enforces them on the rows it actually stored (rows endpoint
  and finalize answer `413` with `code: "too_many_rows"`), whatever
  `totalRows` the browser announced. Row numbers must be 2–1,048,576 and
  unique within a chunk; a cell holds at most 1,000 characters.
- Libraries: `exceljs` writes the template/export on the server only (never in
  the client bundle); `read-excel-file` reads files in the browser.

## Template

- **Ejemplo**: four fictional people (fictional `XEXX…` identifiers), one of
  them de baja with its data, in the Personas layout, under a banner that says the sheet is not imported. The
  reader only reads sheets named Personas, Horarios and Contratos, and never
  reads `Ejemplo` as Personas, even when it is the only sheet.
- **Headers**: required columns in dark blue (white text), optional ones in
  light blue, `ID Workia` in grey; every header has a cell comment with its
  help, and Instrucciones has the legend.
- **ID Workia** is the last column on every sheet ("déjalo vacío en altas
  nuevas"). Columns are read by header and alias, never by position, so files
  with the old order (ID Workia first, `Jefe directo (CURP)`) still import.
- **Text columns**: CURP, RFC, NSS and Teléfono use the `@` format, so leading
  zeros survive.
- **Dates**: `yyyy-mm-dd` format plus a date validation from 1900-01-01 to a
  year after the download. Instrucciones warns that an English-locale Excel
  turns a typed `03/04/2026` into March 4 before Workia sees it.
- **Puesto depends on Área**: `Catálogos` lists the puestos of each area in
  one block per area (positions without an area appear in every block), each
  behind a defined name `PuestosArea_<n>`; the Puesto list is
  `IF(ISNA(MATCH(área, Areas, 0)), Puestos, INDIRECT("PuestosArea_" & MATCH(…)))`.
  Where the spreadsheet app does not evaluate that list (some Google Sheets
  and LibreOffice versions), the server is the check: it resolves a puesto
  repeated across areas by the row's Área and otherwise lists the areas that
  have it.
- **Jefe directo** suggests the active people whose full name is unique
  (`Catálogos`, "Personas activas"); the list does not refuse other values,
  because a CURP, an ID Workia or a person of the same file are valid too.

## Matching a row to a person

1. `ID Workia`, if present.
2. Otherwise `CURP`.
3. Otherwise `RFC`.

No key means a new person, flagged as a possible duplicate when name + date of
birth match an existing one. Horarios and Contratos rows find their person by
`ID Workia` or `CURP`.

## Personas

| Header (canonical)                      | Key               | Notes                                                  |
| --------------------------------------- | ----------------- | ------------------------------------------------------ |
| Nombres \*                              | `nombres`         | Required                                               |
| Apellido paterno \*                     | `apellidoPaterno` | Required                                               |
| Apellido materno                        | `apellidoMaterno` |                                                        |
| Correo electrónico                      | `email`           |                                                        |
| Teléfono                                | `telefono`        |                                                        |
| Fecha de nacimiento                     | `fechaNacimiento` | Date                                                   |
| Fecha de ingreso                        | `fechaIngreso`    | Date                                                   |
| Área / Puesto / Sucursal                | `area` ...        | Catalog names; unknown name = error unless creating    |
| Jefe directo (nombre, CURP o ID Workia) | `jefeDirecto`     | See below; resolved in a second pass                   |
| RFC / CURP / NSS                        | `rfc` ...         | Normalized (uppercase, no spaces) and validated        |
| Fecha de antigüedad                     | `fechaAntiguedad` | Date; see «Bajas y antigüedad»                         |
| Estatus                                 | `estatus`         | `Activa` (default) or `Baja`                           |
| Fecha de baja                           | `fechaBaja`       | Date; only with Estatus Baja                           |
| Tipo de baja                            | `tipoBaja`        | `Voluntaria`, `Despido`, `Término de contrato`, `Otra` |
| Motivo de baja                          | `motivoBaja`      | Name in Catálogo > Motivos de baja                     |
| Comentario de baja                      | `comentarioBaja`  | Optional, ≤ 1,000 characters                           |
| Recontratable                           | `recontratable`   | `Sí` / `No`                                            |
| ID Workia                               | `idWorkia`        | Empty for new people; last column                      |

Jefe directo accepts, in this order: an ID Workia, a CURP, or a full name
(nombres + apellidos, ignoring case and accents). Each is looked up among the
rows of the same file and the company's non-deleted people. A name resolves
only when exactly one person has it; otherwise the row gets an error that
says to use the CURP or ID Workia, and never names the other people. Old
headers (`Jefe directo (CURP)`, `Jefe directo (CURP o ID Workia)`) still map
to this column.

## Bajas y antigüedad

The baja columns go through the employment domain (`src/lib/people/employment.ts`),
inside the import's batch transaction, with the same rules and audit as the
«Dar de baja» dialog (audit source `import`). What a row does, decided by
`planEmployment()` in `person-rows.ts` against the person's current (or last)
employment period:

- **Estatus Baja with the baja columns** on someone active (or a new person):
  `recordTermination()` closes the open period with fecha, tipo, motivo,
  comentario and recontratable, sets the person de baja and turns the vigente
  contract into «Terminado» ending on the fecha de baja.
- **Estatus Baja with the baja columns on someone already de baja**:
  `correctTermination()` writes them on the last period. A blank cell keeps
  the stored value, as in every column; a baja «sin fecha» that gets its date
  ends the vigente contract, and stops needing review.
- In both cases Fecha de baja, Tipo de baja, Motivo de baja and Recontratable
  must all be known (in the row or already stored); the error names the
  missing ones. The fecha de baja cannot be before the fecha de ingreso, and
  the fecha de ingreso of someone de baja cannot move after the baja.
- **Estatus Baja without baja columns** on someone active keeps the old
  behaviour: the open period closes «sin fecha» and is marked for review
  (`requiere_revision`). The row gets a warning, not an error.
- Baja columns with Estatus Activa (or blank on someone active) are an error:
  write Baja or clear them.
- **Motivo de baja** is matched by name (case and accents ignored) among the
  company's motivos only; a name or id of another company never resolves. A
  new motivo must be active; a motivo deactivated after the baja is accepted
  unchanged, so old exports still import.
- **Fecha de antigüedad** is only stored for active people, as the open
  period's recognized seniority (`reconoce_antiguedad`,
  `fecha_antiguedad_reconocida`, `recognizeSeniority()`), and only when it
  differs from the fecha de ingreso and from the date seniority already
  counts from. It cannot be after the fecha de ingreso. On someone de baja a
  different value is ignored with a warning.
- The **finiquito** is not an import column, in either direction: it is
  captured in the expediente, and its amount needs `compensation:read`.

The export writes Fecha de antigüedad for everyone (`seniorityDate()` of the
current period) and the baja columns for people de baja, from
`listEmploymentSummaries()`; re-importing it changes nothing.

**Undo**: before writing, the import stores the person's periods and vigente
contracts in the row's `previous_snapshot.employment` (for rows that change
the status, the ingreso, the baja or the antigüedad). Undo deletes the
periods the import opened, restores the others field by field (closed ones
first, so at most one is open) and puts the contracts back to vigente with
their end date. Undo is refused when, after the import, someone edited a
period of that person (a finiquito, a reingreso), a snapshotted contract, or
started an alta a nómina on a period the import opened.

## Horarios

`CURP` or `ID Workia`, `Entrada`, `Salida a comer`, `Regreso de comer`,
`Salida`. Times are `HH:MM` 24h.

## Contratos

`CURP` or `ID Workia`, `Tipo` \* (`Determinado`/`Indeterminado`),
`Fecha de inicio` \*, `Fecha de fin` (required when determinado),
`Aviso (meses)` (`1`, `2`, `3`, `6`, `No avisar`), `Estatus` (`Vigente`,
`Renovado`, `No renovado`, `Vencido`, `Terminado`; empty is derived from the
dates),
`Plantilla` (optional for historical contracts).

## Headers

Header matching ignores case, accents, spaces, underscores and punctuation, so
`Apellido Paterno`, `apellido_paterno` and `APELLIDO PATERNO` are the same
column. Extra accepted aliases are listed in `format.ts`. Unknown headers are
reported (and can be mapped by hand in the wizard); a header that resolves to a
column another header already took is a duplicate and is rejected.

## Dates and times

Dates: `YYYY-MM-DD`, `DD/MM/YYYY`, a real Excel date cell, or an Excel serial
number. Text dates are always read day first (`03/04/2026` is April 3), never
month first. Impossible dates (`31/02/2024`) are errors. Times: `H:MM`,
`HH:MM[:SS]` or an Excel time fraction.

## Error messages

Each error names the column and says how to fix it, e.g. "NSS inválido.
Escribe el NSS como texto: 11 dígitos, con ceros al inicio." Errors about
another person (a CURP, RFC or NSS already taken, an ambiguous manager name)
never show that person's data.

## Validation and "todo o nada"

Validation runs in steps of 500 rows that the page repeats. Repeated keys in
the file are found once per run, before the first chunk; Horarios and
Contratos chunks only read the rows of their own people, so no step reads the
whole file again. With "Todo o nada", apply first validates the whole file
again in the same kind of steps (`phase: "validating"` in the apply
response) and applies nothing if any row has errors.
