"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Submit button that reflects the parent <form>'s pending state.
 * (React 18 / Next 14 equivalent of the `pending` flag from useActionState.)
 */
export function SubmitButton({
  children,
  pendingText,
  variant = "default",
  size,
  className,
}: {
  children: React.ReactNode;
  pendingText: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={cn("w-full", className)}
      disabled={pending}
    >
      {pending ? pendingText : children}
    </Button>
  );
}
