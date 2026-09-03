import type { ElementType, HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type PanelProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "article" | "li";
};

export function Panel({
  as: Component = "div",
  className,
  ...props
}: PanelProps) {
  const Tag = Component as ElementType;
  return <Tag className={cn("panel panel-hover rounded-2xl", className)} {...props} />;
}
