"use client";

import { Slot } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes } from "react";

import { Spinner } from "@/components/ui/spinner";
import {
  buttonVariants,
  type ButtonSize,
  type ButtonVariant,
} from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  asChild?: boolean;
}

export function Button({
  className,
  variant = "secondary",
  size = "default",
  loading = false,
  loadingLabel,
  asChild = false,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  const isDisabled = Boolean(loading || disabled);

  return (
    <Comp
      className={cn(buttonVariants({ className, size, variant }))}
      aria-disabled={loading || undefined}
      aria-label={loading && loadingLabel ? loadingLabel : props["aria-label"]}
      data-loading={loading ? "" : undefined}
      data-slot="button"
      disabled={isDisabled}
      type={asChild ? undefined : type ?? "button"}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          <span className={cn(loading && "opacity-0")}>{children}</span>
          {loading ? (
            <Spinner className="pointer-events-none absolute size-4" data-slot="button-loading-indicator" />
          ) : null}
        </>
      )}
    </Comp>
  );
}

export function SubmitButton({
  pending = false,
  children,
  variant = "gradient",
  loadingLabel = "Saving",
  ...props
}: Omit<ButtonProps, "type"> & { pending?: boolean }) {
  return (
    <Button
      type="submit"
      variant={variant}
      loading={pending}
      loadingLabel={loadingLabel}
      {...props}
    >
      {children}
    </Button>
  );
}
