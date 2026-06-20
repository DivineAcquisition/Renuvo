import { getActiveOrg } from "@/lib/auth/getActiveOrg";
import {
  listAccounts,
  getAccountsSummary,
  type AccountFilter,
} from "@/lib/accounts/queries";
import { AccountsView } from "./AccountsView";

function arr(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  return v.split(",").filter(Boolean);
}

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const active = await getActiveOrg();
  if (!active) return null;
  const sp = await searchParams;

  const filter: AccountFilter = {
    status: arr(sp.status) as AccountFilter["status"],
    risk: arr(sp.risk) as AccountFilter["risk"],
    cadence: arr(sp.cadence),
    search: sp.q || undefined,
    sort: (sp.sort as AccountFilter["sort"]) || "value_desc",
  };

  const [accounts, summary] = await Promise.all([
    listAccounts(active.org.id, filter),
    getAccountsSummary(active.org.id),
  ]);

  return (
    <AccountsView
      accounts={accounts}
      summary={summary}
      isOwner={active.role === "owner"}
      filter={{
        status: filter.status ?? [],
        risk: filter.risk ?? [],
        cadence: filter.cadence ?? [],
        search: filter.search ?? "",
        sort: filter.sort ?? "value_desc",
      }}
    />
  );
}
