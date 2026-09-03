import type { ComponentPropsWithoutRef, CSSProperties, FC } from "react";

import { cn } from "@/lib/utils";

export const AnimatedShinyText: FC<
  ComponentPropsWithoutRef<"span"> & { shimmerWidth?: number }
> = ({ children, className, shimmerWidth = 100, ...props }) => {
  return (
    <span
      style={{ "--shiny-width": `${shimmerWidth}px` } as CSSProperties}
      className={cn(
        "mx-auto inline-flex max-w-md font-medium",
        "animate-shiny-text bg-clip-text bg-no-repeat text-transparent [background-size:250%_100%]",
        "bg-[linear-gradient(110deg,#6650d8_38%,#ffffff_50%,#6650d8_62%)]",
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
};
