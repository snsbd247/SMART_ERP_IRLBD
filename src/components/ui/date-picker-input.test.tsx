import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useState as useReactState } from "react";
import { DatePickerInput } from "./date-picker-input";

describe("DatePickerInput", () => {
  it("opens the calendar on the month of the manually typed date, not today", async () => {
    const onValueChange = vi.fn();
    // DatePickerInput is a controlled component (its calendar month follows
    // the `value` prop, not its own internal typed text) — mirror how real
    // callers use it: feed the emitted value back in as `value`.
    function Controlled() {
      const [value, setValue] = useReactState("");
      return (
        <DatePickerInput
          value={value}
          onValueChange={(iso) => {
            onValueChange(iso);
            setValue(iso);
          }}
        />
      );
    }
    render(<Controlled />);

    const input = screen.getByPlaceholderText("DD-MM-YYYY") as HTMLInputElement;
    // Type a date far from the current month so a "today"-defaulted calendar
    // would obviously fail this assertion. Typing an already-separated date
    // no longer commits live on every keystroke (see date-picker-input.tsx:
    // that used to snap mid-edit, e.g. selecting "10" in "10-07-2025" and
    // retyping "13" would commit after just the "1" and corrupt the rest of
    // the keystroke) — it commits on blur instead, same as a real user
    // tabbing away after typing.
    fireEvent.change(input, { target: { value: "10-07-2025" } });
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenLastCalledWith("2025-07-10");

    fireEvent.click(screen.getByLabelText("Select date"));

    // react-day-picker exposes the visible month via a heading like "July 2025"
    await waitFor(() => {
      expect(screen.getByText(/July\s+2025/i)).toBeInTheDocument();
    });
  });

  it("preserves the selected date across re-renders (no reset to today on save)", () => {
    const { rerender } = render(<DatePickerInput value="2025-07-10" />);
    const input = screen.getByPlaceholderText("DD-MM-YYYY") as HTMLInputElement;
    expect(input.value).toBe("10-07-2025");

    // Simulate parent (voucher save flow) re-passing the same ISO value.
    rerender(<DatePickerInput value="2025-07-10" />);
    expect(input.value).toBe("10-07-2025");
  });

  it("marks malformed dates as invalid without losing user input", () => {
    render(<DatePickerInput />);
    const input = screen.getByPlaceholderText("DD-MM-YYYY") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "99-99-2025" } });
    expect(input.value).toBe("99-99-2025");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("does not corrupt the rest of the field when correcting a day by selecting and retyping it", () => {
    // Regression: selecting "10" in "10-07-2025" and typing "13" used to
    // land as "01-07-20253" — the moment the "1" replaced the selection,
    // "1-07-2025" parsed as a complete valid date (day=1) and got snapped
    // live to "01-07-2025" with the cursor jumped to the end, so the "3"
    // that followed landed after it instead of completing the day.
    const onValueChange = vi.fn();
    render(<DatePickerInput value="2025-07-10" onValueChange={onValueChange} />);
    const input = screen.getByPlaceholderText("DD-MM-YYYY") as HTMLInputElement;
    expect(input.value).toBe("10-07-2025");

    // Mid-edit state right after "10" is replaced by "1" (before "3" lands).
    fireEvent.change(input, { target: { value: "1-07-2025" } });
    expect(input.value).toBe("1-07-2025"); // not eagerly reformatted to "01-07-2025"
    expect(onValueChange).not.toHaveBeenCalled(); // and not committed yet

    // "3" lands right after the "1", completing "13-07-2025".
    fireEvent.change(input, { target: { value: "13-07-2025" } });
    fireEvent.blur(input);
    expect(input.value).toBe("13-07-2025");
    expect(onValueChange).toHaveBeenLastCalledWith("2025-07-13");
  });
});
