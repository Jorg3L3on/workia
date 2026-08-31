import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { OFFICIAL_DELETED_DEMO_FULL_NAME } from "../src/lib/people/borrados-cleanup";

const loginAsDemoAdmin = async (page: import("@playwright/test").Page) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill("admin@workia.local");
  await page.getByRole("textbox", { name: "Contraseña" }).fill("Workia123!");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/app/, { timeout: 25_000 });
};

const hardDeleteBorradosFixture = (fullName: string) => {
  execFileSync(
    "npx",
    ["tsx", "scripts/cleanup-borrados-residue.ts", "--full-name", fullName],
    {
      cwd: process.cwd(),
      stdio: "inherit",
      timeout: 60_000,
    },
  );
};

const createAndSoftDeleteDummy = async (
  page: import("@playwright/test").Page,
  suffix: string,
) => {
  const fullName = `Persona Borrada Demo${suffix}`;

  await page.goto("/app/personas/nueva");
  await page.locator("#nombres").fill("Persona");
  await page.locator("#apellidoPaterno").fill("Borrada");
  await page.locator("#apellidoMaterno").fill(`Demo${suffix}`);
  await page.getByRole("button", { name: "Dar de alta" }).click();

  await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);
  await expect(
    page.getByRole("heading", { name: fullName, exact: true }),
  ).toBeVisible();

  const expedienteUrl = page.url();

  await page
    .getByRole("button", { name: "Borrar expediente (lógico)" })
    .click();

  return { expedienteUrl, fullName };
};

test("soft-deleted expediente stays open and appears in borrados", async ({
  page,
}) => {
  const suffix = Date.now().toString().slice(-6);
  const fullName = `Persona Borrada Demo${suffix}`;

  try {
    await loginAsDemoAdmin(page);
    const created = await createAndSoftDeleteDummy(page, suffix);

    await expect(page).toHaveURL(created.expedienteUrl);
    await expect(page.getByText("404", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: fullName, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Borrado", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: "Expediente borrado" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Borrar expediente (lógico)" }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Editar" })).toHaveCount(0);

    const breadcrumb = page.getByRole("navigation", { name: "Miga de pan" });
    await expect(
      breadcrumb.getByRole("link", { name: "Personas" }),
    ).toBeVisible();
    await expect(breadcrumb.getByText(fullName, { exact: true })).toBeVisible();

    await page.goto(created.expedienteUrl);
    await expect(
      page.getByRole("heading", { name: fullName, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Borrado", { exact: true }).first(),
    ).toBeVisible();

    await page.getByRole("link", { name: "Ver listado de borrados" }).click();
    await expect(page).toHaveURL(/\/app\/personas\?deleted=1/);
    await expect(page.locator("table").getByText(fullName)).toBeVisible();
    await expect(
      page.locator("table").getByText("Borrado", { exact: true }).first(),
    ).toBeVisible();

    await page.locator("#persona-visibility").selectOption("expediente");
    await expect(page.getByText(fullName)).toHaveCount(0);
  } finally {
    hardDeleteBorradosFixture(fullName);
  }

  await page.goto("/app/personas?deleted=1");
  await expect(
    page.locator("table").getByText(fullName, { exact: true }),
  ).toHaveCount(0);
});

test("borrados shows the official demo deleted person without e2e residue", async ({
  page,
}) => {
  await loginAsDemoAdmin(page);
  await page.goto("/app/personas?deleted=1");

  await expect(
    page.locator("table").getByText(OFFICIAL_DELETED_DEMO_FULL_NAME, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Persona Borrada Demo\d+/)).toHaveCount(0);

  await page
    .getByRole("link", {
      name: `Ver expediente de ${OFFICIAL_DELETED_DEMO_FULL_NAME}`,
    })
    .click();

  await expect(page).toHaveURL(/\/app\/personas\/[0-9a-f-]{36}$/);
  await expect(page.getByText("404", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: OFFICIAL_DELETED_DEMO_FULL_NAME,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Borrado", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Expediente borrado" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Borrar expediente (lógico)" }),
  ).toHaveCount(0);
});

test("repeated soft-delete e2e does not grow the borrados pile", async ({
  page,
}) => {
  await loginAsDemoAdmin(page);
  const leftovers: string[] = [];

  try {
    for (const offset of [1, 2]) {
      const suffix = `${Date.now().toString().slice(-5)}${offset}`;
      const { fullName, expedienteUrl } = await createAndSoftDeleteDummy(
        page,
        suffix,
      );
      leftovers.push(fullName);

      await expect(page).toHaveURL(expedienteUrl);
      await expect(page.getByText("404", { exact: true })).toHaveCount(0);

      hardDeleteBorradosFixture(fullName);
    }
  } finally {
    for (const fullName of leftovers) {
      hardDeleteBorradosFixture(fullName);
    }
  }

  await page.goto("/app/personas?deleted=1");
  await expect(page.getByText(/Persona Borrada Demo\d+/)).toHaveCount(0);
  await expect(
    page.locator("table").getByText(OFFICIAL_DELETED_DEMO_FULL_NAME, {
      exact: true,
    }),
  ).toBeVisible();
});
