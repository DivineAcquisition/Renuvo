import { redirect } from "next/navigation";

/** Connections was folded into Settings › Integrations (the owner's decision of November 16, 2026). */
export default function Page() {
  redirect("/app/settings/integrations");
}
