import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { e2eCurp } from "./curp";

/**
 * W2-02 Mi expediente: a signed-in employee sees their record, asks HR to
 * correct a field, HR sees before and after in «Correcciones» and rejects it
 * with a reason, and the employee reads that reason. Emails land in the dev
 * outbox (.outbox/).
 */
test.describe.configure({ mode: "serial" });

const outbox = path.resolve(
  process.cwd(),
  process.env.EMAIL_OUTBOX_DIR ?? ".outbox",
);

/** The newest login code sent to `to`, once it is in the outbox. */
const codeMessageFor = (to: string) => {
  try {
    return readdirSync(outbox)
      .filter((file) => file.endsWith(".json"))
      .sort()
      .reverse()
      .map((file) => JSON.parse(readFileSync(path.join(outbox, file), "utf8")))
      .find(
        (candidate) =>
          candidate.to === to && /\d{6}/.test(candidate.subject ?? ""),
      );
  } catch {
    return undefined;
  }
};

const latestCodeFor = async (to: string) => {
  await expect
    .poll(() => Boolean(codeMessageFor(to)), { timeout: 15_000 })
    .toBe(true);

  return (codeMessageFor(to).subject as string).match(/\d{6}/)![0];
};

const loginAsDemoAdmin = async (page: Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("admin@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

test("an employee asks for a correction and HR answers it from the inbox", async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString().slice(-6);
  const nombres = `Expediente${suffix}`;
  const email = `expediente${suffix}@empleo.test`;

  await loginAsDemoAdmin(page);
  await page.goto("/app/personas/nueva");
  await page.locator("#nombres").fill(nombres);
  await page.locator("#apellidoPaterno").fill("Empleada");
  await page.locator("#curp").fill(e2eCurp());
  await page.locator("#telefono").fill("9610000000");
  await page.getByRole("button", { name: "Guardar persona" }).click();
  await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);
  const card = page.getByTestId("employee-account");
  await card.getByLabel("Invitar por correo").fill(email);
  await card.getByRole("button", { name: "Invitar" }).click();
  await expect(card.getByText("Invitación pendiente")).toBeVisible();

  const employee = await (
    await browser.newContext({ viewport: { width: 390, height: 844 } })
  ).newPage();
  await employee.goto("/mi/entrar");
  await employee.getByLabel("Correo electrónico").fill(email);
  await employee.getByRole("button", { name: "Enviarme un código" }).click();
  await employee.getByLabel("Código").fill(await latestCodeFor(email));
  await employee.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(employee).toHaveURL(/\/mi$/);

  await employee.getByRole("link", { name: "Ver mi expediente" }).click();
  await expect(employee).toHaveURL(/\/mi\/expediente$/);
  await expect(
    employee.getByRole("heading", { name: "Mi expediente" }),
  ).toBeVisible();
  const phone = employee.locator('[data-field="telefono"]');
  await expect(phone).toContainText("9610000000");

  await phone.getByRole("link", { name: "Corregir Teléfono" }).click();
  await expect(employee.getByTestId("correction-current")).toHaveText(
    "9610000000",
  );
  await employee.getByLabel("Debe decir").fill("9619999999");
  await employee
    .getByLabel("Comentario para RH (opcional)")
    .fill("Cambié de número");
  await employee.getByRole("button", { name: "Enviar a RH" }).click();
  await expect(employee).toHaveURL(/\/mi\/expediente\?enviada=1/);
  await expect(phone.getByText("En revisión")).toBeVisible();

  await page.goto("/app/correcciones");
  const request = page
    .getByTestId("correcciones")
    .getByRole("listitem")
    .filter({ hasText: `${nombres} Empleada` });
  await expect(request.getByTestId("correction-before")).toHaveText(
    "9610000000",
  );
  await expect(request.getByTestId("correction-after")).toHaveText(
    "9619999999",
  );
  await expect(request).toContainText("Cambié de número");
  await request
    .getByLabel("Motivo si la rechazas")
    .fill("Necesitamos un comprobante del número.");
  await request.getByRole("button", { name: "Rechazar" }).click();
  // Decided: it leaves the pending inbox.
  await expect(request).toHaveCount(0);

  await employee.goto("/mi/expediente");
  const mine = employee.locator('[data-correction="telefono"]');
  await expect(mine.getByText("Rechazada")).toBeVisible();
  await expect(mine).toContainText("Necesitamos un comprobante del número.");
  await expect(
    phone.getByRole("link", { name: "Corregir Teléfono" }),
  ).toBeVisible();
});
