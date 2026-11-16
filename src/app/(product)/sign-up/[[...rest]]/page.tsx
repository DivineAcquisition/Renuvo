import { redirect } from "next/navigation";

import { AUTH } from "@/lib/auth/routes";

/** The old address. Creating an account lives at /signup. */
export default function Page() {
  redirect(AUTH.signup);
}
