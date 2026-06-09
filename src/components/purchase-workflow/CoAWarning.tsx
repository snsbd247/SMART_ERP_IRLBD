import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function CoAWarning({ missing }: { missing: string[] }) {
  if (!missing.length) return null;
  return (
    <Alert variant="destructive" className="mt-2">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Chart of Accounts Setup Required</AlertTitle>
      <AlertDescription>
        The following accounts are missing from your CoA and accounting will be skipped:{" "}
        <b>{missing.join(", ")}</b>. Add them in <code>Accounts → Chart of Accounts</code> first.
      </AlertDescription>
    </Alert>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <p className="font-medium">{title}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="space-y-2 animate-pulse">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-12 bg-muted rounded" />
      ))}
    </div>
  );
}
