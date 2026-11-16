/**
 * Every test starts with billing connected to a stand-in for Autumn's sandbox and the test rate card, so
 * AI work can run. A test about billing itself reaches the stand-in through `billing` below, or unsets
 * AUTUMN_SECRET_KEY to see the "not connected" state.
 */
import { afterEach, beforeEach } from "vitest";

import { setAutumnTransportForTests } from "../convex/lib/billing/autumn";
import { fakeAutumn } from "./fakeAutumn";

export let billing = fakeAutumn();

beforeEach(() => {
  billing = fakeAutumn();
  process.env.AUTUMN_SECRET_KEY = "am_sk_test_fake_key_for_tests";
  process.env.BILLING_RATE_CARD = "fixture-2026-11";
  setAutumnTransportForTests(billing.fetch);
});

afterEach(() => {
  setAutumnTransportForTests(null);
  delete process.env.AUTUMN_SECRET_KEY;
  delete process.env.BILLING_RATE_CARD;
  delete process.env.BILLING_TOP_UP_PACKS;
});
