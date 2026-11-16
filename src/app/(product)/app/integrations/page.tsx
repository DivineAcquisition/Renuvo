import { redirect } from "next/navigation";

/** Integrations lives in Settings now (the owner's decision of November 16, 2026). Old links land there. */
export default function Page() {
  redirect("/app/settings/integrations");
}
