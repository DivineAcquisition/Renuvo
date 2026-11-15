import { redirect } from "next/navigation";

/** The decision queue is Approvals now. Old links land there. */
export default function Page() {
  redirect("/app/approvals");
}
