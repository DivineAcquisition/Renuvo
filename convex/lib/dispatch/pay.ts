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

export function payFor(
  cleaner: { pay?: PaySetting },
  job: { priceCents?: number; startsAt: number; endsAt: number },
): PayAnswer {
  const pay = cleaner.pay;
  if (!pay) return { ok: false, code: "no_pay_set", reason: "has no pay set, so their pay for this visit cannot be worked out" };
  if (pay.kind === "share") {
    if (job.priceCents === undefined) {
      return { ok: false, code: "no_job_price", reason: "is paid a share of the job, and this job has no price" };
    }
    const payCents = Math.round((job.priceCents * pay.shareBps) / 10000);
    const percent = Math.round(pay.shareBps) / 100;
    return { ok: true, payCents, basis: `${percent}% of the ${money(job.priceCents)} job price` };
  }
  const minutes = Math.round((job.endsAt - job.startsAt) / 60000);
  const payCents = Math.round((pay.hourlyCents * minutes) / 60);
  return { ok: true, payCents, basis: `${money(pay.hourlyCents)} an hour for ${hoursWords(minutes)}` };
}
