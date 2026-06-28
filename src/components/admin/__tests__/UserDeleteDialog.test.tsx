import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UserDeleteDialog from "../UserDeleteDialog";

// ── Mocks ────────────────────────────────────────────────────────────────
const invokeMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...a: any[]) => invokeMock(...a) } },
  IS_LARAVEL_ONLY: false,
}));

const isLaravelModeMock = vi.fn();
vi.mock("@/lib/laravel-auth", () => ({
  isLaravelMode: () => isLaravelModeMock(),
  getApiBaseUrl: () => "http://api.test/api",
  getLaravelAuthHeaders: () => ({ Accept: "application/json", "Content-Type": "application/json" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const user = { id: "u1", name: "Alice", username: "alice", email: "alice@x.com" };
const allUsers = [user, { id: "u2", name: "Bob", username: "bob", email: null }];

beforeEach(() => {
  invokeMock.mockReset();
  isLaravelModeMock.mockReset();
  (global as any).fetch = vi.fn();
});

async function openAndContinue() {
  render(<UserDeleteDialog user={user} allUsers={allUsers} isSuperAdmin onDeleted={vi.fn()} />);
  fireEvent.click(screen.getByRole("button"));
  fireEvent.click(await screen.findByRole("button", { name: /continue/i }));
}

describe("UserDeleteDialog access control", () => {
  it("blocks non-super-admins from opening the dialog", () => {
    const onDeleted = vi.fn();
    render(<UserDeleteDialog user={user} allUsers={allUsers} isSuperAdmin={false} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText(/delete user/i)).not.toBeInTheDocument();
  });
});

describe("UserDeleteDialog Laravel mode", () => {
  it("calls Laravel check-related then DELETE on direct delete", async () => {
    isLaravelModeMock.mockReturnValue(true);
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { has_related_data: false, related_tables: [] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: null, message: "User deleted successfully" }) });

    await openAndContinue();

    await waitFor(() => expect((global.fetch as any).mock.calls.length).toBe(2));
    expect((global.fetch as any).mock.calls[0][0]).toBe("http://api.test/api/v1/users/u1/check-related");
    expect((global.fetch as any).mock.calls[1][0]).toBe("http://api.test/api/v1/users/u1");
    expect((global.fetch as any).mock.calls[1][1].method).toBe("DELETE");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("shows related counts when backend reports related data", async () => {
    isLaravelModeMock.mockReturnValue(true);
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { has_related_data: true, related_tables: [{ table: "sales_invoices", column: "created_by", count: 3 }] } }),
    });

    await openAndContinue();

    expect(await screen.findByText(/Sales Invoices/i)).toBeInTheDocument();
    expect(screen.getByText(/3 records/i)).toBeInTheDocument();
  });
});

describe("UserDeleteDialog Supabase mode", () => {
  it("invokes admin-delete-user edge function for check + delete", async () => {
    isLaravelModeMock.mockReturnValue(false);
    invokeMock
      .mockResolvedValueOnce({ data: { has_related_data: false, related_tables: [] }, error: null })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });

    await openAndContinue();

    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    expect(invokeMock.mock.calls[0][0]).toBe("admin-delete-user");
    expect(invokeMock.mock.calls[0][1].body).toEqual({ action: "check", user_id: "u1" });
    expect(invokeMock.mock.calls[1][1].body).toEqual({ action: "delete", user_id: "u1" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
