import { fireEvent, screen } from "@testing-library/react";

export const chooseSelectOption = (
  comboboxName: string,
  optionName: string,
) => {
  const trigger = screen.getByRole("combobox", { name: comboboxName });
  fireEvent.pointerDown(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("option", { name: optionName }));
};
