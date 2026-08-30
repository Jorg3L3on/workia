import { expect, test } from "@playwright/test";

test("landing page renders in Spanish with Entrar CTA to login", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(
    page.getByRole("heading", {
      name: /RRHH deja de cazar fechas en Excel y correos/i,
    }),
  ).toBeVisible();

  await expect(
    page.getByText(
      "El expediente vive en Workia. Los contratos que vencen se ven a tiempo.",
    ),
  ).toBeVisible();

  const entrarLinks = page.getByRole("link", { name: "Entrar" });
  await expect(entrarLinks.first()).toBeVisible();
  await expect(entrarLinks.first()).toHaveAttribute("href", "/login");

  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open app" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveCount(0);
  await expect(page.getByText("Next.js 16")).toHaveCount(0);

  await expect(
    page.getByRole("heading", { name: "Contratos", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Resguardo", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Lo que viene")).toHaveCount(0);
  await expect(
    page.getByText("En el roadmap — no disponible en producción todavía"),
  ).toHaveCount(0);
  await expect(page.getByText("Próximamente")).toHaveCount(0);
});

test("login page renders credential form", async ({ page }) => {
  await page.goto("/login");

  await expect(
    page.getByRole("heading", { name: "Bienvenido a workia" }),
  ).toBeVisible();
  await expect(page.getByText("ID · RRHH")).toBeVisible();
  await expect(page.getByLabel("Correo electrónico")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Contraseña" })).toBeVisible();
});

test("protected app route redirects to login", async ({ page }) => {
  await page.goto("/app");

  await expect(page).toHaveURL(/\/login/);
});
