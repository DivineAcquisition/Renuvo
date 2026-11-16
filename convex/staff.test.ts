import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import { refusal, start } from "../tests/harness";

const admin = { subject: "user_admin", email: "boss@selestial.example", emailVerified: true, name: "Boss" };
const other = { subject: "user_other", email: "someone@example.com", emailVerified: true, name: "Someone" };

describe("Selestial staff", () => {
  beforeEach(() => {
    process.env.STAFF_BOOTSTRAP_EMAIL = admin.email;
  });
  afterEach(() => {
    delete process.env.STAFF_BOOTSTRAP_EMAIL;
  });

  test("the bootstrap email becomes the first admin, once, and only with a confirmed email", async () => {
    const t = start();
    expect(await t.withIdentity({ ...admin, emailVerified: false }).query(api.staff.me, {})).toBeNull();
    expect(await t.withIdentity(admin).query(api.staff.me, {})).toMatchObject({ role: "admin" });
    await t.withIdentity(admin).mutation(api.staff.add, { email: "helper@selestial.example", name: "Helper", role: "reviewer" });
    const rows = await t.withIdentity(admin).query(api.staff.list, {});
    expect(rows.map((row) => row.role).sort()).toEqual(["admin", "reviewer"]);
    // Once an admin is saved, the setting no longer makes anyone else an admin.
    process.env.STAFF_BOOTSTRAP_EMAIL = other.email;
    expect(await t.withIdentity(other).query(api.staff.me, {})).toBeNull();
  });

  test("everyone else is refused as if the functions did not exist", async () => {
    const t = start();
    expect(await refusal(t.withIdentity(other).query(api.staff.list, {}))).toBe("Not found.");
    expect(await refusal(t.withIdentity(other).mutation(api.staff.add, { email: "x@example.com", name: "X", role: "admin" }))).toBe("Not found.");
    expect(await refusal(t.query(api.staff.list, {}))).toBe("Not found.");
  });

  test("a reviewer cannot add staff, and an added person is staff only under their confirmed email", async () => {
    const t = start();
    await t.withIdentity(admin).mutation(api.staff.add, { email: "helper@selestial.example", name: "Helper", role: "reviewer" });
    const helper = { subject: "user_helper", email: "helper@selestial.example", emailVerified: true, name: "Helper" };
    expect(await t.withIdentity(helper).query(api.staff.me, {})).toMatchObject({ role: "reviewer" });
    expect(await refusal(t.withIdentity(helper).mutation(api.staff.add, { email: "y@example.com", name: "Y", role: "admin" }))).toBe("Not allowed.");
    expect(await t.withIdentity({ ...helper, emailVerified: false }).query(api.staff.me, {})).toBeNull();
  });
});
