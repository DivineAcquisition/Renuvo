/**
 * A cleaner's pay for one visit, worked out in code from the Owner's settings and the job's own facts.
 * This is the pay snapshot an offer states. Nothing here guesses: with a missing price or a missing
 * rate there is no number, and the answer says which is missing.
 */
export type PaySetting = { kind: "share"; shareBps: number } | { kind: "hourly"; hourlyCents: number };

export type PayAnswer =
  | { ok: true; payCents: number; basis: string }
  | { ok: false; code: "no_pay_set" | "no_job_price"; reason: string };

export function money(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const part = String(Math.abs(cents % 100)).padStart(2, "0");
  return `$${whole.toLocaleString("en-US")}.${part}`;
}

function hoursWords(minutes: number): string {
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/**
 * How the Owner pays a crew. "share_of_whole": each cleaner on a share gets their share of the whole
 * price, however many are on the job. "split_by_crew": that share is divided by the number of cleaners
 * the job needs. The lead may get a premium on top, as a percentage of what they would otherwise get.
 * Hourly pay is for the cleaner's own hours either way, so it is never split.
 */
export type CrewPay = { mode: "share_of_whole" | "split_by_crew"; leadPremiumPercent: number };
export const CREW_PAY_DEFAULT: CrewPay = { mode: "share_of_whole", leadPremiumPercent: 0 };

export function payFor(
  cleaner: { pay?: PaySetting },
  job: { priceCents?: number; startsAt: number; endsAt: number; requiredCrew?: number },
  crew: { rule: CrewPay; role: "lead" | "support" } = { rule: CREW_PAY_DEFAULT, role: "lead" },
): PayAnswer {
  const pay = cleaner.pay;
  if (!pay) return { ok: false, code: "no_pay_set", reason: "has no pay set, so their pay for this visit cannot be worked out" };
  const size = Math.max(1, Math.trunc(job.requiredCrew ?? 1));
  let exact: number;
  let basis: string;
  if (pay.kind === "share") {
    if (job.priceCents === undefined) {
      return { ok: false, code: "no_job_price", reason: "is paid a share of the job, and this job has no price" };
    }
    const percent = Math.round(pay.shareBps) / 100;
    const split = crew.rule.mode === "split_by_crew" && size > 1;
    exact = (job.priceCents * pay.shareBps) / 10000 / (split ? size : 1);
    basis = split ? `${percent}% of the ${money(job.priceCents)} job price, split ${size} ways` : `${percent}% of the ${money(job.priceCents)} job price`;
  } else {
    const minutes = Math.round((job.endsAt - job.startsAt) / 60000);
    exact = (pay.hourlyCents * minutes) / 60;
    basis = `${money(pay.hourlyCents)} an hour for ${hoursWords(minutes)}`;
  }
  if (size > 1 && crew.role === "lead" && crew.rule.leadPremiumPercent > 0) {
    exact *= 1 + crew.rule.leadPremiumPercent / 100;
    basis = `${basis}, plus ${crew.rule.leadPremiumPercent}% as lead`;
  }
  // Rounded once, at the end, so a split and a premium do not each add a rounding cent.
  return { ok: true, payCents: Math.round(exact), basis };
}
