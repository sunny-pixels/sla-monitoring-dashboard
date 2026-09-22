"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: RadixDialog.DialogContentProps & { showClose?: boolean }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]",
          "transition-opacity duration-150 data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
        )}
      />
      <RadixDialog.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2",
          "rounded-xl border border-border bg-surface-raised shadow-lg",
          "transition-[opacity,transform] duration-150",
          "data-[state=closed]:scale-95 data-[state=closed]:opacity-0",
          "data-[state=open]:scale-100 data-[state=open]:opacity-100",
          "focus:outline-none",
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <RadixDialog.Close
            className="absolute right-4 top-4 rounded-md p-1 text-text-faint transition-colors hover:bg-neutral-soft hover:text-text"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </RadixDialog.Close>
        )}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogTitle({ className, ...props }: RadixDialog.DialogTitleProps) {
  return (
    <RadixDialog.Title
      className={cn("font-display text-lg font-semibold text-text", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: RadixDialog.DialogDescriptionProps) {
  return <RadixDialog.Description className={cn("text-sm text-text-muted", className)} {...props} />;
}
