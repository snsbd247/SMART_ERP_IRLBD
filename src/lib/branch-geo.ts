export interface GeoBranch {
  id: string;
  name?: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_m?: number | null;
}

export type BranchSource = "employee" | "user" | "single" | "none";

export interface ResolveInput {
  employeeBranch?: GeoBranch | null;
  userBranch?: GeoBranch | null;
  allConfiguredBranches?: GeoBranch[];
}

export interface ResolveResult {
  branch: GeoBranch | null;
  source: BranchSource;
}

const isConfigured = (b?: GeoBranch | null): b is GeoBranch =>
  !!b &&
  typeof b.latitude === "number" && Number.isFinite(b.latitude) &&
  typeof b.longitude === "number" && Number.isFinite(b.longitude);

/**
 * Portal branch fallback: employee → user → single-configured.
 * Mirrors backend AttendanceController::resolveGeoBranchWithSource.
 */
export function resolveGeoBranch(input: ResolveInput): ResolveResult {
  if (isConfigured(input.employeeBranch)) {
    return { branch: input.employeeBranch!, source: "employee" };
  }
  if (isConfigured(input.userBranch)) {
    return { branch: input.userBranch!, source: "user" };
  }
  const configured = (input.allConfiguredBranches ?? []).filter(isConfigured);
  if (configured.length === 1) {
    return { branch: configured[0], source: "single" };
  }
  return { branch: null, source: "none" };
}

export const BRANCH_NOT_CONFIGURED_MESSAGE = "Branch location is not configured.";

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
