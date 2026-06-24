import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DatePickerInput } from "./date-picker-input";

describe("DatePickerInput", () => {
  it("renders the bound ISO value as DD-MM-YYYY", () => {
    render(<DatePickerInput value="2026-07-10" onChange={() => {}} />);
    const input = screen.getByPlaceholderText("DD-MM-YYYY") as HTMLInputElement;
    expect(input.value).toBe("10-07-2026");
  });

  it("emits ISO YYYY-MM-DD on typing a valid DD-MM-YYYY value", () => {
    const onValueChange = vi.fn();
    render(<DatePickerInput value="" onValueChange={onValueChange} />);
    const input = screen.getByPlaceholderText("DD-MM-YYYY") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "10-07-2026" } });
    expect(onValueChange).toHaveBeenLastCalledWith("2026-07-10");
  });

  it("does not emit on partial / invalid input", () => {
    const onValueChange = vi.fn();
    render(<DatePickerInput value="" onValueChange={onValueChange} />);
    const input = screen.getByPlaceholderText("DD-MM-YYYY") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "10-07" } });
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("emits empty string when the field is cleared", () => {
    const onValueChange = vi.fn();
    render(<DatePickerInput value="2026-07-10" onValueChange={onValueChange} />);
    const input = screen.getByPlaceholderText("DD-MM-YYYY") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "" } });
    expect(onValueChange).toHaveBeenLastCalledWith("");
  });

  it("restores the last valid value on blur after invalid edit", () => {
    render(<DatePickerInput value="2026-07-10" onChange={() => {}} />);
    const input = screen.getByPlaceholderText("DD-MM-YYYY") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "99-99-9999" } });
    fireEvent.blur(input);
    expect(input.value).toBe("10-07-2026");
  });

  it("fires synthetic onChange with the ISO value in event.target.value", () => {
    const onChange = vi.fn();
    render(<DatePickerInput value="" onChange={onChange} name="voucher_date" />);
    const input = screen.getByPlaceholderText("DD-MM-YYYY") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "10-07-2026" } });
    const ev = onChange.mock.calls.at(-1)?.[0];
    expect(ev?.target?.value).toBe("2026-07-10");
    expect(ev?.target?.name).toBe("voucher_date");
  });
});
