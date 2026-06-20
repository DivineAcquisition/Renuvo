import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // shared base: tactile press, premium focus ring, smooth easing, and a sheen
  // sweep (the ::before) that brand-colored variants opt into on hover.
  "relative inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-xl text-sm font-semibold ring-offset-background transition-[transform,box-shadow,background-color,border-color] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.97] [&_svg]:size-4 [&_svg]:shrink-0 before:pointer-events-none before:absolute before:inset-0 before:-translate-x-full before:bg-gradient-to-r before:from-transparent before:via-white/25 before:to-transparent before:transition-transform before:duration-700 before:content-['']",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.18),0_8px_20px_-10px_hsl(247_60%_30%/0.45)] hover:-translate-y-0.5 hover:bg-primary/95 hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.22),0_16px_32px_-12px_hsl(247_60%_30%/0.55)] hover:before:translate-x-full",
        gradient:
          "bg-gradient-to-r from-[#6A57FF] to-[#4F38FF] bg-[length:140%_100%] bg-left text-white shadow-[0_10px_28px_-12px_hsl(247_80%_45%/0.6)] transition-[transform,box-shadow,background-position] hover:-translate-y-0.5 hover:bg-right hover:shadow-[0_18px_40px_-12px_hsl(247_80%_45%/0.7)] hover:before:translate-x-full",
        destructive:
          "bg-destructive text-destructive-foreground shadow-[0_8px_20px_-10px_hsl(0_72%_45%/0.5)] hover:-translate-y-0.5 hover:bg-destructive/90 hover:shadow-[0_16px_32px_-12px_hsl(0_72%_45%/0.6)]",
        outline:
          "border border-input bg-background/70 backdrop-blur-sm hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent hover:text-accent-foreground hover:shadow-[0_8px_20px_-14px_hsl(247_60%_30%/0.4)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:-translate-y-0.5 hover:bg-secondary/70 hover:shadow-sm",
        ghost:
          "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-lg px-3.5",
        lg: "h-12 rounded-xl px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
