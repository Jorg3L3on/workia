import { expect, test } from "@playwright/test";

const loginAsDemoRrhh = async (page: import("@playwright/test").Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("rrhh@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const delayPersonasNavigation = async (
  page: import("@playwright/test").Page,
) => {
  await page.route("**/app/personas**", async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, 700);
    });
    await route.continue();
  });
};

test.describe("Route progress and mobile menu", () => {
  test("shows the top loader from Inicio to Personas on desktop", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsDemoRrhh(page);
    await delayPersonasNavigation(page);

    const sidebar = page.locator('[data-slot="sidebar"]');
    await expect(sidebar.getByRole("link", { name: "Personas" })).toBeVisible();

    const navigation = sidebar.getByRole("link", { name: "Personas" }).click();
    await expect(
      page.getByRole("progressbar", { name: "Cargando página" }),
    ).toBeVisible();
    await expect(sidebar).toBeVisible();

    await navigation;
    await expect(
      page.getByRole("heading", { name: "Personas", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("progressbar", { name: "Cargando página" }),
    ).toHaveCount(0);
  });

  test("closes the mobile menu before Personas is visible", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsDemoRrhh(page);
    await delayPersonasNavigation(page);

    await page.getByRole("button", { name: "Alternar barra lateral" }).click();

    const menu = page.getByRole("dialog", { name: "Menú" });
    await expect(menu).toBeVisible();

    await menu.getByRole("link", { name: "Personas" }).click();
    await expect(menu).toBeHidden();
    await expect(
      page.getByRole("progressbar", { name: "Cargando página" }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Personas", exact: true }),
    ).toBeVisible();
    await expect(menu).toBeHidden();
    await expect(
      page.getByRole("progressbar", { name: "Cargando página" }),
    ).toHaveCount(0);
  });
});
