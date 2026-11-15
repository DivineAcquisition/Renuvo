import { redirect } from "next/navigation";

/** The AI Team page is retired. Agent permissions and pause are in Settings. */
export default function Page() {
  redirect("/app/settings");
}
