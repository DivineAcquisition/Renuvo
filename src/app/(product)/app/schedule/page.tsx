import { redirect } from "next/navigation";

import { linkTo } from "@/lib/app/navigation-helpers";

/** The schedule is Dispatch › Schedule now. Old links and bookmarks land there. */
export default function Page() {
  redirect(linkTo("dispatch.schedule") ?? "/app");
}
