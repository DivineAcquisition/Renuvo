import { redirect } from "next/navigation";

import { AUTH } from "@/lib/auth/routes";

/** The old address. Sign-in lives at /login. */
export default function Page() {
  redirect(AUTH.login);
}
