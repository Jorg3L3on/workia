import { expect, type Page } from "@playwright/test";

const DEMO_PASSWORD = "Workia123!";

const submitLogin = async (page: Page, email: string) => {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByRole("textbox", { name: "Contraseña" }).fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
};

/**
 * Sign in as a seeded demo user. A cold dev server drops the first sign-in
 * with MissingCSRF and leaves the page on /login, so one retry is allowed.
 */
const login = async (page: Page, email: string, landing: RegExp) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await submitLogin(page, email);
  try {
    await expect(page).toHaveURL(landing, { timeout: 10_000 });
  } catch {
    await submitLogin(page, email);
    await expect(page).toHaveURL(landing, { timeout: 25_000 });
  }
};

export const loginAsDemoRrhh = (page: Page) =>
  login(page, "rrhh@workia.local", /\/app/);

export const loginAsDemoAdmin = (page: Page) =>
  login(page, "admin@workia.local", /\/(app|admin)/);

/**
 * Add 2200px of height under the page so the shell scroller has something to
 * scroll. It only adds height: the scroll itself must come from the real
 * `shell-main-scroll` node, so a regression in where the scroll lives fails
 * the tests instead of being masked here.
 */
export const stretchContentColumn = async (page: Page) => {
  await expect(page.locator('[data-slot="shell-main-scroll"]')).toBeVisible();
  await page.addStyleTag({
    content: `
      [data-slot="shell-main-scroll"]::after {
        content: "";
        display: block;
        height: 2200px;
        flex-shrink: 0;
      }
    `,
  });

  await expect
    .poll(async () =>
      page.locator('[data-slot="shell-main-scroll"]').evaluate((node) => {
        const el = node as HTMLElement;
        return el.scrollHeight - el.clientHeight;
      }),
    )
    .toBeGreaterThan(1000);
};

export type ShellMetrics = Awaited<ReturnType<typeof readShellMetrics>>;

export const readShellMetrics = async (page: Page) =>
  page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect().toJSON() ??
      null;
    const scroller = document.querySelector('[data-slot="shell-main-scroll"]');

    return {
      documentScroll: window.scrollY,
      mainScroll: scroller instanceof HTMLElement ? scroller.scrollTop : -1,
      sidebar: rect('[data-slot="sidebar-inner"]'),
      header: rect('[data-slot="sidebar-header"]'),
      footer: rect('[data-slot="sidebar-footer"]'),
      topNav: rect('[data-slot="shell-top-nav"]'),
    };
  });

export const expectChromePinned = (
  before: ShellMetrics,
  after: ShellMetrics,
) => {
  expect(after.documentScroll).toBe(0);
  expect(after.sidebar?.top).toBeCloseTo(before.sidebar?.top ?? -1, 0);
  expect(after.sidebar?.height).toBeCloseTo(before.sidebar?.height ?? -1, 0);
  expect(after.header?.top).toBeCloseTo(before.header?.top ?? -1, 0);
  expect(after.footer?.bottom).toBeCloseTo(before.footer?.bottom ?? -1, 0);
  expect(after.topNav?.top).toBeCloseTo(before.topNav?.top ?? -1, 0);
};
