import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLicense } from "@/contexts/LicenseContext";

const SESSION_KEY = "license_expiry_warning_shown";
const WARNING_WINDOW_DAYS = 3;

export const LicenseExpiryWarningDialog = () => {
  const { loading, blocked, status, expiresAt } = useLicense();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || blocked || status === "grace" || !expiresAt) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;

    const daysLeft = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000);
    if (daysLeft >= 0 && daysLeft <= WARNING_WINDOW_DAYS) {
      setOpen(true);
      sessionStorage.setItem(SESSION_KEY, "1");
    }
  }, [loading, blocked, status, expiresAt]);

  const daysLeft = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86400000)) : null;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>License Expiring Soon</AlertDialogTitle>
          <AlertDialogDescription>
            {daysLeft !== null && daysLeft <= 0
              ? "This software's license expires today."
              : `This software's license will expire in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`}
            {" "}Please renew it soon to avoid interruption.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Dismiss</AlertDialogCancel>
          <AlertDialogAction onClick={() => navigate("/license-verification")}>
            Go to License Page
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
