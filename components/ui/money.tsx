import { formatMoney, type Microdollars } from "@/lib/money";

/** The ONLY way money renders in the UI. Mono numerals, per art direction. */
export function Money({
  value,
  currency = "USD",
  cents = true,
  className = "",
}: {
  value: Microdollars;
  currency?: string;
  cents?: boolean;
  className?: string;
}) {
  return (
    <span className={`font-mono tabular-nums ${className}`}>
      {formatMoney(value, { currency, cents })}
    </span>
  );
}
