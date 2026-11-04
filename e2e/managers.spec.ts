import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { e2eCurp } from "./curp";

/**
 * W2-07 manager role: HR gives a person the «Rol de jefe», a person who
 * reports to them shows up in «Mi equipo» on the phone, and a person of
 * another team is a 404 for that manager.
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
  await page.locator("#apellidoPaterno").fill("Equipo");
  await page.locator("#curp").fill(e2eCurp());
  if (manager) {
    await page
      .getByRole("combobox", { name: "Jefe directo (opcional)" })
      .fill(manager);
    await page.getByRole("option", { name: new RegExp(manager) }).click();
  }
  await page.getByRole("button", { name: "Guardar persona" }).click();
  await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);
  return page.url().split("/").at(-1)!;
};

test("HR gives the manager role and the manager sees only their team", async ({
  page,
  browser,
}) => {
  const suffix = Date.now().toString().slice(-6);
  const boss = `Jefa${suffix}`;
  const email = `jefa${suffix}@empleo.test`;

  await loginAsDemoAdmin(page);
  const outsiderId = await createPerson(page, `Ajena${suffix}`);
  await createPerson(page, boss);

  const card = page.getByTestId("employee-account");
  await card.getByLabel("Invitar por correo").fill(email);
  await card.getByRole("button", { name: "Invitar" }).click();
  await expect(card.getByText(`Invitación enviada a ${email}.`)).toBeVisible();

  const role = page.getByTestId("manager-role");
  await expect(role.getByText("Sin rol de jefe")).toBeVisible();
  await role.getByRole("button", { name: "Dar rol de jefe" }).click();
  await expect(role.getByText("Rol de jefe guardado.")).toBeVisible();
  await expect(role.getByText("Ve a su equipo")).toBeVisible();

  await createPerson(page, `Reporte${suffix}`, boss);

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const employee = await context.newPage();
  await employee.goto("/mi/entrar");
  await employee.getByLabel("Correo electrónico").fill(email);
  await employee.getByRole("button", { name: "Enviarme un código" }).click();
  await employee.getByLabel("Código").fill(await latestCodeFor(email));
  await employee.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(employee).toHaveURL(/\/mi$/);

  await employee.getByRole("link", { name: /Mi equipo/ }).click();
  await expect(employee).toHaveURL(/\/mi\/equipo$/);
  const team = employee.getByTestId("team-list");
  await expect(team.getByText(`Reporte${suffix} Equipo`)).toBeVisible();
  await expect(team.getByText(`Ajena${suffix}`)).toHaveCount(0);

  await team.getByText(`Reporte${suffix} Equipo`).click();
  await expect(
    employee.getByRole("heading", { name: `Reporte${suffix} Equipo` }),
  ).toBeVisible();

  const outsider = await employee.goto(`/mi/equipo/${outsiderId}`);
  expect(outsider?.status()).toBe(404);

  await employee.goto("/mi/equipo/aprobaciones");
  await expect(
    employee.getByText("No hay nada esperando tu aprobación."),
  ).toBeVisible();
});
