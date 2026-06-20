import { ArrowDown } from "lucide-react";

function money(cents: number, currency = "usd") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * The signature conversion widget: shows the core mechanic — a one-time job
 * becoming a recurring plan. Illustrative of the product, not a live metric.
 */
export function ConversionWidget({
  exampleCents = 18000,
  currency = "usd",
}: {
  exampleCents?: number;
  currency?: string;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-muted-foreground">
        How a job becomes recurring revenue
      </p>

      <div className="rounded-xl border bg-card/60 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">One-time job</p>
            <p className="text-xs text-muted-foreground">Paid once</p>
          </div>
          <span className="font-mono text-sm font-semibold">
            {money(exampleCents, currency)}
          </span>
        </div>
      </div>

      <div className="flex justify-center">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#6A57FF] to-[#4F38FF] text-white shadow-lg shadow-primary/30">
          <ArrowDown className="badge-float h-4 w-4" />
        </span>
      </div>

      <div className="accent-border rounded-xl p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Recurring plan</p>
            <p className="text-xs text-muted-foreground">Auto-billed, every visit</p>
          </div>
          <span className="gradient-text font-mono text-sm font-bold">
            {money(exampleCents, currency)}/visit
          </span>
        </div>
      </div>
    </div>
  );
}
