import { cn } from "@/lib/utils";

export function GlassCard({
  children,
  className,
  badge,
}: {
  children: React.ReactNode;
  className?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className={cn("glass relative rounded-2xl p-6", className)}>
      {badge && (
        <div className="badge-float absolute -top-3 right-5 rounded-full bg-gradient-to-r from-[#6A57FF] to-[#4F38FF] px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-primary/30">
          {badge}
        </div>
      )}
      {children}
    </div>
  );
}
