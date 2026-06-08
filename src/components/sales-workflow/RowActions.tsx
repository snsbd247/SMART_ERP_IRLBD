import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Eye, Pencil, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Props {
  viewTo?: string;
  editTo?: string;
  onDelete?: () => unknown | Promise<unknown>;
  deleteLabel?: string;
  printSlot?: React.ReactNode;
}

export function RowActions({ viewTo, editTo, onDelete, deleteLabel = "Delete this record?", printSlot }: Props) {
  return (
    <div className="flex items-center gap-1 justify-end">
      {printSlot}
      {viewTo && (
        <Link to={viewTo}>
          <Button size="icon" variant="ghost" title="View"><Eye className="w-4 h-4" /></Button>
        </Link>
      )}
      {editTo && (
        <Link to={editTo}>
          <Button size="icon" variant="ghost" title="Edit"><Pencil className="w-4 h-4" /></Button>
        </Link>
      )}
      {onDelete && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="icon" variant="ghost" title="Delete" className="text-destructive hover:text-destructive">
              <Trash2 className="w-4 h-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete confirmation</AlertDialogTitle>
              <AlertDialogDescription>{deleteLabel}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete()}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
