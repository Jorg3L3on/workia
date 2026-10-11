import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const search = vi.fn();

vi.mock("@/lib/people/actions", () => ({
  searchManagerOptionsAction: (...args: unknown[]) => search(...args),
}));

import { ManagerPicker } from "@/components/people/manager-picker";

afterEach(() => {
  cleanup();
  search.mockReset();
});

describe("ManagerPicker", () => {
  it("submits the current manager without loading any options", () => {
    const { container } = render(
      <ManagerPicker
        id="managerId"
        initial={{ id: "m1", label: "Ana Lopez" }}
        name="managerId"
      />,
    );

    expect(
      container.querySelector<HTMLInputElement>('input[name="managerId"]')
        ?.value,
    ).toBe("m1");
    expect(search).not.toHaveBeenCalled();
  });

  it("searches as the user types and submits the chosen id", async () => {
    search.mockResolvedValue([{ id: "m2", label: "Juan Perez" }]);

    const { container } = render(
      <ManagerPicker
        excludeId="self"
        id="managerId"
        initial={null}
        name="managerId"
      />,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "juan" },
    });

    const option = await screen.findByRole("option", { name: "Juan Perez" });
    expect(search).toHaveBeenLastCalledWith("juan", "self");

    fireEvent.click(option);

    await waitFor(() =>
      expect(
        container.querySelector<HTMLInputElement>('input[name="managerId"]')
          ?.value,
      ).toBe("m2"),
    );
  });
});
