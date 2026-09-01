import { expect, test } from "@playwright/test";

const loginAsDemoRrhh = async (page: import("@playwright/test").Page) => {
  await page.goto("/login");
  await page.locator("#email").fill("rrhh@workia.local");
  await page.locator("#password").fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/);
};

test.describe("Authenticated list tables", () => {
  test("personas list uses product table chrome without gradient row links", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/personas");

    await expect(
      page.getByRole("heading", { name: "Personas", exact: true }),
    ).toBeVisible();

    const tableShell = page.locator("div.rounded-2xl.border").filter({
      has: page.getByRole("table"),
    });
    await expect(tableShell).toBeVisible();

    const verExpediente = page
      .getByRole("link", { name: "Ver expediente" })
      .first();
    await expect(verExpediente).toBeVisible();
    await expect(verExpediente).not.toHaveClass(/workia-accent-text/);

    await expect(page.locator(".workia-accent-text")).toHaveCount(0);
  });

  test("plantillas list uses outline edit action", async ({ page }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/contratos/plantillas");

    await expect(
      page.getByRole("heading", { name: "Plantillas de contrato" }),
    ).toBeVisible();

    const editLink = page.getByRole("link", { name: "Editar" }).first();
    await expect(editLink).toBeVisible();
    await expect(editLink).not.toHaveClass(/workia-accent-text/);
  });

  test("contratos renewal tray renders dense table shell", async ({ page }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/contratos");

    await expect(
      page.getByRole("heading", { name: "Contratos", exact: true }),
    ).toBeVisible();

    await expect(page.getByText("Renovaciones pendientes")).toBeVisible();
    await expect(
      page.locator("div.rounded-2xl.border").filter({
        has: page.getByRole("table"),
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Nuevo tipo")).toHaveCount(0);

    const renovar = page.getByRole("button", { name: /Renovar contrato de/ });
    if ((await renovar.count()) > 0) {
      await renovar.first().click();
      await expect(page.getByLabel("Nuevo tipo")).toHaveCount(1);
    }
  });
});
