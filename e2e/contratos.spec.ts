import { test, expect } from "@playwright/test";

test.describe("Contratos routes", () => {
  test("redirects unauthenticated users from contratos", async ({ page }) => {
    await page.goto("/app/contratos");
    await expect(page).toHaveURL(/\/login/);
  });

  test("redirects unauthenticated users from plantillas", async ({ page }) => {
    await page.goto("/app/contratos/plantillas");
    await expect(page).toHaveURL(/\/login/);
  });
});
