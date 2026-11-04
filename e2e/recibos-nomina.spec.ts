import { zipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";

import { sampleCfdiNomina, samplePdf } from "../src/test/cfdi";
import { sampleCurp } from "../src/lib/people/identity";

import { e2eCurp } from "./curp";

/**
 * W2-03 nómina receipts: HR imports a provider zip, one receipt matches by
 * CURP and one stays unmatched, HR publishes, and the employee opens the PDF
 * and the XML from a phone-sized screen. HR then sees it opened. Files go to
 * the local storage driver (.storage/), no bucket needed.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

const loginAsDemoAdmin = async (page: Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("admin@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

test("HR imports and publishes a period; the employee opens their receipt", async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString().slice(-6);
  const nombres = `Recibo${suffix}`;
  const curp = e2eCurp();

  await loginAsDemoAdmin(page);

  // A person without email, activated with an HR code.
  await page.goto("/app/personas/nueva");
  await page.locator("#nombres").fill(nombres);
  await page.locator("#apellidoPaterno").fill("Quincena");
  await page.locator("#curp").fill(curp);
  await page.getByRole("button", { name: "Guardar persona" }).click();
  await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);

  const card = page.getByTestId("employee-account");
  await card
    .getByRole("button", { name: "Generar código de activación" })
    .click();
  const code = (await card
    .getByTestId("activation-code")
    .textContent())!.trim();

  const zip = zipSync({
    "recibos/R1.xml": new TextEncoder().encode(
      sampleCfdiNomina({ curp, rfc: "XAXX010101000", numEmpleado: suffix }),
    ),
    "recibos/R1.pdf": samplePdf(),
    "recibos/R2.xml": new TextEncoder().encode(
      sampleCfdiNomina({
        curp: sampleCurp(900_000 + Number(suffix)),
        rfc: "XAXX010101000",
        name: "PERSONA DESCONOCIDA",
      }),
    ),
  });

  await page.goto("/app/nomina");
  await page.getByRole("button", { name: "Importar recibos" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Archivo zip").setInputFiles({
    name: "quincena.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zip),
  });
  await expect(dialog.getByTestId("payroll-zip-summary")).toHaveText(
    "2 recibos, 1 sin PDF.",
  );
  await expect(dialog.getByLabel("Del")).toHaveValue("2026-10-16");
  await dialog.getByLabel("Periodo").fill(`E2E ${suffix}`);
  await dialog.getByRole("button", { name: "Importar" }).click();

  await expect(page).toHaveURL(/\/app\/nomina\/[0-9a-f-]{36}$/, {
    timeout: 30_000,
  });
  await expect(
    page.getByRole("heading", { name: `E2E ${suffix}` }),
  ).toBeVisible();
  await expect(page.getByText("PERSONA DESCONOCIDA")).toBeVisible();
  await expect(page.getByText(`${nombres} Quincena`)).toBeVisible();

  await page.getByRole("button", { name: "Publicar" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Publicar" })
    .click();
  await expect(page.getByText(/^Publicado /)).toBeVisible();

  // The employee, on a phone.
  const employee = await (
    await browser.newContext({ viewport: { width: 390, height: 844 } })
  ).newPage();
  await employee.goto("/mi/activar");
  await employee.getByLabel("CURP").fill(curp);
  await employee.getByLabel("Código de activación").fill(code);
  await employee
    .getByRole("textbox", { name: "Nueva contraseña" })
    .fill("Segura123");
  await employee
    .getByRole("textbox", { name: "Repite la contraseña" })
    .fill("Segura123");
  await employee.getByRole("button", { name: "Activar y entrar" }).click();
  await expect(employee).toHaveURL(/\/mi$/);
  await expect(
    employee.getByRole("link", { name: /Recibos de nómina\s*1 nuevo/ }),
  ).toBeVisible();

  await employee.getByRole("link", { name: /Recibos de nómina/ }).click();
  await expect(employee).toHaveURL(/\/mi\/recibos$/);
  const receipt = employee.getByRole("listitem").filter({
    hasText: `E2E ${suffix}`,
  });
  await expect(receipt.getByText("Nuevo")).toBeVisible();

  const pdfHref = await receipt
    .getByRole("link", { name: "Ver PDF" })
    .getAttribute("href");
  const pdf = await employee.request.get(pdfHref!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  const download = employee.waitForEvent("download");
  await receipt.getByRole("link", { name: "Descargar XML" }).click();
  expect((await download).suggestedFilename()).toMatch(/^recibo-.*\.xml$/);

  await employee.reload();
  await expect(receipt.getByText("Nuevo")).toBeHidden();

  // HR sees it opened.
  await page.reload();
  await expect(page.getByText("100 % (1)")).toBeVisible();
});
