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

export function DeleteConversationDialog({
  open,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the conversation and its messages. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ConversationActionSheet({
  open,
  onDelete,
  onClose,
}: {
  open: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Dismiss" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg">
        <button
          type="button"
          className="w-full rounded-xl px-4 py-3 text-left text-sm font-semibold text-red-700"
          onClick={onDelete}
        >
          Delete conversation
        </button>
        <button type="button" className="mt-1 w-full rounded-xl px-4 py-3 text-left text-sm text-[#17221D]" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
