import { expect, test } from "@playwright/test";

test("personas route redirects unauthenticated users to login", async ({
  page,
}) => {
  await page.goto("/app/personas");

  await expect(page).toHaveURL(/\/login/);
});

test("home app route redirects unauthenticated users to login", async ({
  page,
}) => {
  await page.goto("/app");

  await expect(page).toHaveURL(/\/login/);
});
