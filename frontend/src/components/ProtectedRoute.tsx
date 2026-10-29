import { useAuth } from "@/contexts/AuthContext";
import { useLicense } from "@/contexts/LicenseContext";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ShieldAlert, Home, ArrowLeft } from "lucide-react";

interface Props {
  children: React.ReactNode;
  requiredPermission?: string;
  requireSuperAdmin?: boolean;
  requireAdmin?: boolean;
  requiredModule?: string;
  requiredAction?: "can_view" | "can_add" | "can_edit" | "can_delete";
}

const AccessState = ({ title, message }: { title: string; message: string }) => {
  const navigate = useNavigate();
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-4 border border-border rounded-lg p-8 bg-card shadow-sm">
        <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-7 h-7 text-destructive" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <p className="text-sm text-muted-foreground">{message}</p>
          <p className="text-xs text-muted-foreground pt-2">
            If you believe this is a mistake, contact your administrator to request access.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4 mr-1.5" />Back
          </Button>
          <Button size="sm" onClick={() => navigate("/")}>
            <Home className="w-4 h-4 mr-1.5" />Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
};

export const ProtectedRoute = ({
  children,
  requiredPermission,
  requireSuperAdmin,
  requireAdmin,
  requiredModule,
  requiredAction = "can_view",
}: Props) => {
  const { user, loading, isSuperAdmin, hasPermission } = useAuth();
  const { blocked: licenseBlocked, loading: licenseLoading } = useLicense();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  if (!licenseLoading && licenseBlocked) return <Navigate to="/license-verification" replace />;

  if (requiredPermission) {
    const perms = requiredPermission.split(",").map((p) => p.trim()).filter(Boolean);
    const allowed = perms.some((p) => hasPermission(p));
    if (!allowed) {
      return <AccessState title="Access Denied" message="You don't have permission to access this page." />;
    }
  }

  if ((requireSuperAdmin || requireAdmin) && !isSuperAdmin) {
    return <AccessState title="Access Denied" message="Super Admin privileges required." />;
  }

  if (requiredModule) {
    const actionMap: Record<string, string> = {
      can_view: "view",
      can_add: "create",
      can_edit: "edit",
      can_delete: "delete",
    };

    const perm = `${requiredModule}.${actionMap[requiredAction] || "view"}`;
    if (!hasPermission(perm)) {
      return <AccessState title="Access Denied" message="You don't have permission to access this page." />;
    }
  }

  return <>{children}</>;
};
