import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { chooseSelectOption } from "./choose-select-option";
import { e2eCurp } from "./curp";

/**
 * W2-06 requests and approvals: an employee asks for a permiso from the
 * phone, it reaches their jefe's inbox, the jefe approves it and the
 * employee sees the decision; HR sees it in /app/solicitudes.
 */
test.describe.configure({ mode: "serial" });

const outbox = path.resolve(
  process.cwd(),
  process.env.EMAIL_OUTBOX_DIR ?? ".outbox",
);

const latestCodeFor = async (to: string) => {
  let code: string | null = null;
  await expect
    .poll(
      () => {
        try {
          const message = readdirSync(outbox)
            .filter((file) => file.endsWith(".json"))
            .sort()
            .reverse()
            .map((file) =>
              JSON.parse(readFileSync(path.join(outbox, file), "utf8")),
            )
            .find(
              (candidate) =>
                candidate.to === to && /\d{6}/.test(candidate.subject),
            );
          code = message ? message.subject.match(/\d{6}/)[0] : null;
        } catch {
          code = null;
        }
        return code;
      },
      { timeout: 15_000 },
    )
    .not.toBeNull();
  return code!;
};

const loginAsDemoAdmin = async (page: Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("admin@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const createPerson = async (page: Page, nombres: string, manager?: string) => {
  await page.goto("/app/personas/nueva");
  await page.locator("#nombres").fill(nombres);
  await page.locator("#apellidoPaterno").fill("Solicitud");
  await page.locator("#curp").fill(e2eCurp());
  if (manager) {
    await page
      .getByRole("combobox", { name: "Jefe directo (opcional)" })
      .fill(manager);
    await page.getByRole("option", { name: new RegExp(manager) }).click();
  }
  await page.getByRole("button", { name: "Guardar persona" }).click();
  await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);
};

const invite = async (page: Page, email: string) => {
  const card = page.getByTestId("employee-account");
  await card.getByLabel("Invitar por correo").fill(email);
  await card.getByRole("button", { name: "Invitar" }).click();
  await expect(card.getByText(`Invitación enviada a ${email}.`)).toBeVisible();
};

const phoneSignIn = async (browser: Browser, email: string) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const phone = await context.newPage();
  await phone.goto("/mi/entrar");
  await phone.getByLabel("Correo electrónico").fill(email);
  await phone.getByRole("button", { name: "Enviarme un código" }).click();
  await phone.getByLabel("Código").fill(await latestCodeFor(email));
  await phone.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(phone).toHaveURL(/\/mi$/);
  return phone;
};

/** dd/mm/aaaa, as the date field shows it, `days` from today. */
const dayFromToday = (days: number) => {
  const date = new Date(Date.now() + days * 86_400_000);
  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear(),
  ].join("/");
};

test("an employee asks for a permiso and their jefe approves it", async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString().slice(-6);
  const boss = `JefaSol${suffix}`;
  const bossEmail = `jefasol${suffix}@empleo.test`;
  const report = `Pide${suffix}`;
  const reportEmail = `pide${suffix}@empleo.test`;

  await loginAsDemoAdmin(page);
  await createPerson(page, boss);
  await invite(page, bossEmail);
  const role = page.getByTestId("manager-role");
  await role.getByRole("button", { name: "Dar rol de jefe" }).click();
  await expect(role.getByText("Rol de jefe guardado.")).toBeVisible();
  await createPerson(page, report, boss);
  await invite(page, reportEmail);

  const employee = await phoneSignIn(browser, reportEmail);
  await employee.getByRole("link", { name: /Vacaciones y permisos/ }).click();
  await expect(employee).toHaveURL(/\/mi\/solicitudes$/);
  await employee.getByRole("link", { name: "Pedir" }).click();
  await chooseSelectOption(
    employee.getByRole("combobox", { name: "Qué pides" }),
    "Permiso con goce de sueldo",
  );
  await employee.getByLabel("Primer día").fill(dayFromToday(7));
  await employee.getByLabel("Último día").fill(dayFromToday(7));
  await employee.getByLabel("Días que faltarás").fill("1");
  await employee.getByRole("button", { name: "Enviar solicitud" }).click();
  await expect(employee).toHaveURL(/\/mi\/solicitudes\?enviada=1$/);
  const mine = employee.getByTestId("my-requests");
  await expect(mine.getByText("Permiso con goce de sueldo")).toBeVisible();
  await expect(mine.getByText("Pendiente")).toBeVisible();

  const manager = await phoneSignIn(browser, bossEmail);
  await manager.goto("/mi/equipo/aprobaciones");
  const inbox = manager.getByTestId("inbox-list");
  await expect(inbox.getByText(`${report} Solicitud`)).toBeVisible();
  await inbox.getByText("Permiso con goce de sueldo").click();
  await expect(manager.getByTestId("request-conflicts")).toBeVisible();
  await manager.getByRole("button", { name: "Aprobar" }).click();
  await expect(manager).toHaveURL(
    /\/mi\/equipo\/aprobaciones\?decidida=aprobada$/,
  );
  await expect(manager.getByText("Solicitud aprobada.")).toBeVisible();
  await expect(
    manager.getByText("No hay nada esperando tu aprobación."),
  ).toBeVisible();

  await employee.goto("/mi/solicitudes");
  await expect(
    employee.getByTestId("my-requests").getByText("Aprobada"),
  ).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) {
    await employee.screenshot({
      path: path.join(process.env.E2E_SCREENSHOTS, "mi-solicitudes.png"),
      fullPage: true,
    });
  }

  await page.goto("/app/solicitudes?estado=aprobadas");
  await expect(
    page.getByTestId("hr-requests").getByText(`${report} Solicitud`),
  ).toBeVisible();
});
