/**
 * Which destinations the launch rate card covers: standard US numbers in the 50 states and DC on the
 * North American Numbering Plan. Everything else stays unavailable until it has its own rate and policy.
 *
 * NANP area codes outside the US (Canada and the Caribbean), US territories, toll-free, premium (900) and
 * the non-geographic 5XX codes are refused. Short codes and international numbers are not +1 ten-digit
 * numbers, so they never reach this check as supported.
 */

const CANADA = "204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 387 403 416 418 428 431 437 438 450 460 468 474 506 514 519 548 579 581 584 587 600 604 613 622 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 879 902 905 942";
const CARIBBEAN_AND_ATLANTIC = "242 246 264 268 284 345 441 473 649 658 664 721 758 767 784 809 829 849 868 869 876";
const US_TERRITORIES = "340 670 671 684 787 939";
const TOLL_FREE = "800 833 844 855 866 877 888";
const PREMIUM_AND_SPECIAL = "900 976 500 521 522 523 524 525 526 527 528 529 532 533 535 538 542 543 544 545 546 547 549 550 552 553 554 556 558 566 569 577 578 588 589";

const BLOCKED = new Map<string, string>();
for (const [list, why] of [
  [CANADA, "Canadian numbers"],
  [CARIBBEAN_AND_ATLANTIC, "Caribbean and other non-US numbers"],
  [US_TERRITORIES, "US territory numbers"],
  [TOLL_FREE, "Toll-free numbers"],
  [PREMIUM_AND_SPECIAL, "Premium and special-service numbers"],
] as const) {
  for (const code of list.split(" ")) BLOCKED.set(code, why);
}

export type RouteAnswer = { ok: true } | { ok: false; words: string };

/** Whether a text to this E.164 number is on a supported, priced route. */
export function smsRoute(to: string): RouteAnswer {
  const match = /^\+1([2-9]\d{2})[2-9]\d{6}$/.exec(to);
  if (!match) return { ok: false, words: "Texts can only go to US mobile and landline numbers for now. International and short-code numbers aren't available." };
  const why = BLOCKED.get(match[1]);
  if (why) return { ok: false, words: `${why} aren't on Selestial's texting rates yet, so this text wasn't sent and nothing was charged.` };
  return { ok: true };
}
