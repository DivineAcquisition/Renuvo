import { redirect } from "next/navigation";

/** Services moved out of Settings into Company › Services & Pricing, the one catalog. Old links land there. */
export default function Page() {
  redirect("/app/services");
}
