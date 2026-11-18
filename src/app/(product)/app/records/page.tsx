import { redirect } from "next/navigation";

/** Records became two pages: Clients & Properties, and Cleaners. Old links land on the first. */
export default function Page() {
  redirect("/app/clients");
}
