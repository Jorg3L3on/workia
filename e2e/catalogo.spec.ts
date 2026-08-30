import { expect, test } from "@playwright/test";

const loginAsDemoRrhh = async (page: import("@playwright/test").Page) => {
  await page.goto("/login");
  await page.locator("#email").fill("rrhh@workia.local");
  await page.locator("#password").fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/);
};

test.describe("Catálogo sidebar", () => {
  test("splits Catálogo into áreas, puestos and sucursales", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);
    await page.goto("/app/catalogo");

    await expect(page).toHaveURL(/\/app\/catalogo\/areas/);
    await expect(
      page.getByRole("heading", { name: "Áreas", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Catálogo organizacional" }),
    ).toHaveCount(0);

    const breadcrumb = page.getByRole("navigation", { name: "Miga de pan" });
    await expect(breadcrumb.getByText("Áreas", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Puestos" }).click();
    await expect(page).toHaveURL(/\/app\/catalogo\/puestos/);
    await expect(
      page.getByRole("heading", { name: "Puestos", exact: true }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Sucursales" }).click();
    await expect(page).toHaveURL(/\/app\/catalogo\/sucursales/);
    await expect(
      page.getByRole("heading", { name: "Sucursales", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Tipo" }),
    ).toBeVisible();
  });
});
