import type { Locator } from "@playwright/test";

export const chooseSelectOption = async (
  trigger: Locator,
  optionLabel: string,
) => {
  await trigger.click();
  await trigger
    .page()
    .getByRole("option", { name: optionLabel, exact: true })
    .click();
};
