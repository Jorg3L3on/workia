# Personas import and export format

Source of truth for the columns is `src/lib/import/format.ts`; the template
(`Personas > Descargar plantilla`), the importer and the exporter all read it.
Plania: WRK-I3.

## Files

- **XLSX** (primary): sheets `Instrucciones`, `Personas`, `Horarios`,
  `Contratos` and `Catálogos`. Dropdowns on Área, Puesto, Sucursal, Estatus,
  Tipo, Aviso and Plantilla come from `Catálogos` (live catalogs).
- **CSV** (UTF-8 with BOM): `Personas` only, same columns.
- Export and import use the same format, so an exported file imports back as
  "unchanged".
- v1 limits: 5,000 rows and 10 MB per file.
- Libraries: `exceljs` writes the template/export on the server only (never in
  the client bundle); `read-excel-file` reads files in the browser.

## Matching a row to a person

1. `ID Workia`, if present.
2. Otherwise `CURP`.
3. Otherwise `RFC`.

No key means a new person, flagged as a possible duplicate when name + date of
birth match an existing one. Horarios and Contratos rows find their person by
`ID Workia` or `CURP`.

## Personas

| Header (canonical)       | Key               | Notes                                               |
| ------------------------ | ----------------- | --------------------------------------------------- |
| ID Workia                | `idWorkia`        | Empty for new people                                |
| Nombres \*               | `nombres`         | Required                                            |
| Apellido paterno \*      | `apellidoPaterno` | Required                                            |
| Apellido materno         | `apellidoMaterno` |                                                     |
| Correo electrónico       | `email`           |                                                     |
| Teléfono                 | `telefono`        |                                                     |
| Fecha de nacimiento      | `fechaNacimiento` | Date                                                |
| Fecha de ingreso         | `fechaIngreso`    | Date                                                |
| Área / Puesto / Sucursal | `area` ...        | Catalog names; unknown name = error unless creating |
| Jefe directo (CURP)      | `jefeDirecto`     | CURP or ID Workia; resolved in a second pass        |
| RFC / CURP / NSS         | `rfc` ...         | Normalized (uppercase, no spaces) and validated     |
| Estatus                  | `estatus`         | `Activa` (default) or `Baja`                        |

## Horarios

`ID Workia` or `CURP`, `Entrada`, `Salida a comer`, `Regreso de comer`,
`Salida`. Times are `HH:MM` 24h.

## Contratos

`ID Workia` or `CURP`, `Tipo` \* (`Determinado`/`Indeterminado`),
`Fecha de inicio` \*, `Fecha de fin` (required when determinado),
`Aviso (meses)` (`1`, `2`, `3`, `6`, `No avisar`), `Estatus` (`Vigente`,
`Renovado`, `No renovado`, `Vencido`; empty is derived from the dates),
`Plantilla` (optional for historical contracts).

## Headers

Header matching ignores case, accents, spaces, underscores and punctuation, so
`Apellido Paterno`, `apellido_paterno` and `APELLIDO PATERNO` are the same
column. Extra accepted aliases are listed in `format.ts`. Unknown headers are
reported (and can be mapped by hand in the wizard); a header that resolves to a
column another header already took is a duplicate and is rejected.

## Dates and times

Dates: `YYYY-MM-DD`, `DD/MM/YYYY`, a real Excel date cell, or an Excel serial
number. Impossible dates (`31/02/2024`) are errors. Times: `H:MM`, `HH:MM[:SS]`
or an Excel time fraction.
