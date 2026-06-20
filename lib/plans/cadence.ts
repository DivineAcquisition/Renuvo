/** Map interval_days (from cadence_profiles) to a Stripe recurring interval. */
export function intervalToStripe(intervalDays: number): {
  interval: "day" | "week" | "month";
  interval_count: number;
} {
  switch (intervalDays) {
    case 7:
      return { interval: "week", interval_count: 1 };
    case 14:
      return { interval: "week", interval_count: 2 };
    case 30:
      return { interval: "month", interval_count: 1 };
    case 90:
      return { interval: "month", interval_count: 3 };
    default:
      return { interval: "day", interval_count: intervalDays };
  }
}

/** Compute the next N visit dates, spaced by interval_days, starting one interval out. */
export function nextVisitDates(
  intervalDays: number,
  count: number,
  from = new Date()
): Date[] {
  const dates: Date[] = [];
  for (let i = 1; i <= count; i++) {
    dates.push(
      new Date(from.getTime() + i * intervalDays * 24 * 60 * 60 * 1000)
    );
  }
  return dates;
}
