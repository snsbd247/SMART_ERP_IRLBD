import { describe, it, expect } from "vitest";
import {
  resolveGeoBranch,
  BRANCH_NOT_CONFIGURED_MESSAGE,
  haversineMeters,
} from "@/lib/branch-geo";

const B = (id: string, lat: number | null, lng: number | null) => ({
  id, name: id, latitude: lat, longitude: lng, geofence_radius_m: 10,
});

describe("resolveGeoBranch fallback order", () => {
  it("prefers employee branch when configured", () => {
    const r = resolveGeoBranch({
      employeeBranch: B("emp", 23.7, 90.3),
      userBranch: B("user", 24, 91),
      allConfiguredBranches: [B("only", 25, 92)],
    });
    expect(r.source).toBe("employee");
    expect(r.branch?.id).toBe("emp");
  });

  it("falls back to user branch when employee branch missing coords", () => {
    const r = resolveGeoBranch({
      employeeBranch: B("emp", null, null),
      userBranch: B("user", 24, 91),
      allConfiguredBranches: [B("a", 1, 1), B("b", 2, 2)],
    });
    expect(r.source).toBe("user");
    expect(r.branch?.id).toBe("user");
  });

  it("falls back to the single configured branch when both prior are unconfigured", () => {
    const r = resolveGeoBranch({
      employeeBranch: null,
      userBranch: B("user", null, null),
      allConfiguredBranches: [B("only", 25, 92)],
    });
    expect(r.source).toBe("single");
    expect(r.branch?.id).toBe("only");
  });

  it("returns 'none' when nothing is configured and shows the correct message", () => {
    const r = resolveGeoBranch({
      employeeBranch: null,
      userBranch: null,
      allConfiguredBranches: [B("a", null, null), B("b", 1, 1), B("c", 2, 2)],
    });
    expect(r.source).toBe("none");
    expect(r.branch).toBeNull();
    expect(BRANCH_NOT_CONFIGURED_MESSAGE).toMatch(/not configured/i);
  });

  it("does not use single-fallback when more than one branch is configured", () => {
    const r = resolveGeoBranch({
      employeeBranch: null,
      userBranch: null,
      allConfiguredBranches: [B("a", 1, 1), B("b", 2, 2)],
    });
    expect(r.source).toBe("none");
  });
});

describe("haversineMeters", () => {
  it("returns ~0 for identical points", () => {
    expect(haversineMeters(23.7808, 90.2792, 23.7808, 90.2792)).toBeCloseTo(0, 3);
  });
  it("computes a plausible distance (~1 km)", () => {
    const d = haversineMeters(23.7808, 90.2792, 23.7898, 90.2792);
    expect(d).toBeGreaterThan(950);
    expect(d).toBeLessThan(1050);
  });
});
