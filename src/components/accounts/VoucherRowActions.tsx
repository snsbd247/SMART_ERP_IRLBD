import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeftRight,
  Check,
  Eye,
  History,
  MoreHorizontal,
  Pencil,
  Printer,
  RotateCcw,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";

export interface VoucherRowActionsProps {
  voucherNumber?: string;
  // Availability flags — parent decides based on status/role
  canEdit: boolean;
  editDeniedReason?: string;
  canReverse?: boolean;
  canChangeType?: boolean;
  canApproveReject?: boolean;
  canDelete?: boolean;
  canRestore?: boolean;
  canPurge?: boolean;
  // Handlers
  onView: () => void;
  onEdit: () => void;
  onPrint: () => void;
  onHistory: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onReverse?: () => void;
  onChangeType?: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onPurge?: () => void;
  // Diagnostics — surfaced when the server rejects a request.
  editPermissionCid?: string;
}

/**
 * Reusable three-dot row action menu for accounting tables (vouchers, receipts, etc.).
 *
 * Accessibility:
 *   - Radix DropdownMenu provides full keyboard nav (arrows, Home/End, Esc, type-ahead)
 *     and ARIA roles/attributes out of the box.
 *   - The trigger has an explicit aria-label so screen readers announce it.
 *   - Disabled items keep a `title` attribute so hover explains WHY the action is blocked.
 *   - Destructive actions (delete/purge) use destructive tokens and are handled by a
 *     confirmation AlertDialog owned by the parent — no immediate destructive action fires
 *     from the menu item itself.
 */
export function VoucherRowActions(props: VoucherRowActionsProps) {
  const {
    voucherNumber,
    canEdit,
    editDeniedReason,
    canReverse,
    canChangeType,
    canApproveReject,
    canDelete,
    canRestore,
    canPurge,
    onView,
    onEdit,
    onPrint,
    onHistory,
    onApprove,
    onReject,
    onReverse,
    onChangeType,
    onDelete,
    onRestore,
    onPurge,
    editPermissionCid,
  } = props;

  const label = voucherNumber ? `Actions for voucher ${voucherNumber}` : "Row actions";
  const showMiddle = canApproveReject || canReverse || canChangeType;
  const showDanger = canDelete || canRestore || canPurge;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={label}>
          <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Actions</DropdownMenuLabel>

        <DropdownMenuItem onClick={onView}>
          <Eye className="w-4 h-4 mr-2" aria-hidden="true" /> View
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={onEdit}
          disabled={!canEdit}
          title={!canEdit ? (editDeniedReason || "You do not have permission to edit this voucher.") : undefined}
          aria-disabled={!canEdit || undefined}
          data-permission-cid={editPermissionCid}
        >
          <Pencil className="w-4 h-4 mr-2" aria-hidden="true" /> Edit
          {!canEdit && <span className="ml-auto text-[10px] text-muted-foreground">no access</span>}
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onPrint}>
          <Printer className="w-4 h-4 mr-2" aria-hidden="true" /> Print
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onHistory}>
          <History className="w-4 h-4 mr-2" aria-hidden="true" /> History
        </DropdownMenuItem>

        {showMiddle && <DropdownMenuSeparator />}
        {canApproveReject && (
          <>
            <DropdownMenuItem onClick={onApprove}>
              <Check className="w-4 h-4 mr-2 text-emerald-600" aria-hidden="true" /> Approve
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onReject}>
              <X className="w-4 h-4 mr-2 text-destructive" aria-hidden="true" /> Reject
            </DropdownMenuItem>
          </>
        )}
        {canReverse && (
          <DropdownMenuItem onClick={onReverse}>
            <ArrowLeftRight className="w-4 h-4 mr-2 text-primary" aria-hidden="true" /> Reverse
          </DropdownMenuItem>
        )}
        {canChangeType && (
          <DropdownMenuItem onClick={onChangeType}>
            <Shuffle className="w-4 h-4 mr-2 text-amber-600" aria-hidden="true" /> Change Type
          </DropdownMenuItem>
        )}

        {showDanger && <DropdownMenuSeparator />}
        {canRestore && (
          <DropdownMenuItem onClick={onRestore}>
            <RotateCcw className="w-4 h-4 mr-2 text-emerald-600" aria-hidden="true" /> Restore
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive"
            title="Move to trash — requires confirmation and a reason."
          >
            <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" /> Delete
          </DropdownMenuItem>
        )}
        {canPurge && (
          <DropdownMenuItem
            onClick={onPurge}
            className="text-destructive focus:text-destructive"
            title="Permanent delete — cannot be undone. Requires confirmation and a reason."
          >
            <Trash2 className="w-4 h-4 mr-2" aria-hidden="true" /> Delete permanently
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
