import { redirect } from "next/navigation";

/** AI features now sit on Agent controls. Old links land there. */
export default function Page() {
  redirect("/app/settings/agents#ai-features");
}
