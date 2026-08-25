import { AlertTriangle } from "lucide-react";
import { useLicense } from "@/contexts/LicenseContext";

export const LicenseGraceBanner = () => {
  const { status, message, expiresAt } = useLicense();
  if (status !== "grace") return null;

  const daysLeft = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs sm:text-sm bg-amber-500/10 text-amber-700 dark:text-amber-400 border-b border-amber-500/20">
      <AlertTriangle className="w-4 h-4 shrink-0" />
      <span>
        {message || "This license has expired and is in its grace period."}
        {daysLeft !== null ? ` Renew within ${daysLeft} day${daysLeft === 1 ? "" : "s"}.` : ""}
      </span>
    </div>
  );
};
