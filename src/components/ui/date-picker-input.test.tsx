import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DatePickerInput } from "./date-picker-input";

describe("DatePickerInput", () => {
  it("opens the calendar on the month of the manually typed date, not today", async () => {
    const onValueChange = vi.fn();
    render(<DatePickerInput onValueChange={onValueChange} />);

    const input = screen.getByPlaceholderText("DD-MM-YYYY") as HTMLInputElement;
    // Type a date far from the current month so a "today"-defaulted calendar
    // would obviously fail this assertion.
    fireEvent.change(input, { target: { value: "10-07-2025" } });
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
});
