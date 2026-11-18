"use client";

/** A small "more actions" menu: a button that opens a keyboard-navigable list of actions. */
import { Menu } from "@base-ui/react/menu";
import Link from "next/link";

import { MoreHorizontal } from "@/components/icons";
import { cn } from "@/lib/utils";

export type MenuAction = { label: string; href?: string; onSelect?: () => void; danger?: boolean; disabled?: boolean };

export function ActionMenu({ label, actions, className, trigger }: { label: string; actions: MenuAction[]; className?: string; trigger?: React.ReactNode }) {
  const shown = actions.filter(Boolean);
  if (!shown.length) return null;
  return (
    <Menu.Root>
      <Menu.Trigger aria-label={label} className={cn("inline-grid min-h-8 min-w-8 place-items-center rounded-lg px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-strong focus-visible:outline-2 focus-visible:outline-brand-500/50 data-[popup-open]:bg-muted data-[popup-open]:text-strong", className)}>
        {trigger ?? <MoreHorizontal aria-hidden className="size-4" />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} collisionPadding={12} className="z-[60]">
          <Menu.Popup className="min-w-48 origin-[var(--transform-origin)] rounded-xl border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg shadow-black/10 outline-none transition-[opacity,scale] duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none">
            {shown.map((action) => {
              const itemClass = cn("flex w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left outline-none data-[highlighted]:bg-muted data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50", action.danger ? "text-destructive-foreground" : "text-strong");
              return action.href ? (
                <Menu.Item key={action.label} disabled={action.disabled} className={itemClass} render={<Link href={action.href} />}>
                  {action.label}
                </Menu.Item>
              ) : (
                <Menu.Item key={action.label} disabled={action.disabled} className={itemClass} onClick={action.onSelect}>
                  {action.label}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
