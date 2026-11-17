import { redirect } from "next/navigation";

/** AI & usage is part of Plan & Usage now: the AI feature switches sit on its Usage tab. Old links land there. */
export default function Page() {
  redirect("/app/settings/billing?tab=usage#ai-features");
}
