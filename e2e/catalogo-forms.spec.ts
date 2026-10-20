import { expect, test } from "@playwright/test";

const loginAsDemoRrhh = async (page: import("@playwright/test").Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("rrhh@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const pages = [
  {
    path: "/app/catalogo/areas",
    title: "Áreas",
    create: "Nueva área",
    submit: "Crear área",
    extra: "Área padre (opcional)",
  },
  {
    path: "/app/catalogo/puestos",
    title: "Puestos",
    create: "Nuevo puesto",
    submit: "Crear puesto",
    extra: "Área (opcional)",
  },
  {
    path: "/app/catalogo/actividades",
    title: "Actividades",
    create: "Nueva actividad",
    submit: "Crear actividad",
    extra: "Activa",
  },
  {
    path: "/app/catalogo/sucursales",
    title: "Sucursales",
    create: "Nueva sucursal",
    submit: "Crear sucursal",
    extra: "Región (opcional)",
  },
  {
    path: "/app/catalogo/regiones",
    title: "Regiones",
    create: "Nueva región",
    submit: "Crear región",
    extra: "Activa",
  },
];

test.describe("Catálogo template", () => {
  test("every catálogo page creates in a side sheet, with nothing editable in rows", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);

    for (const entry of pages) {
      await page.goto(entry.path);
      await expect(
        page.getByRole("heading", { name: entry.title, exact: true }),
      ).toBeVisible();

      const table = page.getByRole("table");
      await expect(table.getByRole("textbox")).toHaveCount(0);
      await expect(table.getByRole("combobox")).toHaveCount(0);
      await expect(page.getByLabel("Nombre")).toHaveCount(0);

      await page
        .getByRole("button", { name: entry.create, exact: true })
        .click();
      const sheet = page.getByRole("dialog", { name: entry.create });
      await expect(sheet.getByLabel("Nombre")).toBeVisible();
      await expect(sheet.getByText(entry.extra, { exact: true })).toBeVisible();
      await expect(
        sheet.getByRole("button", { name: entry.submit }),
      ).toBeVisible();

      await sheet.getByRole("button", { name: "Cancelar" }).click();
      await expect(sheet).toHaveCount(0);
    }
  });

  test("puestos edits activities as chips in the sheet; no Asignar or Quitar in the table", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/catalogo/puestos");

    await expect(
      page.getByRole("button", { name: "Asignar actividad" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("table").getByRole("button", { name: /^Quitar / }),
    ).toHaveCount(0);

    await page
      .getByRole("table")
      .getByRole("button", { name: /^Editar / })
      .first()
      .click();
    const sheet = page.getByRole("dialog", { name: "Editar puesto" });
    await expect(sheet.getByText("Actividades", { exact: true })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Agregar" })).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: "Guardar cambios" }),
    ).toBeVisible();
  });
});
