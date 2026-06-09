import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";

interface Props {
  to: string;
  label?: string;
}

/**
 * Shows a friendly toast notifying the user that the old URL has moved,
 * then redirects to the new workflow page.
 */
export const LegacyRedirect = ({ to, label = "the new workflow" }: Props) => {
  useEffect(() => {
    toast.info("This page has moved", {
      description: `You've been redirected to ${label}. Continue from here.`,
      duration: 5000,
    });
  }, [to, label]);

  return <Navigate to={to} replace />;
};
