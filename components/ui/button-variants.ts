import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-lg border font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 data-[loading]:select-none sm:text-sm [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default: "h-9 px-3 text-sm",
        sm: "h-8 gap-1.5 px-2.5 text-sm",
        lg: "h-10 px-3.5 text-sm sm:h-10",
        xl: "h-11 px-4 text-base [&_svg]:size-5",
        icon: "size-9",
      },
      variant: {
        default: "btn-primary-solid",
        primary: "btn-primary-solid",
        gradient: "btn-gradient",
        outline:
          "border-input bg-white text-foreground shadow-sm hover:bg-brand-50 hover:border-brand-400/50",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "border-transparent text-foreground hover:bg-accent",
        link: "border-transparent text-brand-700 underline-offset-4 hover:underline",
      },
    },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export function buttonClasses({
  variant = "secondary",
  size = "default",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}): string {
  return cn(buttonVariants({ variant, size, className }));
}
