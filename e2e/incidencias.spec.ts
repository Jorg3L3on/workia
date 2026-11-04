import { expect, test, type Page } from "@playwright/test";

/**
 * Incidencias (W2-14): HR sets the tolerances for the next quincena,
 * recomputes the last quincena (the seeded people with a schedule and no
 * punches have faltas), opens one person and justifies a falta with a
 * reason. A viewer sees the rules but cannot change them.
 */
test.describe.configure({ mode: "serial" });

const PASSWORD = "Workia123!";

const login = async (page: Page, email: string) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByRole("textbox", { name: "Contraseña" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    try {
      await expect(page).toHaveURL(/\/(app|admin|empresa)/, {
        timeout: 15_000,
      });
      return;
    } catch (error) {
      // A cold dev server drops the first sign-in with MissingCSRF.
      if (attempt === 1) throw error;
    }
  }
};

/** The quincena before today's, in Mexico City: 'YYYY-MM-Q1|Q2'. */
const lastQuincena = () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
  }).format(new Date());
  const [year, month, day] = today.split("-").map(Number);

  if (day > 15) return `${today.slice(0, 7)}-Q1`;

  return month === 1
    ? `${year - 1}-12-Q2`
    : `${year}-${String(month - 1).padStart(2, "0")}-Q2`;
};

test("rules → recompute → justify a falta", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, "admin@workia.local");

  await page.goto("/app/periodos/reglas");
  await expect(
    page.getByRole("heading", { name: "Reglas de incidencias" }),
  ).toBeVisible();
  await page.getByLabel("Tolerancia de entrada (minutos)").fill("5");
  await page.getByRole("button", { name: "Guardar reglas" }).click();
  await expect(
    page.getByText(/Reglas guardadas\. Aplican desde/),
  ).toBeVisible();

  const period = lastQuincena();

  await page.goto(`/app/periodos/${period}`);
  await page.getByTestId("pay-period-recompute").click();
  await expect(page.getByText(/Incidencias recalculadas/)).toBeVisible();

  await expect(async () => {
    await page.reload();
    await expect(
      page
        .getByTestId("pay-period-person-row")
        .filter({ hasText: "HorarioUno" }),
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page
    .getByTestId("pay-period-person-row")
    .filter({ hasText: "HorarioUno" })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/app/periodos/${period}/`));

  const pending = page
    .getByTestId("person-incidencia-row")
    .filter({ hasText: "Sin justificar" });
  const before = await pending.count();
  const decided = page
    .getByTestId("person-incidencia-row")
    .filter({ hasText: "Decisión de RH" });
  const decidedBefore = await decided.count();

  expect(before).toBeGreaterThan(0);
  await pending.first().getByRole("button", { name: "Justificar" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Motivo")
    .fill("Constancia médica entregada");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Justificar" })
    .click();
  await expect(page.getByText("Incidencia justificada.")).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(decided).toHaveCount(decidedBefore + 1, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("person-justifications")).toContainText(
    "Constancia médica entregada",
  );
});

test("a viewer sees the rules but cannot save them", async ({ page }) => {
  await login(page, "viewer@workia.local");
  await page.goto("/app/periodos/reglas");

  // Without pay_periods:manage there is no form to save (without
  // pay_periods:read, no page at all).
  await expect(page.getByRole("heading").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Guardar reglas" }),
  ).toHaveCount(0);
});
