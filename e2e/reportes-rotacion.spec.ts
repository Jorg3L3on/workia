import { execFileSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

/**
 * Reportes → Rotación (WRK-I12): a filter in the URL survives a reload, the
 * drill-down lists the same people the KPI counts and the CSV export has the
 * same N; a viewer (no reports:read) sees no entry and gets a 403.
 * Fictional data: one person with a baja today, hard-deleted at the end.
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
      await expect(page).toHaveURL(/\/(app|admin)/, { timeout: 15_000 });
      return;
    } catch (error) {
      // A cold dev server drops the first sign-in with MissingCSRF.
      if (attempt === 1) throw error;
    }
  }
};

const fixture = (...args: string[]) =>
  execFileSync("npx", ["tsx", "e2e/fixtures/rotacion.ts", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 60_000,
  }).trim();

/** Today and the first of its month, in Mexico City as the app counts. */
const thisMonth = () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
  }).format(new Date());

  return { from: `${today.slice(0, 8)}01`, to: today };
};

test("filter → URL → reload → drill-down → export with the same N", async ({
  page,
}) => {
  const suffix = `E2e${Date.now().toString().slice(-6)}`;
  const personId = fixture("create-baja", suffix).split("\n").at(-1)!;

  try {
    await login(page, "admin@workia.local");

    const { from, to } = thisMonth();
    const r = `r1*desde.${from}*hasta.${to}`;

    await page.goto(`/app/reportes/rotacion?r=${r}`);
    await expect(
      page.getByRole("heading", { name: "Rotación", level: 1 }),
    ).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`r=r1\\*desde\\.${from}`));

    const indicators = page.getByRole("region", { name: "Indicadores" });
    const countText = await indicators
      .getByText(/^\d+ bajas? · plantilla promedio/)
      .first()
      .textContent();
    const total = Number(countText!.match(/^(\d+)/)![1]);

    expect(total).toBeGreaterThanOrEqual(1);

    await page
      .getByRole("button", { name: "Ver las bajas del periodo" })
      .click();
    const sheet = page.getByRole("dialog");

    await expect(
      sheet.getByRole("link", { name: `Rotación ${suffix}` }),
    ).toBeVisible();
    await expect(sheet.getByRole("row")).toHaveCount(total + 1);

    const response = await page.request.get(
      `/app/reportes/rotacion/exportar?r=${r}&format=csv`,
    );
    const lines = (await response.text())
      .split("\r\n")
      .filter((line) => line.trim() !== "");

    expect(response.status()).toBe(200);
    expect(lines).toHaveLength(total + 1);
    expect(lines.some((line) => line.includes(`Rotación ${suffix}`))).toBe(
      true,
    );
  } finally {
    fixture("hard-delete", personId);
  }
});

test("a viewer sees no Reportes entry and gets a 403", async ({ page }) => {
  await login(page, "viewer@workia.local");

  await expect(page.getByRole("link", { name: "Rotación" })).toHaveCount(0);

  await page.goto("/app/reportes/rotacion");

  // The route streams (loading.tsx), so forbidden() shows the 403 page.
  await expect(page.getByText(/403/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Indicadores" })).toHaveCount(
    0,
  );
});
