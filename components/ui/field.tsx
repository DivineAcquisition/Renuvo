import * as React from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

/**
 * Premium labeled field wrapper — pairs a Label with any control plus optional
 * hint/error text. Use across forms for consistent spacing, typography, and
 * validation styling.
 */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label htmlFor={htmlFor}>
          {label}
          {required && <span className="ml-0.5 text-primary">*</span>}
        </Label>
      )}
      {children}
      {error ? (
        <p className="text-xs font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const CONTROL =
  "flex w-full rounded-lg border border-input bg-background px-3.5 text-sm shadow-[0_1px_2px_rgba(20,18,33,0.04)] transition-all duration-200 ease-out placeholder:text-muted-foreground/70 hover:border-primary/30 focus-visible:border-primary/70 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.13)] disabled:cursor-not-allowed disabled:opacity-50";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(CONTROL, "min-h-[88px] py-2.5 leading-relaxed", className)}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select">
>(({ className, children, ...props }, ref) => (
  <select ref={ref} className={cn(CONTROL, "h-10", className)} {...props}>
    {children}
  </select>
));
Select.displayName = "Select";

/**
 * A selectable radio "card" — a richer, tappable alternative to a bare radio,
 * with a title + optional description. Cohesive with the brand accent.
 */
export function RadioCard({
  checked,
  onSelect,
  title,
  description,
  disabled,
}: {
  checked: boolean;
  onSelect: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={checked}
      className={cn(
        "flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-all duration-200",
        checked
          ? "border-primary bg-primary/[0.06] shadow-[0_0_0_3px_hsl(var(--primary)/0.10)]"
          : "border-input hover:border-primary/40 hover:bg-accent/40"
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border transition-colors",
          checked ? "border-primary" : "border-muted-foreground/40"
        )}
        style={{ height: 18, width: 18 }}
      >
        {checked && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        {description && (
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}
