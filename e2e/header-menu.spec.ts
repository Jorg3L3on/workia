import { expect, test, type Page } from "@playwright/test";

const loginAsDemoRrhh = async (page: Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.locator("#email").fill("rrhh@workia.local");
  await page.locator("#password").fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const openHeaderMenu = async (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  await page.getByRole("button", { name: "Más acciones" }).click();
  return errors;
};

test.describe("Server-built header menus", () => {
  test.describe.configure({ timeout: 60_000 });
  test("opens Personas, contratos, plantillas, an alta and an asset", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);

    await page.goto("/app/personas");
    let errors = await openHeaderMenu(page);
    await expect(
      page.getByRole("menuitem", { name: "Descargar plantilla" }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Historial de importaciones" }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("menuitem", { name: "Descargar plantilla" })
        .locator("svg"),
    ).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
    await page.keyboard.press("Escape");

    await page.goto("/app/contratos");
    errors = await openHeaderMenu(page);
    await expect(
      page.getByRole("menuitem", { name: "Plantillas" }).locator("svg"),
    ).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
    await page.keyboard.press("Escape");

    await page.goto("/app/contratos/plantillas");
    errors = await openHeaderMenu(page);
    await expect(
      page
        .getByRole("menuitem", { name: "Agregar plantillas oficiales" })
        .locator("svg"),
    ).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
    await page.keyboard.press("Escape");

    await page.goto("/app/resguardo?status=disponible");
    await page
      .getByRole("link", { name: /^Ver detalle de / })
      .first()
      .click();
    await expect(page).toHaveURL(/\/app\/resguardo\/[0-9a-f-]{36}/);
    errors = await openHeaderMenu(page);
    await expect(
      page.getByRole("menuitem").first().locator("svg"),
    ).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
    await page.keyboard.press("Escape");

    await page.goto("/app/altas");
    await page.getByRole("button", { name: "Iniciar alta" }).click();
    await page.getByRole("combobox", { name: "Persona" }).click();
    await page.getByRole("option").first().click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Iniciar alta" })
      .click();
    await expect(page).toHaveURL(/\/app\/altas\/[0-9a-f-]{36}/);
    errors = await openHeaderMenu(page);
    await expect(
      page.getByRole("menuitem", { name: "Ver expediente" }).locator("svg"),
    ).toBeVisible();
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("opens a header menu with at least four items", async ({ page }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/personas");
    await page
      .getByRole("link", { name: /^Ver expediente de / })
      .first()
      .click();
    await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}/);

    const errors: string[] = [];
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
    await page.getByRole("button", { name: "Más acciones" }).click();

    const items = page.getByRole("menuitem");
    expect(await items.count()).toBeGreaterThanOrEqual(4);
    const count = await items.count();
    for (let index = 0; index < count; index += 1) {
      await expect(items.nth(index).locator("svg")).toBeVisible();
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});
