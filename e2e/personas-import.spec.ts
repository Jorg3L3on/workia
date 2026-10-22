import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import ExcelJS from "exceljs";

import { generateImportFixture } from "../src/lib/import/testing/fixture";

// Needs the seeded local database (npm run db:seed) and an admin who can import.
const loginAsAdmin = async (page: Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("admin@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const counter = async (page: Page, label: string) => {
  const text = await page
    .getByRole("group", { name: "Resumen por acción" })
    .getByRole("button", { name: new RegExp(label) })
    .innerText();

  return Number(text.replace(/\D/g, ""));
};

const stageAndValidate = async (
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
  options: { createCatalogs: boolean },
) => {
  await page.goto("/app/personas/importar");
  await page.locator("#import-file").first().setInputFiles(file);
  await expect(
    page.getByRole("heading", { name: "Revisa las columnas" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Subir y revisar" }).click();
  await expect(
    page.getByRole("heading", { name: "Revisa antes de aplicar" }),
  ).toBeVisible({ timeout: 90_000 });

  if (options.createCatalogs) {
    await page
      .getByLabel("Crear áreas, puestos y sucursales que no existan")
      .check();
    await page
      .getByRole("button", { name: "Volver a validar con estas opciones" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Revisa antes de aplicar" }),
    ).toBeVisible({ timeout: 90_000 });
  }
};

test("imports, exports, re-imports unchanged and undoes", async ({ page }) => {
  test.setTimeout(240_000);

  const stamp = Date.now();
  const lastName = `E2E${stamp}`;
  const { buffer, summary } = await generateImportFixture({
    people: 60,
    run: 40 + (stamp % 50),
    withErrors: true,
    lastName,
  });
  const fileName = `e2e-${stamp}.xlsx`;
  const mimeType =
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  await loginAsAdmin(page);

  // Import → review → apply
  await stageAndValidate(
    page,
    { name: fileName, mimeType, buffer },
    { createCatalogs: true },
  );

  const errors = await counter(page, "Con errores");
  const created = await counter(page, "Crear");

  expect(errors).toBeGreaterThanOrEqual(summary.brokenPeople);
  expect(created).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Aplicar importación" }).click();
  await expect(
    page.getByRole("heading", { name: "Importación aplicada" }),
  ).toBeVisible({ timeout: 120_000 });

  // The imported people exist
  await page.goto(`/app/personas?q=${lastName}`);
  await expect(
    page.getByText("Fx").locator("visible=true").first(),
  ).toBeVisible();

  // Export just those people, then import the export: everything unchanged
  const exported = await page.request.get(
    `/app/personas/exportar?q=${lastName}`,
  );

  expect(exported.ok()).toBe(true);

  const exportDir = mkdtempSync(join(tmpdir(), "workia-e2e-"));

  writeFileSync(join(exportDir, "export.xlsx"), await exported.body());

  await stageAndValidate(
    page,
    {
      name: `export-${stamp}.xlsx`,
      mimeType,
      buffer: Buffer.from(await exported.body()),
    },
    { createCatalogs: false },
  );
  expect(await counter(page, "Crear")).toBe(0);
  expect(await counter(page, "Actualizar")).toBe(0);
  expect(await counter(page, "Con errores")).toBe(0);
  expect(await counter(page, "Sin cambios")).toBeGreaterThan(0);

  // Undo the first import from the history
  await page.goto("/app/personas/importaciones");

  const row = page.getByRole("row", { name: new RegExp(fileName) });

  await row.getByRole("button", { name: `Acciones de ${fileName}` }).click();
  await page.getByRole("menuitem", { name: "Deshacer importación" }).click();
  await expect(page.getByText(/Se revertirán \d+ filas/)).toBeVisible({
    timeout: 30_000,
  });
  await page
    .getByRole("button", { name: "Deshacer importación" })
    .last()
    .click();
  await expect(row.getByText("Deshecha")).toBeVisible({ timeout: 60_000 });

  await page.goto(`/app/personas?q=${lastName}`);
  await expect(page.getByText("Fx")).toHaveCount(0);
});

test("fills the downloaded template and applies it all or nothing", async ({
  page,
}) => {
  test.setTimeout(180_000);

  const stamp = Date.now();
  const lastName = `Plantilla${stamp}`;

  await loginAsAdmin(page);

  const download = await page.request.get("/app/personas/plantilla");

  expect(download.ok()).toBe(true);

  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(new Uint8Array(await download.body()).buffer);
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
    "Instrucciones",
    "Ejemplo",
    "Personas",
    "Horarios",
    "Contratos",
    "Catálogos",
  ]);

  const personas = workbook.getWorksheet("Personas")!;
  const headers = (personas.getRow(1).values as unknown[]).slice(1);
  const column = (label: string) => headers.indexOf(label) + 1;

  expect(headers.at(-1)).toBe("ID Workia");
  expect(headers).toContain("Jefe directo (nombre, CURP o ID Workia)");

  // A new boss and someone who reports to her by name; ID Workia stays empty.
  const add = (values: Record<string, string>) => {
    const row = personas.addRow([]);

    for (const [label, value] of Object.entries(values)) {
      row.getCell(column(label)).value = value;
    }
  };

  add({ Nombres: "Jefa", "Apellido paterno": lastName });
  add({
    Nombres: "Equipo",
    "Apellido paterno": lastName,
    "Jefe directo (nombre, CURP o ID Workia)": `Jefa ${lastName}`,
  });

  // Someone who already left, with the baja columns and a motivo of the
  // company's catalog (Catálogos lists the active ones).
  const catalogs = workbook.getWorksheet("Catálogos")!;
  const motivoColumn = (catalogs.getRow(1).values as unknown[]).indexOf(
    "Motivos de baja",
  );
  const motivo = String(catalogs.getRow(2).getCell(motivoColumn).value);

  add({
    Nombres: "Salida",
    "Apellido paterno": lastName,
    "Fecha de ingreso": "2021-01-04",
    Estatus: "Baja",
    "Fecha de baja": "2025-11-28",
    "Tipo de baja": "Voluntaria",
    "Motivo de baja": motivo,
    Recontratable: "Sí",
  });

  await stageAndValidate(
    page,
    {
      name: `plantilla-${stamp}.xlsx`,
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    },
    { createCatalogs: false },
  );
  expect(await counter(page, "Crear")).toBe(3);
  expect(await counter(page, "Con errores")).toBe(0);

  await page
    .getByLabel("Todo o nada: si hay errores no se aplica nada")
    .check();
  await page
    .getByRole("button", { name: "Volver a validar con estas opciones" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revisa antes de aplicar" }),
  ).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Aplicar importación" }).click();
  await expect(
    page.getByRole("heading", { name: "Importación aplicada" }),
  ).toBeVisible({ timeout: 120_000 });

  await page.goto(`/app/personas?q=${lastName}`);
  await expect(
    page.getByText("Equipo").locator("visible=true").first(),
  ).toBeVisible();
});
