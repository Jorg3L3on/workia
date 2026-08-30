import { expect, test } from "@playwright/test";

const assertWorkiaFavicon = async (page: import("@playwright/test").Page) => {
  const iconLinks = page.locator('link[rel="icon"], link[rel="shortcut icon"]');
  await expect(iconLinks.first()).toHaveCount(1);

  const hrefs = await iconLinks.evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLLinkElement).href).filter(Boolean),
  );

  expect(hrefs.length).toBeGreaterThan(0);
  expect(
    hrefs.some(
      (href) =>
        href.includes("favicon.ico") ||
        href.includes("/icon") ||
        href.includes("icon.png"),
    ),
  ).toBe(true);

  const faviconResponse = await page.request.get("/favicon.ico");
  expect(faviconResponse.ok()).toBe(true);
  expect(faviconResponse.headers()["content-type"]).toMatch(
    /icon|octet-stream/,
  );
};

test("landing, login and app share the Workia favicon", async ({ page }) => {
  await page.goto("/");
  await assertWorkiaFavicon(page);
  await expect(
    page.getByRole("navigation", { name: "Miga de pan" }),
  ).toHaveCount(0);

  await page.goto("/login");
  await assertWorkiaFavicon(page);
  await expect(
    page.getByRole("navigation", { name: "Miga de pan" }),
  ).toHaveCount(0);
});

const loginAsDemoRrhh = async (page: import("@playwright/test").Page) => {
  await page.goto("/login");
  await page.locator("#email").fill("rrhh@workia.local");
  await page.locator("#password").fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/);
};

test.describe("Authenticated breadcrumbs", () => {
  test("walks Inicio, Personas, Contratos, Resguardo, Catálogo and Auditoría", async ({
    page,
  }) => {
    await loginAsDemoRrhh(page);
    await assertWorkiaFavicon(page);

    const breadcrumb = page.getByRole("navigation", { name: "Miga de pan" });
    await expect(breadcrumb.getByText("Inicio", { exact: true })).toBeVisible();

    await page.goto("/app/personas");
    await expect(
      breadcrumb.getByText("Personas", { exact: true }),
    ).toBeVisible();

    const expedienteLink = page
      .getByRole("link", { name: "Ver expediente" })
      .first();
    if (await expedienteLink.isVisible()) {
      await expedienteLink.click();
      await expect(
        breadcrumb.getByRole("link", { name: "Personas" }),
      ).toBeVisible();
      await expect(
        breadcrumb.getByText("Personas", { exact: true }),
      ).toBeVisible();
    }

    await page.goto("/app/contratos");
    await expect(
      breadcrumb.getByText("Contratos", { exact: true }),
    ).toBeVisible();

    await page.goto("/app/resguardo");
    await expect(
      breadcrumb.getByText("Resguardo", { exact: true }),
    ).toBeVisible();

    await page.goto("/app/catalogo/areas");
    await expect(
      breadcrumb.getByRole("link", { name: "Catálogo" }),
    ).toBeVisible();
    await expect(breadcrumb.getByText("Áreas", { exact: true })).toBeVisible();

    await page.goto("/app/auditoria");
    await expect(
      breadcrumb.getByText("Auditoría", { exact: true }),
    ).toBeVisible();
  });
});
