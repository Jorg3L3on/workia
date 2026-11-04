import { expect, test, type Page } from "@playwright/test";

import { e2eCurp } from "./curp";

/**
 * W2-10 self-service onboarding: HR starts an alta and gives the new hire an
 * activation code; the person fills «Completa tu alta» from the phone and
 * sends it; HR applies it to the expediente and sees how much the person
 * filled. Fictional data only.
 */
test.describe.configure({ mode: "serial" });

/** Unique RFC and NSS per run (both are unique per company). */
const identifiers = (suffix: string) => {
  const letters = [...suffix.slice(-4)]
    .map((digit) => String.fromCharCode(65 + Number(digit)))
    .join("");
  const body = `1234${suffix}`;
  // Luhn check digit, as IMSS uses.
  const sum = [...body].reverse().reduce((total, char, index) => {
    let digit = Number(char) * (index % 2 === 0 ? 2 : 1);
    if (digit > 9) digit -= 9;
    return total + digit;
  }, 0);
  return {
    rfc: `${letters}950412AB1`,
    nss: `${body}${(10 - (sum % 10)) % 10}`,
  };
};

const loginAsDemoAdmin = async (page: Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("admin@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const ensurePrivacyNotice = async (page: Page) => {
  await page.goto("/app/privacidad");
  await page
    .getByLabel(/Texto (del aviso|de la nueva versión)/)
    .fill(`Aviso de privacidad de prueba ${Date.now()}`);
  await page.getByRole("button", { name: "Publicar versión" }).click();
  await expect(page.getByText("Aviso publicado.")).toBeVisible();
};

test("the new hire fills their alta and HR applies it", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString().slice(-6);
  const nombres = `Nueva${suffix}`;
  const curp = e2eCurp();
  const { rfc, nss } = identifiers(suffix);

  await loginAsDemoAdmin(page);
  await ensurePrivacyNotice(page);

  await page.goto("/app/personas/nueva");
  await page.locator("#nombres").fill(nombres);
  await page.locator("#apellidoPaterno").fill("Ingreso");
  await page.locator("#curp").fill(curp);
  await page.getByRole("button", { name: "Guardar persona" }).click();
  await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);
  const personId = page.url().split("/").pop()!;

  await page.goto(`/app/altas?persona=${personId}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Iniciar alta" })
    .click();
  await expect(page).toHaveURL(/\/app\/altas\/[0-9a-f-]{36}\?started=1$/);

  const card = page.getByTestId("self-service");
  await card
    .getByRole("button", { name: "Sin correo: generar código" })
    .click();
  const code = (await card
    .getByTestId("self-service-code")
    .textContent())!.trim();
  await expect(card.getByText("Esperando a la persona")).toBeVisible();

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

  await employee.getByTestId("intake-card").click();
  await expect(employee).toHaveURL(/\/mi\/alta$/);
  await employee.getByRole("button", { name: "Leí y acepto el aviso" }).click();
  await expect(
    employee.getByRole("button", { name: "Enviar a RH" }),
  ).toBeEnabled();

  await employee.getByLabel("Teléfono celular").fill("55 1234 5678");
  await employee.getByLabel("Fecha de nacimiento").fill("1995-04-12");
  await employee.getByLabel("Sexo (como aparece en tu CURP)").selectOption("M");
  await employee.getByLabel("Estado civil").selectOption("soltero");
  await employee.getByLabel("Estado donde naciste").selectOption("Jalisco");
  await employee.getByLabel("Nacionalidad").fill("Mexicana");
  await employee.getByLabel("RFC").fill(rfc);
  await employee.getByLabel("Número de seguridad social (NSS)").fill(nss);
  await employee
    .getByLabel("Clave de elector (INE)")
    .fill("GOMRAN95041214M100");
  await employee.getByLabel("Calle").fill("Av. Juárez");
  await employee.getByLabel("Número exterior").fill("120");
  await employee.getByLabel("Colonia").fill("Centro");
  await employee.getByLabel("Municipio o alcaldía").fill("Guadalajara");
  await employee.getByLabel("Estado", { exact: true }).selectOption("Jalisco");
  await employee.getByLabel("Código postal").fill("44100");
  await employee.getByRole("button", { name: "Enviar a RH" }).click();
  await expect(
    employee.getByText("Listo. Enviaste tus datos a RH."),
  ).toBeVisible();
  await expect(employee.getByTestId("intake-status")).toContainText(
    "RH los está revisando",
  );

  await page.reload();
  await expect(card.getByText("Por revisar")).toBeVisible();
  await expect(card.getByTestId("self-service-review")).toContainText(
    "Guadalajara",
  );
  await expect(
    page
      .getByTestId("alta-decision")
      .getByRole("button", { name: "Aprobar alta" }),
  ).toBeDisabled();
  await card.getByRole("button", { name: "Aplicar al expediente" }).click();
  await expect(page).toHaveURL(/intake=applied/);
  await expect(card.getByTestId("self-service-share")).toHaveText(
    "15 de 17 campos los llenó la persona (88 %).",
  );
});
