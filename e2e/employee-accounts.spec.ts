import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { e2eCurp } from "./curp";

/**
 * W2-01 employee accounts: HR invites a person, the person signs in to /mi
 * with a code by email, HR disables the account and the session stops
 * working; a person without email activates with an HR code and their CURP.
 * Emails land in the dev outbox (.outbox/), no SMTP needed.
 */
test.describe.configure({ mode: "serial" });

const outbox = path.resolve(
  process.cwd(),
  process.env.EMAIL_OUTBOX_DIR ?? ".outbox",
);

const latestCodeFor = async (to: string) => {
  await expect
    .poll(
      () => {
        try {
          return readdirSync(outbox).some((file) =>
            readFileSync(path.join(outbox, file), "utf8").includes(
              `"to": "${to}"`,
            ),
          );
        } catch {
          return false;
        }
      },
      { timeout: 15_000 },
    )
    .toBe(true);

  const message = readdirSync(outbox)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .reverse()
    .map((file) => JSON.parse(readFileSync(path.join(outbox, file), "utf8")))
    .find(
      (candidate) => candidate.to === to && /\d{6}/.test(candidate.subject),
    );

  return (message?.subject as string).match(/\d{6}/)![0];
};

const loginAsDemoAdmin = async (page: Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("admin@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const createPerson = async (page: Page, nombres: string, curp: string) => {
  await page.goto("/app/personas/nueva");
  await page.locator("#nombres").fill(nombres);
  await page.locator("#apellidoPaterno").fill("Empleada");
  await page.locator("#curp").fill(curp);
  await page.getByRole("button", { name: "Guardar persona" }).click();
  await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);
};

const employeePage = async (browser: Browser) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  return context.newPage();
};

test("HR invites, the employee signs in with an email code, HR disables", async ({
  page,
  browser,
}) => {
  // Two browsers and the W2-11 downloads; a cold dev server needs the room.
  test.slow();
  const suffix = Date.now().toString().slice(-6);
  const nombres = `Invitada${suffix}`;
  const email = `invitada${suffix}@empleo.test`;

  await loginAsDemoAdmin(page);
  await createPerson(page, nombres, e2eCurp());

  const card = page.getByTestId("employee-account");
  await expect(card.getByText("Sin cuenta")).toBeVisible();
  await card.getByLabel("Invitar por correo").fill(email);
  await card.getByRole("button", { name: "Invitar" }).click();
  await expect(card.getByText(`Invitación enviada a ${email}.`)).toBeVisible();
  await expect(card.getByText("Invitación pendiente")).toBeVisible();

  const employee = await employeePage(browser);
  const started = Date.now();
  await employee.goto("/mi");
  await expect(employee).toHaveURL(/\/mi\/entrar$/);
  await employee.getByLabel("Correo electrónico").fill(email);
  await employee.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(employee.getByText("te enviamos un código")).toBeVisible();
  await employee.getByLabel("Código").fill(await latestCodeFor(email));
  await employee.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(employee).toHaveURL(/\/mi$/);
  await expect(
    employee.getByRole("heading", { name: `${nombres} Empleada` }),
  ).toBeVisible();
  expect(Date.now() - started).toBeLessThan(60_000);

  // W2-11: the seniority letter downloads from the home; the resguardo is one tap away.
  const constancias = employee.getByTestId("employee-constancias");
  await expect(
    constancias.getByText("RH aún no registra tu contrato."),
  ).toBeVisible();
  const download = employee.waitForEvent("download");
  await constancias
    .getByRole("link", { name: "Constancia de antigüedad" })
    .click();
  expect((await download).suggestedFilename()).toMatch(
    /^constancia-antiguedad-\d{4}-\d{2}-\d{2}\.pdf$/,
  );
  await constancias.getByRole("link", { name: /Mi resguardo/ }).click();
  await expect(
    employee.getByText("No tienes nada en resguardo."),
  ).toBeVisible();
  await employee.goto("/mi");

  await page.reload();
  await expect(card.getByText("Activa", { exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Desactivar cuenta" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Desactivar" })
    .click();
  await expect(
    card.getByText("Cuenta desactivada. Sus sesiones se cerraron."),
  ).toBeVisible();

  await employee.reload();
  await expect(employee).toHaveURL(/\/mi\/entrar$/);
});

test("a person without email activates with an HR code and signs in with CURP", async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString().slice(-6);
  const nombres = `SinCorreo${suffix}`;
  const curp = e2eCurp();

  await loginAsDemoAdmin(page);
  await createPerson(page, nombres, curp);

  const card = page.getByTestId("employee-account");
  await card
    .getByRole("button", { name: "Generar código de activación" })
    .click();
  const code = (await card
    .getByTestId("activation-code")
    .textContent())!.trim();
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  const employee = await employeePage(browser);
  await employee.goto("/mi/entrar");
  await employee.getByRole("link", { name: "Activa tu cuenta" }).click();
  await expect(employee).toHaveURL(/\/mi\/activar$/);
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
    employee.getByRole("heading", { name: `${nombres} Empleada` }),
  ).toBeVisible();

  await employee.getByRole("button", { name: "Salir" }).click();
  await expect(employee).toHaveURL(/\/mi\/entrar$/);
  await employee.getByRole("tab", { name: "Con mi CURP" }).click();
  await employee.getByLabel("CURP").fill(curp);
  await employee.getByRole("textbox", { name: "Contraseña" }).fill("Segura123");
  await employee.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(employee).toHaveURL(/\/mi$/);
});
