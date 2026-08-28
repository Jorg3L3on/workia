import { test, expect } from "@playwright/test";

test.describe("Resguardo routes", () => {
  test("redirects unauthenticated users from inventario", async ({ page }) => {
    await page.goto("/app/resguardo");
    await expect(page).toHaveURL(/\/login/);
  });

  test("redirects unauthenticated users from nuevo activo", async ({
    page,
  }) => {
    await page.goto("/app/resguardo/nuevo");
    await expect(page).toHaveURL(/\/login/);
  });
});
