import { expect, test } from "@playwright/test";

test("auditoria route redirects unauthenticated users to login", async ({
  page,
}) => {
  await page.goto("/app/auditoria");

  await expect(page).toHaveURL(/\/login/);
});

test("catalogo route redirects unauthenticated users to login", async ({
  page,
}) => {
  await page.goto("/app/catalogo");

  await expect(page).toHaveURL(/\/login/);
});
