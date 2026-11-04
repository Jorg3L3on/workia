import { expect, test, type Page } from "@playwright/test";

/**
 * Pre-nómina (W2-18): HR makes a CSV template for its provider, closes a
 * quincena, sees the summary and downloads the file with that template, then
 * reopens the quincena with a reason and the export is gone until the next
 * close. Uses the quincena before last, so incidencias.spec.ts keeps the
 * last one open.
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

const previous = (period: string) => {
  const [year, month] = period.split("-").map(Number);

  if (period.endsWith("Q2")) return `${period.slice(0, 7)}-Q1`;

  return month === 1
    ? `${year - 1}-12-Q2`
    : `${year}-${String(month - 1).padStart(2, "0")}-Q2`;
};

/** Two quincenas before today's, in Mexico City. */
const quincena = () => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
  }).format(new Date());
  const current = `${today.slice(0, 7)}-${Number(today.slice(8)) > 15 ? "Q2" : "Q1"}`;

  return previous(previous(current));
};

const TEMPLATE = `Proveedor e2e ${Date.now()}`;

test("template → close → summary and file → reopen", async ({ page }) => {
  test.setTimeout(180_000);
  const period = quincena();
  await login(page, "admin@workia.local");

  // A CSV template, one row per person and concept.
  await page.goto("/app/periodos/plantillas?plantilla=nueva");
  await page.getByLabel("Nombre").fill(TEMPLATE);
  await page.getByLabel("Formato").click();
  await page.getByRole("option", { name: "CSV" }).click();
  await page.getByLabel("Filas").click();
  await page
    .getByRole("option", { name: "Una fila por persona y concepto" })
    .click();
  await page.getByLabel("Faltas", { exact: true }).fill("F01");
  await page.getByRole("button", { name: "Guardar plantilla" }).click();
  await expect(page.getByText("Plantilla guardada.")).toBeVisible();
  await expect(
    page.getByTestId("prenomina-templates").getByText(TEMPLATE),
  ).toBeVisible();

  // Close the quincena.
  await page.goto(`/app/periodos/${period}`);
  const card = page.getByTestId("prenomina-card");
  if (await page.getByRole("button", { name: "Reabrir" }).isVisible()) {
    await page.getByRole("button", { name: "Reabrir" }).click();
    await page.getByLabel("Motivo").fill("Preparar la prueba e2e");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Reabrir" })
      .click();
    await expect(page.getByText("Quincena reabierta.")).toBeVisible();
  }
  await expect(card.getByText(/Cierra la quincena/)).toBeVisible();
  await page.getByRole("button", { name: "Cerrar quincena" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Cerrar quincena" })
    .click();
  await expect(page.getByText(/Quincena cerrada \(revisión/)).toBeVisible();

  // The summary and the file with the new template.
  await expect(card.getByTestId("prenomina-summary")).toBeVisible();
  await card.getByLabel("Plantilla").click();
  await page.getByRole("option", { name: TEMPLATE }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    card.getByTestId("prenomina-download").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    new RegExp(`^prenomina-.+-${period}-r\\d+-proveedor-e2e-\\d+\\.csv$`),
  );
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  expect(text.split("\r\n")[0]).toContain("Concepto");

  // Reopen: the export is gone until the next close.
  await page.getByRole("button", { name: "Reabrir" }).click();
  await page.getByLabel("Motivo").fill("Prueba e2e de pre-nómina");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Reabrir" })
    .click();
  await expect(page.getByText("Quincena reabierta.")).toBeVisible();
  await expect(card.getByText(/Cierra la quincena/)).toBeVisible();
  expect(
    (await page.request.get(`/app/periodos/${period}/prenomina`)).status(),
  ).toBe(409);
});

test("a viewer sees no download and cannot export", async ({ page }) => {
  await login(page, "viewer@workia.local");
  const response = await page.request.get(
    `/app/periodos/${quincena()}/prenomina`,
  );

  expect(response.status()).toBe(403);
});
