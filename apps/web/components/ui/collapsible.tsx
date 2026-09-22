"use client";

import * as RadixCollapsible from "@radix-ui/react-collapsible";
import { cn } from "@/lib/cn";

export const Collapsible = RadixCollapsible.Root;
export const CollapsibleTrigger = RadixCollapsible.Trigger;

export function CollapsibleContent({ className, ...props }: RadixCollapsible.CollapsibleContentProps) {
  return (
    <RadixCollapsible.Content
      className={cn(
        "overflow-hidden data-[state=closed]:animate-collapse-up data-[state=open]:animate-collapse-down",
        className,
      )}
      {...props}
    />
  );
}
