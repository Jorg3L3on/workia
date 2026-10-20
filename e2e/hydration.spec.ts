import { expect, test, type Page } from "@playwright/test";

// Every /app and /admin page must hydrate without a mismatch. Reduced motion
// is on, as in the other specs: it is what exposed the WRK-09 badge mismatch.

const APP_ROUTES = [
  "/app",
  "/app/personas",
  "/app/personas/nueva",
  "/app/personas/importar",
  "/app/personas/importaciones",
  "/app/contratos",
  "/app/contratos/plantillas",
  "/app/contratos/plantillas/nueva",
  "/app/altas",
  "/app/resguardo",
  "/app/resguardo/nuevo",
  "/app/auditoria",
  "/app/catalogo",
  "/app/catalogo/areas",
  "/app/catalogo/puestos",
  "/app/catalogo/sucursales",
  "/app/catalogo/actividades",
  "/app/catalogo/regiones",
  "/app/miembros",
  "/app/conexiones",
];

const ADMIN_ROUTES = ["/admin", "/admin/empresas", "/admin/rbac"];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// Detail pages: [list page, pattern for the first detail link on it, suffixes].
const APP_DETAILS: [string, RegExp, string[]][] = [
  ["/app/personas", new RegExp(`^/app/personas/${UUID}$`), ["", "/constancia"]],
  [
    "/app/contratos/plantillas",
    new RegExp(`^/app/contratos/plantillas/${UUID}$`),
    [""],
  ],
  ["/app/altas", new RegExp(`^/app/altas/${UUID}$`), [""]],
  ["/app/resguardo", new RegExp(`^/app/resguardo/${UUID}$`), [""]],
];

const ADMIN_DETAILS: [string, RegExp, string[]][] = [
  ["/admin/empresas", new RegExp(`^/admin/empresas/${UUID}$`), [""]],
];

const login = async (page: Page, email: string) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/(app|admin)/, { timeout: 25_000 });
};

const watchHydration = (page: Page) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) {
      errors.push(message.text().split("\n")[0]);
    }
  });
  page.on("pageerror", (error) => {
    if (/hydrat/i.test(error.message)) errors.push(error.message);
  });
  return errors;
};

const visit = async (page: Page, errors: string[], route: string) => {
  const before = errors.length;
  await page.goto(route, { waitUntil: "networkidle" });
  // React reports a mismatch right after hydration; give it a beat.
  await page.waitForTimeout(500);
  return errors.slice(before).map((error) => `${route}: ${error}`);
};

const discover = async (page: Page, details: [string, RegExp, string[]][]) => {
  const routes: string[] = [];
  for (const [list, pattern, suffixes] of details) {
    await page.goto(list, { waitUntil: "networkidle" });
    // DataTable rows open their detail with router.push (role="link", no
    // href), so the first openable row is clicked and the URL read back.
    const row = page.locator('tbody tr[role="link"]').first();
    await expect(row, `no openable row on ${list}`).toBeVisible();
    await row.click();
    await page.waitForURL((url) => pattern.test(url.pathname));
    const hit = new URL(page.url()).pathname;
    for (const suffix of suffixes) routes.push(`${hit}${suffix}`);
  }
  return routes;
};

const checkRoutes = async (
  page: Page,
  routes: string[],
  details: [string, RegExp, string[]][],
) => {
  const errors = watchHydration(page);
  const all = [...routes, ...(await discover(page, details))];
  const failures: string[] = [];
  for (const route of all) failures.push(...(await visit(page, errors, route)));
  expect(failures).toEqual([]);
};

test.describe("hydration", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("every /app page hydrates without a mismatch", async ({ page }) => {
    test.setTimeout(300_000);
    await login(page, "rrhh@workia.local");
    await checkRoutes(page, APP_ROUTES, APP_DETAILS);
  });

  test("every /admin page hydrates without a mismatch", async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, "admin@workia.local");
    await checkRoutes(page, ADMIN_ROUTES, ADMIN_DETAILS);
  });
});
