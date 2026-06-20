import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import { listLinks, listCustomersForPicker } from "@/lib/links/queries";
import { LinksView } from "./LinksView";

export default async function LinksPage() {
  const active = await getActiveOrg();
  if (!active) return null;
  const [links, customers] = await Promise.all([
    listLinks(active.org.id),
    listCustomersForPicker(active.org.id),
  ]);
  return <LinksView links={links} customers={customers} />;
}
