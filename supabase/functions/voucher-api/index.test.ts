import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasVoucherPermission, voucherPermissionCandidates } from "./index.ts";

function mockAdmin(params: { roleIds?: string[]; grantedModules?: string[] }) {
  return {
    from(table: string) {
      if (table === "user_custom_roles") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({
                  data: (params.roleIds || []).map((custom_role_id) => ({ custom_role_id })),
                  error: null,
                });
              },
            };
          },
        };
      }

      if (table === "role_permissions") {
        return {
          select() {
            return {
              in(_column: string, _roleIds: string[]) {
                return {
                  in(_moduleColumn: string, modules: string[]) {
                    const granted = new Set(params.grantedModules || []);
                    return Promise.resolve({
                      data: modules
                        .filter((module) => granted.has(module))
                        .map((module) => ({ module, can_delete: true })),
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      }

      throw new Error(`Unexpected table ${table}`);
    },
  };
}

Deno.test("voucher delete candidates include per-type and umbrella permissions", () => {
  assertEquals(voucherPermissionCandidates("receipt", "delete"), [
    "receipt.delete",
    "vouchers.delete",
    "accounts.delete",
  ]);
});

Deno.test("Accountant-style receipt delete permission allows receipt deletion", async () => {
  const result = await hasVoucherPermission(
    mockAdmin({ roleIds: ["accountant"], grantedModules: ["receipt"] }),
    "user-1",
    [],
    { employee_id: "employee-1" },
    "receipt",
    "delete",
  );

  assertEquals(result.allowed, true);
});

Deno.test("wrong per-type delete permission does not allow receipt deletion", async () => {
  const result = await hasVoucherPermission(
    mockAdmin({ roleIds: ["journal-only"], grantedModules: ["journal"] }),
    "user-1",
    [],
    { employee_id: "employee-1" },
    "receipt",
    "delete",
  );

  assertEquals(result.allowed, false);
});

Deno.test("accounts umbrella delete permission allows receipt deletion", async () => {
  const result = await hasVoucherPermission(
    mockAdmin({ roleIds: ["accountant"], grantedModules: ["accounts"] }),
    "user-1",
    [],
    { employee_id: "employee-1" },
    "receipt",
    "delete",
  );

  assertEquals(result.allowed, true);
});