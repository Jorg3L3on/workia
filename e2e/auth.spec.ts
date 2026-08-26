import { expect, test } from "@playwright/test";

test("home page renders sign in action", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "workia" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("login page renders credential form", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "Iniciar sesión" }),
  ).toBeVisible();
  await expect(page.getByText("Bienvenido de vuelta")).toBeVisible();
  await expect(page.getByText("Tu gente,")).toBeVisible();
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();
});

test("protected app route redirects to login", async ({ page }) => {
  await page.goto("/app");

  await expect(page).toHaveURL(/\/login/);
});
