import { expect, test } from "@playwright/test";

const loginAsDemoRrhh = async (page: import("@playwright/test").Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("rrhh@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

test.describe("Catálogo forms collapsed", () => {
  test("puestos keeps create and assign collapsed until the action is chosen", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/catalogo/puestos");

    await expect(
      page.getByRole("heading", { name: "Puestos", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Puesto" }),
    ).toBeVisible();

    const createAction = page.getByRole("button", {
      name: "Nuevo puesto",
      exact: true,
    });
    const assignAction = page
      .getByRole("button", { name: "Asignar actividad", exact: true })
      .and(page.locator("[aria-expanded]"));

    await expect(createAction).toHaveAttribute("aria-expanded", "false");
    await expect(assignAction).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Nombre")).toHaveCount(0);
    await expect(page.getByLabel("Puesto a asignar")).toHaveCount(0);

    await createAction.click();

    await expect(createAction).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Nombre")).toBeVisible();
    await expect(page.getByLabel("Área (opcional)")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Crear puesto" }),
    ).toBeVisible();
    await expect(page.getByLabel("Puesto a asignar")).toHaveCount(0);

    await assignAction.click();

    await expect(assignAction).toHaveAttribute("aria-expanded", "true");
    await expect(createAction).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Puesto a asignar")).toBeVisible();
    await expect(page.getByLabel("Actividad a asignar")).toBeVisible();
    await expect(page.getByLabel("Nombre")).toHaveCount(0);
  });

  test("actividades, áreas and sucursales keep create collapsed until chosen", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);

    await page.goto("/app/catalogo/actividades");
    await expect(
      page.getByRole("heading", { name: "Actividades", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Actividad" }),
    ).toBeVisible();

    const newActivity = page.getByRole("button", {
      name: "Nueva actividad",
      exact: true,
    });
    await expect(newActivity).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Nombre")).toHaveCount(0);

    await newActivity.click();
    await expect(newActivity).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Nombre")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Crear actividad" }),
    ).toBeVisible();

    await page.goto("/app/catalogo/areas");
    await expect(
      page.getByRole("heading", { name: "Áreas", exact: true }),
    ).toBeVisible();

    const newArea = page.getByRole("button", {
      name: "Nueva área",
      exact: true,
    });
    await expect(newArea).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Nombre")).toHaveCount(0);

    await newArea.click();
    await expect(page.getByLabel("Nombre")).toBeVisible();
    await expect(page.getByLabel("Área padre (opcional)")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Crear área" }),
    ).toBeVisible();

    await page.goto("/app/catalogo/sucursales");
    await expect(
      page.getByRole("heading", { name: "Sucursales", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Tipo" }),
    ).toBeVisible();

    const newSite = page.getByRole("button", {
      name: "Nueva sucursal",
      exact: true,
    });
    await expect(newSite).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("Nombre")).toHaveCount(0);
    await expect(page.getByLabel("Tipo")).toHaveCount(0);

    await newSite.click();
    await expect(page.getByLabel("Nombre")).toBeVisible();
    await expect(page.getByLabel("Tipo")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Crear sucursal" }),
    ).toBeVisible();
  });
});
